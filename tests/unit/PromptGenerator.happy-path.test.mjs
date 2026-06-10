/**
 * Happy-path tests for PromptGenerator.generate — the only public method
 * (PRD-004 A3 + A4).
 *
 * Covers:
 *   - { prompt, metadata } result shape (object return, never primitive)
 *   - all three placeholder sources: string, file, function (+ one combined run)
 *   - template given as string AND as file
 *   - metadata integrity: source, length, sha256 hash — deterministic
 *     (same input -> same hash) and sensitive (other content -> other hash)
 *   - bidirectional coverage, positive case (token set === key set)
 *   - explicit limits overrides on the happy path (no silent defaults)
 *   - runtime-created sources strictly under tests/.tmp (repo-internal,
 *     created in beforeAll, removed in afterAll — Memo 032 test isolation)
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { PromptGenerator, DEFAULT_MAX_PROMPT_LENGTH, DEFAULT_MAX_PLACEHOLDER_VALUE_LENGTH } from '../../src/index.mjs'


const fixturePath = ( { name } ) => {
    const resolved = fileURLToPath( new URL( `../fixtures/${name}`, import.meta.url ) )

    return resolved
}


const tmpDir = fileURLToPath( new URL( '../.tmp/', import.meta.url ) )


const sha256Hex = ( { text } ) => {
    const hash = createHash( 'sha256' )
        .update( text, 'utf8' )
        .digest( 'hex' )

    return hash
}


describe( 'PromptGenerator.generate — result shape', () => {
    test( 'returns an object with exactly the keys { prompt, metadata }', async () => {
        const result = await PromptGenerator.generate( {
            'template': { 'type': 'string', 'value': 'Value: {{A}}' },
            'placeholders': { 'A': { 'type': 'string', 'value': 'alpha' } }
        } )

        expect( typeof result ).toBe( 'object' )
        expect( Object.keys( result ).sort() ).toEqual( [ 'metadata', 'prompt' ] )
        expect( typeof result.prompt ).toBe( 'string' )
        expect( typeof result.metadata ).toBe( 'object' )
    } )


    test( 'metadata has the top-level shape { template, placeholders, prompt }', async () => {
        const { metadata } = await PromptGenerator.generate( {
            'template': { 'type': 'string', 'value': 'Value: {{A}}' },
            'placeholders': { 'A': { 'type': 'string', 'value': 'alpha' } }
        } )

        expect( Object.keys( metadata ).sort() ).toEqual( [ 'placeholders', 'prompt', 'template' ] )
    } )
} )


describe( 'placeholder sources — happy path', () => {
    test( 'string source: value appears exactly at the placeholder position', async () => {
        const { prompt } = await PromptGenerator.generate( {
            'template': { 'type': 'string', 'value': 'BEFORE {{NAME}} AFTER' },
            'placeholders': { 'NAME': { 'type': 'string', 'value': 'exact-string-value' } }
        } )

        expect( prompt ).toBe( 'BEFORE exact-string-value AFTER' )
    } )


    test( 'file source: fixture content is inserted byte-exactly', async () => {
        const personaPath = fixturePath( { 'name': 'persona-block.md' } )
        const personaContent = await readFile( personaPath, 'utf-8' )

        const { prompt } = await PromptGenerator.generate( {
            'template': { 'type': 'string', 'value': 'BEFORE\n{{PERSONA}}\nAFTER' },
            'placeholders': { 'PERSONA': { 'type': 'file', 'filePath': personaPath } }
        } )

        expect( prompt ).toBe( `BEFORE\n${personaContent}\nAFTER` )
    } )


    test( 'function source: args are passed through and text appears in the prompt', async () => {
        let receivedArgs
        const buildStepPlan = ( args ) => {
            receivedArgs = args
            const text = `1. inspect ${args.namespace}\n2. write report`

            return { 'status': true, 'text': text }
        }

        const { prompt } = await PromptGenerator.generate( {
            'template': { 'type': 'string', 'value': 'Plan:\n{{STEP_PLAN}}' },
            'placeholders': { 'STEP_PLAN': { 'type': 'function', 'fn': buildStepPlan, 'args': { 'namespace': 'moralis' } } }
        } )

        expect( receivedArgs ).toEqual( { 'namespace': 'moralis' } )
        expect( prompt ).toBe( 'Plan:\n1. inspect moralis\n2. write report' )
    } )


    test( 'function source without args: fn is called with undefined', async () => {
        let receivedArgs = 'sentinel-not-touched'
        const buildBlock = ( args ) => {
            receivedArgs = args

            return { 'status': true, 'text': 'block without args' }
        }

        const { prompt } = await PromptGenerator.generate( {
            'template': { 'type': 'string', 'value': 'X {{BLOCK}} Y' },
            'placeholders': { 'BLOCK': { 'type': 'function', 'fn': buildBlock } }
        } )

        expect( receivedArgs ).toBeUndefined()
        expect( prompt ).toBe( 'X block without args Y' )
    } )


    test( 'combined run: string + file + function sources in one payload (template from file)', async () => {
        const buildStepPlan = ( { namespace } ) => {
            return { 'status': true, 'text': `1. inspect ${namespace}\n2. write report` }
        }

        const { prompt, metadata } = await PromptGenerator.generate( {
            'template': { 'type': 'file', 'filePath': fixturePath( { 'name': 'template-happy.md' } ) },
            'placeholders': {
                'NAMESPACE': { 'type': 'string', 'value': 'example-namespace' },
                'PERSONA_BLOCK': { 'type': 'file', 'filePath': fixturePath( { 'name': 'persona-block.md' } ) },
                'STEP_PLAN': { 'type': 'function', 'fn': buildStepPlan, 'args': { 'namespace': 'example-namespace' } }
            }
        } )

        expect( prompt ).toContain( 'Namespace: example-namespace' )
        expect( prompt ).toContain( 'precise, methodical engineer' )
        expect( prompt ).toContain( '1. inspect example-namespace' )
        expect( prompt ).not.toContain( '{{' )
        expect( metadata.template.source ).toBe( 'file' )
        expect( metadata.placeholders.NAMESPACE.source ).toBe( 'string' )
        expect( metadata.placeholders.PERSONA_BLOCK.source ).toBe( 'file' )
        expect( metadata.placeholders.STEP_PLAN.source ).toBe( 'function' )
    } )


    test( 'duplicate token occurrences are all replaced by the same value', async () => {
        const { prompt } = await PromptGenerator.generate( {
            'template': { 'type': 'string', 'value': '{{A}} and again {{A}}' },
            'placeholders': { 'A': { 'type': 'string', 'value': 'twice' } }
        } )

        expect( prompt ).toBe( 'twice and again twice' )
    } )
} )


describe( 'template sources — happy path', () => {
    test( 'template as string source', async () => {
        const { prompt, metadata } = await PromptGenerator.generate( {
            'template': { 'type': 'string', 'value': 'Inline template: {{A}}' },
            'placeholders': { 'A': { 'type': 'string', 'value': 'value' } }
        } )

        expect( prompt ).toBe( 'Inline template: value' )
        expect( metadata.template.source ).toBe( 'string' )
        expect( metadata.template.filePath ).toBeUndefined()
    } )


    test( 'template as file source carries its filePath in the metadata', async () => {
        const templatePath = fixturePath( { 'name': 'template-happy.md' } )
        const templateContent = await readFile( templatePath, 'utf-8' )
        const buildStepPlan = () => {
            return { 'status': true, 'text': 'steps' }
        }

        const { metadata } = await PromptGenerator.generate( {
            'template': { 'type': 'file', 'filePath': templatePath },
            'placeholders': {
                'NAMESPACE': { 'type': 'string', 'value': 'ns' },
                'PERSONA_BLOCK': { 'type': 'file', 'filePath': fixturePath( { 'name': 'persona-block.md' } ) },
                'STEP_PLAN': { 'type': 'function', 'fn': buildStepPlan }
            }
        } )

        expect( metadata.template.source ).toBe( 'file' )
        expect( metadata.template.filePath ).toBe( templatePath )
        expect( metadata.template.length ).toBe( templateContent.length )
        expect( metadata.template.hash ).toBe( sha256Hex( { 'text': templateContent } ) )
    } )
} )


describe( 'metadata integrity — source, length, hash', () => {
    test( 'per-placeholder metadata carries source, length and a sha256 hex hash', async () => {
        const personaPath = fixturePath( { 'name': 'persona-block.md' } )
        const personaContent = await readFile( personaPath, 'utf-8' )
        const buildBlock = ( { topic } ) => {
            return { 'status': true, 'text': `about ${topic}` }
        }

        const { prompt, metadata } = await PromptGenerator.generate( {
            'template': { 'type': 'string', 'value': '{{NAME}} / {{PERSONA}} / {{BLOCK}}' },
            'placeholders': {
                'NAME': { 'type': 'string', 'value': 'alpha' },
                'PERSONA': { 'type': 'file', 'filePath': personaPath },
                'BLOCK': { 'type': 'function', 'fn': buildBlock, 'args': { 'topic': 'testing' } }
            }
        } )

        expect( metadata.placeholders.NAME ).toEqual( {
            'source': 'string',
            'length': 'alpha'.length,
            'hash': sha256Hex( { 'text': 'alpha' } )
        } )
        expect( metadata.placeholders.PERSONA.source ).toBe( 'file' )
        expect( metadata.placeholders.PERSONA.filePath ).toBe( personaPath )
        expect( metadata.placeholders.PERSONA.length ).toBe( personaContent.length )
        expect( metadata.placeholders.PERSONA.hash ).toBe( sha256Hex( { 'text': personaContent } ) )
        expect( metadata.placeholders.BLOCK.source ).toBe( 'function' )
        expect( metadata.placeholders.BLOCK.functionName ).toBe( 'buildBlock' )
        expect( metadata.placeholders.BLOCK.length ).toBe( 'about testing'.length )
        expect( metadata.prompt.source ).toBe( 'generated' )
        expect( metadata.prompt.length ).toBe( prompt.length )
        expect( metadata.prompt.hash ).toBe( sha256Hex( { 'text': prompt } ) )
        expect( metadata.prompt.hash ).toMatch( /^[0-9a-f]{64}$/ )
    } )


    test( 'anonymous function sources are recorded as <anonymous>', async () => {
        const anonymousFn = [ () => {
            return { 'status': true, 'text': 'from anonymous' }
        } ][ 0 ]

        const { metadata } = await PromptGenerator.generate( {
            'template': { 'type': 'string', 'value': 'X {{BLOCK}}' },
            'placeholders': { 'BLOCK': { 'type': 'function', 'fn': anonymousFn } }
        } )

        expect( metadata.placeholders.BLOCK.functionName ).toBe( '<anonymous>' )
    } )


    test( 'hash determinism: identical input produces identical hashes', async () => {
        const payloadFactory = () => {
            const payload = {
                'template': { 'type': 'string', 'value': 'Value: {{A}}' },
                'placeholders': { 'A': { 'type': 'string', 'value': 'stable-content' } }
            }

            return payload
        }

        const first = await PromptGenerator.generate( payloadFactory() )
        const second = await PromptGenerator.generate( payloadFactory() )

        expect( first.metadata.prompt.hash ).toBe( second.metadata.prompt.hash )
        expect( first.metadata.placeholders.A.hash ).toBe( second.metadata.placeholders.A.hash )
        expect( first.metadata.template.hash ).toBe( second.metadata.template.hash )
    } )


    test( 'hash sensitivity: different content produces different hashes', async () => {
        const buildPayload = ( { value } ) => {
            const payload = {
                'template': { 'type': 'string', 'value': 'Value: {{A}}' },
                'placeholders': { 'A': { 'type': 'string', 'value': value } }
            }

            return payload
        }

        const first = await PromptGenerator.generate( buildPayload( { 'value': 'content one' } ) )
        const second = await PromptGenerator.generate( buildPayload( { 'value': 'content two' } ) )

        expect( first.metadata.placeholders.A.hash ).not.toBe( second.metadata.placeholders.A.hash )
        expect( first.metadata.prompt.hash ).not.toBe( second.metadata.prompt.hash )
    } )
} )


describe( 'bidirectional coverage — positive case', () => {
    test( 'template token set identical to payload key set succeeds', async () => {
        const { prompt } = await PromptGenerator.generate( {
            'template': { 'type': 'string', 'value': '{{ONE}} {{TWO}} {{THREE}}' },
            'placeholders': {
                'ONE': { 'type': 'string', 'value': '1' },
                'TWO': { 'type': 'string', 'value': '2' },
                'THREE': { 'type': 'string', 'value': '3' }
            }
        } )

        expect( prompt ).toBe( '1 2 3' )
    } )
} )


describe( 'limits — explicit overrides on the happy path', () => {
    test( 'exported defaults match the documented hard guards', () => {
        expect( DEFAULT_MAX_PROMPT_LENGTH ).toBe( 1_000_000 )
        expect( DEFAULT_MAX_PLACEHOLDER_VALUE_LENGTH ).toBe( 500_000 )
    } )


    test( 'generous explicit limits pass', async () => {
        const { prompt } = await PromptGenerator.generate( {
            'template': { 'type': 'string', 'value': 'Value: {{A}}' },
            'placeholders': { 'A': { 'type': 'string', 'value': 'alpha' } },
            'limits': { 'maxPromptLength': 10_000, 'maxPlaceholderValueLength': 1_000 }
        } )

        expect( prompt ).toBe( 'Value: alpha' )
    } )


    test( 'an empty limits object falls back to both documented defaults', async () => {
        const { prompt } = await PromptGenerator.generate( {
            'template': { 'type': 'string', 'value': 'Value: {{A}}' },
            'placeholders': { 'A': { 'type': 'string', 'value': 'alpha' } },
            'limits': {}
        } )

        expect( prompt ).toBe( 'Value: alpha' )
    } )


    test( 'a single-key limits override keeps the other documented default', async () => {
        const { prompt } = await PromptGenerator.generate( {
            'template': { 'type': 'string', 'value': 'Value: {{A}}' },
            'placeholders': { 'A': { 'type': 'string', 'value': 'alpha' } },
            'limits': { 'maxPromptLength': 100 }
        } )

        expect( prompt ).toBe( 'Value: alpha' )
    } )
} )


describe( 'runtime sources under tests/.tmp — repo-internal isolation (Memo 032)', () => {
    const runtimeFilePath = `${tmpDir}runtime-source.md`

    beforeAll( async () => {
        await mkdir( tmpDir, { 'recursive': true } )
        await writeFile( runtimeFilePath, 'runtime-generated source content\n', 'utf-8' )
    } )

    afterAll( async () => {
        await rm( tmpDir, { 'recursive': true, 'force': true } )
    } )


    test( 'a file source created at runtime under tests/.tmp is read and inserted', async () => {
        const { prompt, metadata } = await PromptGenerator.generate( {
            'template': { 'type': 'string', 'value': 'DOC:\n{{DOC}}' },
            'placeholders': { 'DOC': { 'type': 'file', 'filePath': runtimeFilePath } }
        } )

        expect( prompt ).toBe( 'DOC:\nruntime-generated source content\n' )
        expect( metadata.placeholders.DOC.source ).toBe( 'file' )
        expect( metadata.placeholders.DOC.filePath ).toBe( runtimeFilePath )
    } )
} )
