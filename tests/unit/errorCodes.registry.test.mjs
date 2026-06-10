/**
 * Registry conformity + public export surface (PRD-004 A3/A6 + evaluation INFO-2).
 *
 * Three concerns:
 *   1. the PGEN registry itself: 19 deep-frozen entries, PREFIX-NUMBER
 *      format, category/description/severity per entry
 *   2. static source scan (INFO-2): every 'PGEN-XXX' literal used anywhere
 *      in src/ exists in the registry (no unknown code) AND every registry
 *      code is used by PromptGenerator.mjs (no dead code)
 *   3. the public export surface of src/index.mjs
 */

import { describe, test, expect } from '@jest/globals'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import * as publicApi from '../../src/index.mjs'
import { ERROR_CODES } from '../../src/data/errorCodes.mjs'
import { PromptGenerator, DEFAULT_MAX_PROMPT_LENGTH, DEFAULT_MAX_PLACEHOLDER_VALUE_LENGTH } from '../../src/PromptGenerator.mjs'


const srcDir = fileURLToPath( new URL( '../../src/', import.meta.url ) )


const EXPECTED_CODES = [
    'PGEN-001', 'PGEN-002', 'PGEN-003', 'PGEN-004', 'PGEN-005',
    'PGEN-010', 'PGEN-011', 'PGEN-012', 'PGEN-013',
    'PGEN-020', 'PGEN-021',
    'PGEN-030', 'PGEN-031', 'PGEN-032', 'PGEN-033',
    'PGEN-040',
    'PGEN-050', 'PGEN-051', 'PGEN-052'
]


const EXPECTED_CATEGORIES = {
    'PGEN-001': 'parameter',
    'PGEN-002': 'parameter',
    'PGEN-003': 'parameter',
    'PGEN-004': 'parameter',
    'PGEN-005': 'composition',
    'PGEN-010': 'template',
    'PGEN-011': 'template',
    'PGEN-012': 'template',
    'PGEN-013': 'template',
    'PGEN-020': 'source-file',
    'PGEN-021': 'source-file',
    'PGEN-030': 'source-function',
    'PGEN-031': 'source-function',
    'PGEN-032': 'source-function',
    'PGEN-033': 'source-function',
    'PGEN-040': 'torso',
    'PGEN-050': 'limits',
    'PGEN-051': 'limits',
    'PGEN-052': 'limits'
}


const readSourceFiles = async () => {
    const entries = await readdir( srcDir, { 'recursive': true } )
    const mjsFiles = entries
        .filter( ( entry ) => {
            const isModule = entry.endsWith( '.mjs' )

            return isModule
        } )
    const files = await Promise.all( mjsFiles
        .map( async ( relativePath ) => {
            const content = await readFile( join( srcDir, relativePath ), 'utf-8' )

            return { relativePath, content }
        } )
    )

    return { files }
}


describe( 'PGEN registry — structure and conformity', () => {
    test( 'the registry contains exactly the 19 expected codes', () => {
        const codes = Object.keys( ERROR_CODES ).sort()

        expect( codes ).toEqual( EXPECTED_CODES.slice().sort() )
        expect( codes ).toHaveLength( 19 )
    } )


    test( 'every code follows the PREFIX-NUMBER format PGEN-XXX (three digits)', () => {
        const violations = Object.keys( ERROR_CODES )
            .filter( ( code ) => {
                const isValid = /^PGEN-\d{3}$/.test( code )

                return isValid === false
            } )

        expect( violations ).toEqual( [] )
    } )


    test( 'every entry carries a non-empty category, description and severity ERROR', () => {
        const violations = Object.entries( ERROR_CODES )
            .filter( ( [ , entry ] ) => {
                const isValid = entry.severity === 'ERROR'
                    && typeof entry.category === 'string' && entry.category.trim() !== ''
                    && typeof entry.description === 'string' && entry.description.trim() !== ''

                return isValid === false
            } )
            .map( ( [ code ] ) => {
                return code
            } )

        expect( violations ).toEqual( [] )
    } )


    test.each( Object.entries( EXPECTED_CATEGORIES ) )( '%s belongs to category %s (number-range convention)', ( code, category ) => {
        expect( ERROR_CODES[ code ].category ).toBe( category )
    } )


    test( 'the registry and every entry are frozen (deep-frozen)', () => {
        expect( Object.isFrozen( ERROR_CODES ) ).toBe( true )

        const unfrozenEntries = Object.entries( ERROR_CODES )
            .filter( ( [ , entry ] ) => {
                const isFrozen = Object.isFrozen( entry )

                return isFrozen === false
            } )
            .map( ( [ code ] ) => {
                return code
            } )

        expect( unfrozenEntries ).toEqual( [] )
    } )


    test( 'mutation attempts do not change the registry', () => {
        const mutate = () => {
            ERROR_CODES[ 'PGEN-999' ] = { 'category': 'rogue', 'description': 'rogue', 'severity': 'ERROR' }
        }
        const mutateEntry = () => {
            ERROR_CODES[ 'PGEN-001' ].severity = 'INFO'
        }

        expect( mutate ).toThrow()
        expect( mutateEntry ).toThrow()
        expect( ERROR_CODES[ 'PGEN-999' ] ).toBeUndefined()
        expect( ERROR_CODES[ 'PGEN-001' ].severity ).toBe( 'ERROR' )
    } )
} )


