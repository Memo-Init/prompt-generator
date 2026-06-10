/**
 * Tests for PromptGeneratorCli.run — the only public method (PRD-005
 * requirement 11).
 *
 * Covers:
 *   - happy path (2 units, all three source types) — files, manifest,
 *     summary line format
 *   - factory form (buildUnits returning { units })
 *   - config contract errors: both exports, no export, broken module,
 *     missing config file
 *   - unit validation: duplicate ids, invalid id, wrong unit shape
 *   - collision: existing target file is a hard error, nothing written
 *   - fail-fast: a throwing unit produces ZERO files (all-or-nothing)
 *   - argument errors: missing/empty configPath and outDir
 *
 * Output goes to tests/.tmp-cli/ — its own temp root (repo-internal,
 * gitignored, Memo 032 isolation). Deliberately NOT tests/.tmp/: the
 * happy-path suite removes that directory in its afterAll and Jest runs
 * test files in parallel workers — sharing it would be a deletion race.
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PromptGeneratorCli } from '../../src/PromptGeneratorCli.mjs'


const fixtureConfigPath = ( { name } ) => {
    const resolved = fileURLToPath( new URL( `./fixtures/${name}`, import.meta.url ) )

    return resolved
}


const tmpRoot = fileURLToPath( new URL( '../.tmp-cli/', import.meta.url ) )

const outDirFor = ( { caseName } ) => {
    const outDir = join( tmpRoot, caseName, 'out' )

    return outDir
}


const pathMissing = async ( { targetPath } ) => {
    let missing = false
    try {
        await stat( targetPath )
    } catch( error ) {
        missing = error.code === 'ENOENT'
    }

    return missing
}


beforeAll( async () => {
    await mkdir( tmpRoot, { 'recursive': true } )
} )

afterAll( async () => {
    await rm( tmpRoot, { 'recursive': true, 'force': true } )
} )


describe( 'PromptGeneratorCli.run — happy path (static units export)', () => {
    const configPath = fixtureConfigPath( { 'name': 'cli-config-happy.mjs' } )
    const outDir = outDirFor( { 'caseName': 'happy' } )
    let result

    beforeAll( async () => {
        result = await PromptGeneratorCli.run( { configPath, outDir } )
    } )


    test( 'writes one prompt file per unit plus manifest.json', async () => {
        const entries = await readdir( outDir )

        expect( entries.sort() ).toEqual( [ 'manifest.json', 'unit-a.md', 'unit-b.md' ] )
    } )


    test( 'prompt files carry the composed prompt without torso tokens', async () => {
        const unitA = await readFile( join( outDir, 'unit-a.md' ), 'utf-8' )
        const unitB = await readFile( join( outDir, 'unit-b.md' ), 'utf-8' )

        expect( unitA ).toContain( 'NS alpha' )
        expect( unitA ).toContain( 'precise, methodical engineer' )
        expect( unitA ).toContain( '1. inspect alpha' )
        expect( unitA ).not.toContain( '{{' )
        expect( unitB ).toBe( 'only beta' )
    } )


    test( 'manifest carries generator, configPath as passed, generatedAt and per-unit metadata', async () => {
        const manifest = JSON.parse( await readFile( join( outDir, 'manifest.json' ), 'utf-8' ) )
        const ownPackage = JSON.parse( await readFile( fileURLToPath( new URL( '../../package.json', import.meta.url ) ), 'utf-8' ) )

        expect( Object.keys( manifest ).sort() ).toEqual( [ 'configPath', 'generatedAt', 'generator', 'units' ] )
        expect( manifest.generator ).toEqual( { 'name': ownPackage.name, 'version': ownPackage.version } )
        expect( manifest.configPath ).toBe( configPath )
        expect( manifest.generatedAt ).toMatch( /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/ )
        expect( manifest.units ).toHaveLength( 2 )

        const [ unitA ] = manifest.units
        expect( Object.keys( unitA ).sort() ).toEqual( [ 'file', 'id', 'placeholders', 'prompt', 'template' ] )
        expect( unitA.id ).toBe( 'unit-a' )
        expect( unitA.file ).toBe( 'unit-a.md' )
        expect( unitA.prompt.source ).toBe( 'generated' )
        expect( unitA.prompt.hash ).toMatch( /^[0-9a-f]{64}$/ )
        expect( unitA.placeholders.NAMESPACE.source ).toBe( 'string' )
        expect( unitA.placeholders.PERSONA.source ).toBe( 'file' )
        expect( unitA.placeholders.STEP_PLAN.source ).toBe( 'function' )
        expect( unitA.template.source ).toBe( 'string' )
    } )


    test( 'manifest prompt metadata matches the written file (length + integrity)', async () => {
        const manifest = JSON.parse( await readFile( join( outDir, 'manifest.json' ), 'utf-8' ) )
        const unitAContent = await readFile( join( outDir, 'unit-a.md' ), 'utf-8' )

        expect( manifest.units[ 0 ].prompt.length ).toBe( unitAContent.length )
    } )


    test( 'returns summary lines in the documented format plus manifest and count lines', () => {
        const { summaryLines, manifestPath, unitCount, writtenFiles } = result

        expect( summaryLines ).toHaveLength( 4 )
        expect( summaryLines[ 0 ] ).toMatch( /^written .*unit-a\.md \(\d+ chars, sha256 [0-9a-f]{12}\)$/ )
        expect( summaryLines[ 1 ] ).toMatch( /^written .*unit-b\.md \(\d+ chars, sha256 [0-9a-f]{12}\)$/ )
        expect( summaryLines[ 2 ] ).toBe( `manifest: ${manifestPath}` )
        expect( summaryLines[ 3 ] ).toBe( 'units: 2' )
        expect( unitCount ).toBe( 2 )
        expect( writtenFiles ).toHaveLength( 2 )
        expect( writtenFiles[ 0 ] ).toEqual( { 'id': 'unit-a', 'file': 'unit-a.md', 'path': join( outDir, 'unit-a.md' ) } )
    } )
} )


describe( 'PromptGeneratorCli.run — factory form (buildUnits export)', () => {
    test( 'factory units are composed and written like static units', async () => {
        const outDir = outDirFor( { 'caseName': 'factory' } )
        const result = await PromptGeneratorCli.run( { 'configPath': fixtureConfigPath( { 'name': 'cli-config-factory.mjs' } ), outDir } )

        const promptContent = await readFile( join( outDir, 'factory-unit.md' ), 'utf-8' )
        const manifest = JSON.parse( await readFile( join( outDir, 'manifest.json' ), 'utf-8' ) )

        expect( promptContent ).toBe( 'factory says from-factory' )
        expect( manifest.units ).toHaveLength( 1 )
        expect( manifest.units[ 0 ].id ).toBe( 'factory-unit' )
        expect( result.unitCount ).toBe( 1 )
    } )
} )


describe( 'PromptGeneratorCli.run — config contract errors', () => {
    test( 'both units and buildUnits exported is a hard error', async () => {
        await expect( PromptGeneratorCli.run( {
            'configPath': fixtureConfigPath( { 'name': 'cli-config-both-exports.mjs' } ),
            'outDir': outDirFor( { 'caseName': 'both-exports' } )
        } ) ).rejects.toThrow( "exports both 'units' and 'buildUnits' — exactly one export form is required" )
    } )


    test( 'neither units nor buildUnits exported is a hard error', async () => {
        await expect( PromptGeneratorCli.run( {
            'configPath': fixtureConfigPath( { 'name': 'cli-config-no-units.mjs' } ),
            'outDir': outDirFor( { 'caseName': 'no-units' } )
        } ) ).rejects.toThrow( "exports neither 'units' nor 'buildUnits' — exactly one export form is required" )
    } )


    test( 'a config module with a syntax error surfaces as a load error', async () => {
        await expect( PromptGeneratorCli.run( {
            'configPath': fixtureConfigPath( { 'name': 'cli-config-broken.mjs' } ),
            'outDir': outDirFor( { 'caseName': 'broken' } )
        } ) ).rejects.toThrow( 'config module could not be loaded from' )
    } )


    test( 'a missing config file surfaces as a load error', async () => {
        await expect( PromptGeneratorCli.run( {
            'configPath': fixtureConfigPath( { 'name': 'cli-config-does-not-exist.mjs' } ),
            'outDir': outDirFor( { 'caseName': 'missing-config' } )
        } ) ).rejects.toThrow( 'config module could not be loaded from' )
    } )
} )


describe( 'PromptGeneratorCli.run — unit validation errors', () => {
    test( 'duplicate unit ids are a hard error listing the duplicates', async () => {
        await expect( PromptGeneratorCli.run( {
            'configPath': fixtureConfigPath( { 'name': 'cli-config-duplicate-ids.mjs' } ),
            'outDir': outDirFor( { 'caseName': 'duplicate-ids' } )
        } ) ).rejects.toThrow( 'duplicate unit id(s): dup-unit' )
    } )


    test( 'an id violating the file-name-safe pattern is a hard error', async () => {
        await expect( PromptGeneratorCli.run( {
            'configPath': fixtureConfigPath( { 'name': 'cli-config-invalid-id.mjs' } ),
            'outDir': outDirFor( { 'caseName': 'invalid-id' } )
        } ) ).rejects.toThrow( 'units[0].id: must match ^[A-Za-z0-9][A-Za-z0-9_-]*$' )
    } )
} )


describe( 'PromptGeneratorCli.run — collision protection (no overwrite, no force)', () => {
    test( 'a second run into the same out dir is a hard error listing all colliding paths', async () => {
        const outDir = outDirFor( { 'caseName': 'collision-rerun' } )
        const configPath = fixtureConfigPath( { 'name': 'cli-config-factory.mjs' } )
        await PromptGeneratorCli.run( { configPath, outDir } )
        const firstContent = await readFile( join( outDir, 'factory-unit.md' ), 'utf-8' )

        let thrownMessage = ''
        try {
            await PromptGeneratorCli.run( { configPath, outDir } )
        } catch( error ) {
            thrownMessage = error.message
        }

        expect( thrownMessage ).toContain( 'output collision' )
        expect( thrownMessage ).toContain( join( outDir, 'factory-unit.md' ) )
        expect( thrownMessage ).toContain( join( outDir, 'manifest.json' ) )

        const secondContent = await readFile( join( outDir, 'factory-unit.md' ), 'utf-8' )
        expect( secondContent ).toBe( firstContent )
    } )


    test( 'a single pre-existing prompt file blocks the run — no manifest is written', async () => {
        const outDir = outDirFor( { 'caseName': 'collision-single' } )
        await mkdir( outDir, { 'recursive': true } )
        await writeFile( join( outDir, 'factory-unit.md' ), 'pre-existing content', 'utf-8' )

        await expect( PromptGeneratorCli.run( {
            'configPath': fixtureConfigPath( { 'name': 'cli-config-factory.mjs' } ),
            outDir
        } ) ).rejects.toThrow( join( outDir, 'factory-unit.md' ) )

        const manifestMissing = await pathMissing( { 'targetPath': join( outDir, 'manifest.json' ) } )
        const preExisting = await readFile( join( outDir, 'factory-unit.md' ), 'utf-8' )
        expect( manifestMissing ).toBe( true )
        expect( preExisting ).toBe( 'pre-existing content' )
    } )
} )


describe( 'PromptGeneratorCli.run — fail-fast + all-or-nothing', () => {
    test( 'a failing unit aborts the run: PGEN code visible, unit id added, ZERO files written', async () => {
        const outDir = outDirFor( { 'caseName': 'fail-fast' } )

        let thrownMessage = ''
        try {
            await PromptGeneratorCli.run( {
                'configPath': fixtureConfigPath( { 'name': 'cli-config-failing-unit.mjs' } ),
                outDir
            } )
        } catch( error ) {
            thrownMessage = error.message
        }

        expect( thrownMessage ).toContain( "unit 'unit-bad' failed" )
        expect( thrownMessage ).toContain( 'PGEN-032' )

        // all-or-nothing: not even the successfully composed unit-ok.md exists
        const outDirMissing = await pathMissing( { 'targetPath': outDir } )
        expect( outDirMissing ).toBe( true )
    } )
} )


describe( 'PromptGeneratorCli.run — argument errors (no default paths)', () => {
    test( 'missing configPath is a hard error', async () => {
        await expect( PromptGeneratorCli.run( {
            'configPath': undefined,
            'outDir': outDirFor( { 'caseName': 'arg-missing-config' } )
        } ) ).rejects.toThrow( 'configPath: must be a non-empty string (--config=<payload.mjs>), got undefined' )
    } )


    test( 'empty outDir is a hard error', async () => {
        await expect( PromptGeneratorCli.run( {
            'configPath': fixtureConfigPath( { 'name': 'cli-config-happy.mjs' } ),
            'outDir': '   '
        } ) ).rejects.toThrow( 'outDir: must be a non-empty string (--out=<dir>), got string' )
    } )


    test( 'both arguments missing reports both findings in one error', async () => {
        await expect( PromptGeneratorCli.run( { 'configPath': undefined, 'outDir': undefined } ) )
            .rejects.toThrow( /configPath: must be a non-empty string.*outDir: must be a non-empty string/ )
    } )
} )
