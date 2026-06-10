/**
 * Tests for the example functions in examples/usecase-about/ (PRD-006
 * requirement 9). The functions are consumer examples, NOT core API —
 * they are tested against a fixture mini-tree under
 * tests/unit/fixtures/grading-mini/ (dummy responses, no copies of real
 * API data) so the suite never depends on workspace _grading data.
 *
 * Covers:
 *   - happy path: contract shape, due-diligence chain order
 *     (tool -> schema -> namespace), every test path referenced,
 *     no response content embedded, deterministic output
 *   - negative: missing namespace dir, empty namespace dir (no schemas),
 *     tool without tests, invalid arguments
 *   - embedAboutTemplate: lossless slot rewrite (no remaining braces),
 *     source file untouched, missing/empty file errors
 *
 * Runtime-created negative trees go to tests/.tmp-about/ — its own temp
 * root (repo-internal, gitignored) to avoid races with other suites.
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildStepPlan, embedAboutTemplate } from '../../examples/usecase-about/aboutPromptInputs.mjs'


const gradingProvidersDir = fileURLToPath( new URL( './fixtures/grading-mini', import.meta.url ) )
const aboutTemplateMiniPath = fileURLToPath( new URL( './fixtures/about-template-mini.md', import.meta.url ) )

const tmpRoot = fileURLToPath( new URL( '../.tmp-about/', import.meta.url ) )


beforeAll( async () => {
    await mkdir( tmpRoot, { 'recursive': true } )
} )

afterAll( async () => {
    await rm( tmpRoot, { 'recursive': true, 'force': true } )
} )


describe( 'buildStepPlan — happy path against the grading-mini fixture', () => {
    let result

    beforeAll( async () => {
        result = await buildStepPlan( { 'namespace': 'demo-ns', gradingProvidersDir } )
    } )


    test( 'fulfills the exact { status, text } contract with non-empty text', () => {
        expect( Object.keys( result ).sort() ).toEqual( [ 'status', 'text' ] )
        expect( result.status ).toBe( true )
        expect( typeof result.text ).toBe( 'string' )
        expect( result.text.trim() ).not.toBe( '' )
    } )


    test( 'references every test file of the namespace by path', () => {
        const expectedPaths = [
            `${gradingProvidersDir}/demo-ns/schema-alpha/tools/tool-a/tests/test-1.json`,
            `${gradingProvidersDir}/demo-ns/schema-alpha/tools/tool-a/tests/test-2.json`,
            `${gradingProvidersDir}/demo-ns/schema-alpha/tools/tool-b/tests/test-1.json`,
            `${gradingProvidersDir}/demo-ns/schema-beta/tools/tool-c/tests/test-1.json`,
            `${gradingProvidersDir}/demo-ns/schema-beta/tools/tool-c/tests/test-2.json`
        ]

        expectedPaths
            .forEach( ( expectedPath ) => { expect( result.text ).toContain( expectedPath ) } )
    } )


    test( 'orders the chain tool -> schema -> namespace with schemas as separate groups', () => {
        const { text } = result
        const toolStepA = text.indexOf( 'Read the following test files of tool `tool-a`' )
        const toolStepB = text.indexOf( 'Read the following test files of tool `tool-b`' )
        const schemaStepAlpha = text.indexOf( 'From all tool overviews of schema `schema-alpha`, write a schema description.' )
        const toolStepC = text.indexOf( 'Read the following test files of tool `tool-c`' )
        const schemaStepBeta = text.indexOf( 'From all tool overviews of schema `schema-beta`, write a schema description.' )
        const namespaceStep = text.indexOf( 'From all schema descriptions, write the namespace About by filling the embedded template.' )

        const positions = [ toolStepA, toolStepB, schemaStepAlpha, toolStepC, schemaStepBeta, namespaceStep ]
        positions
            .forEach( ( position ) => { expect( position ).toBeGreaterThan( -1 ) } )

        expect( toolStepA ).toBeLessThan( toolStepB )
        expect( toolStepB ).toBeLessThan( schemaStepAlpha )
        expect( schemaStepAlpha ).toBeLessThan( toolStepC )
        expect( toolStepC ).toBeLessThan( schemaStepBeta )
        expect( schemaStepBeta ).toBeLessThan( namespaceStep )

        expect( text ).toContain( 'Schema 1 of 2: `schema-alpha`' )
        expect( text ).toContain( 'Schema 2 of 2: `schema-beta`' )
        expect( text ).toContain( 'tool overview' )
    } )


    test( 'embeds NO response content and ignores namespace-level files', () => {
        expect( result.text ).not.toContain( 'alpha tool-a test-1' )
        expect( result.text ).not.toContain( 'dummy' )
        expect( result.text ).not.toContain( 'index.json' )
    } )


    test( 'is deterministic — a second run produces the identical text', async () => {
        const secondResult = await buildStepPlan( { 'namespace': 'demo-ns', gradingProvidersDir } )

        expect( secondResult.text ).toBe( result.text )
    } )
} )


describe( 'buildStepPlan — negative cases', () => {
    test( 'throws with path context when the namespace directory is missing', async () => {
        await expect( buildStepPlan( { 'namespace': 'no-such-ns', gradingProvidersDir } ) )
            .rejects.toThrow( `directory is missing or not readable at '${gradingProvidersDir}/no-such-ns'` )
    } )


    test( 'throws when the namespace directory contains no schema directories', async () => {
        const emptyRoot = join( tmpRoot, 'empty-case' )
        await mkdir( join( emptyRoot, 'empty-ns' ), { 'recursive': true } )

        await expect( buildStepPlan( { 'namespace': 'empty-ns', 'gradingProvidersDir': emptyRoot } ) )
            .rejects.toThrow( `namespace 'empty-ns' has no schema directories at '${emptyRoot}/empty-ns'` )
    } )


    test( 'throws when a tool has no test-N.json files', async () => {
        const noTestsRoot = join( tmpRoot, 'no-tests-case' )
        await mkdir( join( noTestsRoot, 'ns-x', 'schema-x', 'tools', 'tool-x', 'tests' ), { 'recursive': true } )

        await expect( buildStepPlan( { 'namespace': 'ns-x', 'gradingProvidersDir': noTestsRoot } ) )
            .rejects.toThrow( `tool 'tool-x' has no test-N.json files at '${noTestsRoot}/ns-x/schema-x/tools/tool-x/tests'` )
    } )


    test( 'throws when a schema has no tools directory', async () => {
        const noToolsRoot = join( tmpRoot, 'no-tools-case' )
        await mkdir( join( noToolsRoot, 'ns-y', 'schema-y' ), { 'recursive': true } )

        await expect( buildStepPlan( { 'namespace': 'ns-y', 'gradingProvidersDir': noToolsRoot } ) )
            .rejects.toThrow( `directory is missing or not readable at '${noToolsRoot}/ns-y/schema-y/tools'` )
    } )


    test( 'throws on invalid arguments (non-string / empty)', async () => {
        await expect( buildStepPlan( { 'namespace': undefined, gradingProvidersDir } ) )
            .rejects.toThrow( 'namespace: must be a non-empty string' )
        await expect( buildStepPlan( { 'namespace': 'demo-ns', 'gradingProvidersDir': '   ' } ) )
            .rejects.toThrow( 'gradingProvidersDir: must be a non-empty string' )
    } )
} )


describe( 'embedAboutTemplate', () => {
    test( 'rewrites every slot delimiter — no remaining braces, slots preserved', async () => {
        const result = await embedAboutTemplate( { 'aboutTemplatePath': aboutTemplateMiniPath } )

        expect( Object.keys( result ).sort() ).toEqual( [ 'status', 'text' ] )
        expect( result.status ).toBe( true )
        expect( result.text ).not.toContain( '{{' )
        expect( result.text ).not.toContain( '}}' )
        expect( result.text ).toContain( '[[Namespace Display Name]]' )
        expect( result.text ).toContain( '<!-- mini about template fixture — authoring hint comment -->' )
    } )


    test( 'leaves the source template file unchanged (read-only input)', async () => {
        const before = await readFile( aboutTemplateMiniPath, 'utf-8' )
        await embedAboutTemplate( { 'aboutTemplatePath': aboutTemplateMiniPath } )
        const after = await readFile( aboutTemplateMiniPath, 'utf-8' )

        expect( after ).toBe( before )
        expect( after ).toContain( '{{Namespace Display Name}}' )
    } )


    test( 'throws with path context when the template file is missing', async () => {
        const missingPath = join( tmpRoot, 'missing-template.md' )

        await expect( embedAboutTemplate( { 'aboutTemplatePath': missingPath } ) )
            .rejects.toThrow( `about template is missing or not readable at '${missingPath}'` )
    } )


    test( 'throws on an invalid path argument', async () => {
        await expect( embedAboutTemplate( { 'aboutTemplatePath': '' } ) )
            .rejects.toThrow( 'aboutTemplatePath: must be a non-empty string' )
    } )
} )