describe( 'static source scan (INFO-2) — literals vs registry', () => {
    test( 'every PGEN literal used anywhere in src/ exists in the registry (no unknown code)', async () => {
        const { files } = await readSourceFiles()
        const registryCodes = Object.keys( ERROR_CODES )

        const unknownLiterals = files
            .flatMap( ( { relativePath, content } ) => {
                const literals = Array.from( content.matchAll( /PGEN-\d{3}/g ) )
                    .map( ( match ) => {
                        return match[ 0 ]
                    } )
                const unknown = literals
                    .filter( ( literal ) => {
                        const isKnown = registryCodes.includes( literal )

                        return isKnown === false
                    } )
                    .map( ( literal ) => {
                        return `${relativePath}: ${literal}`
                    } )

                return unknown
            } )

        expect( unknownLiterals ).toEqual( [] )
    } )


    test( 'every registry code is used as a quoted literal in PromptGenerator.mjs (no dead code)', async () => {
        const { files } = await readSourceFiles()
        const generatorFile = files
            .find( ( { relativePath } ) => {
                const isGenerator = relativePath.endsWith( 'PromptGenerator.mjs' )

                return isGenerator
            } )

        expect( generatorFile ).toBeDefined()

        const usedCodes = Array.from( generatorFile.content.matchAll( /'(PGEN-\d{3})'/g ) )
            .map( ( match ) => {
                return match[ 1 ]
            } )
        const deadCodes = Object.keys( ERROR_CODES )
            .filter( ( code ) => {
                const isUsed = usedCodes.includes( code )

                return isUsed === false
            } )

        expect( deadCodes ).toEqual( [] )
    } )
} )


describe( 'public export surface — src/index.mjs', () => {
    test( 'index.mjs exports exactly the four documented names', () => {
        const exportedNames = Object.keys( publicApi ).sort()

        expect( exportedNames ).toEqual( [
            'DEFAULT_MAX_PLACEHOLDER_VALUE_LENGTH',
            'DEFAULT_MAX_PROMPT_LENGTH',
            'ERROR_CODES',
            'PromptGenerator'
        ] )
    } )


    test( 'the exports are identical to their source modules (no copies)', () => {
        expect( publicApi.PromptGenerator ).toBe( PromptGenerator )
        expect( publicApi.ERROR_CODES ).toBe( ERROR_CODES )
        expect( publicApi.DEFAULT_MAX_PROMPT_LENGTH ).toBe( DEFAULT_MAX_PROMPT_LENGTH )
        expect( publicApi.DEFAULT_MAX_PLACEHOLDER_VALUE_LENGTH ).toBe( DEFAULT_MAX_PLACEHOLDER_VALUE_LENGTH )
    } )


    test( 'PromptGenerator.generate is the public static method', () => {
        expect( typeof publicApi.PromptGenerator.generate ).toBe( 'function' )
    } )
} )
