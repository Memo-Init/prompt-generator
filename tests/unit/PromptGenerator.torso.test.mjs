/**
 * Property-like torso tests (PRD-004 A7) — no template construct survives
 * substitution (rule 3, generalised APL-010).
 *
 * Torso semantics under test (documented contract of the implementation):
 * the post-substitution scan flags EVERY complete {{...}} sequence in the
 * composed prompt (PGEN-040), regardless of grammar. Substitution is
 * single-pass — values are inert and never re-substituted, so a token
 * carried in by any source survives composition and fails the torso check.
 *
 * Unpaired braces ('{{' without a later '}}', or '}}' without an earlier
 * '{{') are literal content by design: flagging a lone '}}' would
 * false-positive on legitimate nested JSON such as {"a":{"b":1}} and
 * thereby violate the negative-control requirement (A7.4). The spanning
 * tests below prove that an unpaired '{{' becomes a torso as soon as ANY
 * '}}' follows anywhere in the prompt — across placeholder boundaries too.
 *
 * Four sections:
 *   1. variant matrix (test.each) — injected via string value
 *   2. injection paths — template / file content / function text
 *   3. seed-fixed deterministic generator (>= 50 variants + sanitized twins)
 *   4. negative controls — single braces and nested JSON never false-positive
 */

import { describe, test, expect } from '@jest/globals'
import { fileURLToPath } from 'node:url'

import { PromptGenerator } from '../../src/index.mjs'


const fixturePath = ( { name } ) => {
    const resolved = fileURLToPath( new URL( `../fixtures/${name}`, import.meta.url ) )

    return resolved
}


const buildPayloadWithValue = ( { value } ) => {
    const payload = {
        'template': { 'type': 'string', 'value': 'Header {{CONTENT}} Footer' },
        'placeholders': { 'CONTENT': { 'type': 'string', 'value': value } }
    }

    return payload
}


describe( 'torso variant matrix — injected via string value, all must fail PGEN-040', () => {
    const variants = [
        [ 'simple leftover token', 'before {{LEFTOVER}} after' ],
        [ 'inner whitespace both sides', 'before {{ LEFTOVER }} after' ],
        [ 'inner whitespace right side', 'before {{LEFTOVER }} after' ],
        [ 'inner tab', 'before {{\tX}} after' ],
        [ 'nested token {{A{{B}}C}}', 'before {{A{{B}}C}} after' ],
        [ 'empty token {{}}', 'before {{}} after' ],
        [ 'multiline token', 'before {{A\nB}} after' ],
        [ 'special characters and digits', 'before {{A-B.C_1}} after' ],
        [ 'unclosed {{OPEN with a later }} forms a spanning torso', 'before {{OPEN never closed, but a later }} closes the span' ]
    ]


    test.each( variants )( '%s', async ( name, value ) => {
        await expect( PromptGenerator.generate( buildPayloadWithValue( { value } ) ) )
            .rejects.toThrow( /PGEN-040/ )
    } )


    test( 'multiple leftover tokens are each reported in the same throw', async () => {
        let caught
        try {
            await PromptGenerator.generate( buildPayloadWithValue( { 'value': 'one {{X}} two {{Y}} three' } ) )
        } catch( error ) {
            caught = error
        }

        expect( caught ).toBeInstanceOf( Error )
        expect( caught.message ).toContain( '{{X}}' )
        expect( caught.message ).toContain( '{{Y}}' )
        expect( caught.message ).toMatch( /PGEN-040/ )
    } )


    test( 'a lone }} pairs with an earlier {{ across placeholder boundaries', async () => {
        await expect( PromptGenerator.generate( {
            'template': { 'type': 'string', 'value': '{{LEFT}} middle {{RIGHT}}' },
            'placeholders': {
                'LEFT': { 'type': 'string', 'value': 'open {{ brace' },
                'RIGHT': { 'type': 'string', 'value': 'close }} brace' }
            }
        } ) )
            .rejects.toThrow( /PGEN-040/ )
    } )


    test( 'the surviving token is reported verbatim — the covered value was NOT substituted into it', async () => {
        let caught
        try {
            await PromptGenerator.generate( {
                'template': { 'type': 'string', 'value': '{{A}} and {{B}}' },
                'placeholders': {
                    'A': { 'type': 'string', 'value': 'injected {{B}} token' },
                    'B': { 'type': 'string', 'value': 'bee' }
                }
            } )
        } catch( error ) {
            caught = error
        }

        expect( caught ).toBeInstanceOf( Error )
        expect( caught.message ).toContain( "'{{B}}'" )
        expect( caught.message ).not.toContain( '{{bee}}' )
    } )
} )


describe( 'injection paths — torso material from every source is caught after substitution', () => {
    test( '(a) from the template itself: nested {{A{{B}}C}} leaves a torso around the valid inner token', async () => {
        await expect( PromptGenerator.generate( {
            'template': { 'type': 'string', 'value': 'Intro {{A{{B}}C}} Outro' },
            'placeholders': { 'B': { 'type': 'string', 'value': 'bee' } }
        } ) )
            .rejects.toThrow( /PGEN-040/ )
    } )


    test( '(b) from a file source: fixture content carries an unresolved token', async () => {
        await expect( PromptGenerator.generate( {
            'template': { 'type': 'string', 'value': 'Doc: {{DOC}}' },
            'placeholders': { 'DOC': { 'type': 'file', 'filePath': fixturePath( { 'name': 'torso-injection.md' } ) } }
        } ) )
            .rejects.toThrow( /PGEN-040[\s\S]*\{\{INJECTED_FROM_FILE\}\}/ )
    } )


    test( '(c) from a function source: returned text carries an unresolved token', async () => {
        const tokenSmuggler = () => {
            return { 'status': true, 'text': 'result with {{LEFTOVER}} token' }
        }

        await expect( PromptGenerator.generate( {
            'template': { 'type': 'string', 'value': 'Block: {{BLOCK}}' },
            'placeholders': { 'BLOCK': { 'type': 'function', 'fn': tokenSmuggler } }
        } ) )
            .rejects.toThrow( /PGEN-040[\s\S]*\{\{LEFTOVER\}\}/ )
    } )
} )


// Deterministic seeded LCG — no property-testing library is allowed, so the
// "random" variants are seed-fixed and fully reproducible (same seed, same
// variants, same verdicts on every run).
const createSeededRandom = ( { seed } ) => {
    let state = seed >>> 0
    const next = () => {
        state = ( Math.imul( state, 1664525 ) + 1013904223 ) >>> 0
        const value = state / 4294967296

        return value
    }

    return { next }
}


const pickFrom = ( { list, random } ) => {
    const index = Math.floor( random.next() * list.length )

    return list[ index ]
}


const buildTorsoVariants = ( { seed, count } ) => {
    const random = createSeededRandom( { seed } )
    const keys = [ 'LEFTOVER', 'X1', 'A_B', 'TOKEN9', 'Z_9_Z' ]
    const innerWhitespace = [ '', ' ', '  ', '\t', '\n' ]
    const prefixes = [ '', 'plain text before ', 'line one\n', '{ "json": true } ' ]
    const suffixes = [ '', ' plain text after', '\nnext line', ' { "list": [ 1, 2 ] }' ]
    const shapes = [ 'plain', 'nested', 'empty' ]

    const drawn = Array.from( { 'length': count } )
        .map( () => {
            const shape = pickFrom( { 'list': shapes, random } )
            const key = pickFrom( { 'list': keys, random } )
            const wsLeft = pickFrom( { 'list': innerWhitespace, random } )
            const wsRight = pickFrom( { 'list': innerWhitespace, random } )
            const prefix = pickFrom( { 'list': prefixes, random } )
            const suffix = pickFrom( { 'list': suffixes, random } )
            const token = shape === 'plain'
                ? `{{${wsLeft}${key}${wsRight}}}`
                : shape === 'nested'
                    ? `{{N${wsLeft}{{${key}}}${wsRight}M}}`
                    : `{{${wsLeft}}}`
            const injected = `${prefix}${token}${suffix}`
            const sanitizedToken = token.replaceAll( '{', '' ).replaceAll( '}', '' )
            const sanitized = `${prefix}sanitized(${sanitizedToken})${suffix}`

            return { injected, sanitized }
        } )

    const uniqueVariants = Array.from(
        new Map( drawn
            .map( ( variant ) => {
                return [ variant.injected, variant ]
            } )
        ).values()
    )

    return { uniqueVariants }
}


describe( 'seed-fixed torso generator — every variant fails, every sanitized twin passes', () => {
    test( 'at least 50 unique seed-fixed variants all trigger PGEN-040; their brace-free twins compose cleanly', async () => {
        const { uniqueVariants } = buildTorsoVariants( { 'seed': 1311, 'count': 80 } )

        expect( uniqueVariants.length ).toBeGreaterThanOrEqual( 50 )

        await Promise.all( uniqueVariants
            .map( async ( { injected, sanitized } ) => {
                await expect( PromptGenerator.generate( buildPayloadWithValue( { 'value': injected } ) ) )
                    .rejects.toThrow( /PGEN-040/ )

                const { prompt } = await PromptGenerator.generate( buildPayloadWithValue( { 'value': sanitized } ) )
                expect( prompt ).toContain( 'sanitized(' )
                expect( prompt ).not.toMatch( /\{\{[\s\S]*?\}\}/ )
            } )
        )
    } )
} )


describe( 'negative controls — legitimate braces never trigger the torso check', () => {
    test( 'inline JSON with single braces passes and appears in the prompt', async () => {
        const jsonValue = 'config: { "key": "value", "list": [ 1, 2 ] } end'

        const { prompt } = await PromptGenerator.generate( buildPayloadWithValue( { 'value': jsonValue } ) )

        expect( prompt ).toContain( jsonValue )
    } )


    test( 'a pretty-printed JSON block from a file source passes', async () => {
        const { prompt } = await PromptGenerator.generate( {
            'template': { 'type': 'string', 'value': 'Doc: {{DOC}}' },
            'placeholders': { 'DOC': { 'type': 'file', 'filePath': fixturePath( { 'name': 'json-content.md' } ) } }
        } )

        expect( prompt ).toContain( '"name": "flowmcp-prompt-generator"' )
        expect( prompt ).toContain( '"flag": true' )
    } )


    test( 'nested one-line JSON ending in adjacent }} passes (no {{ opener anywhere)', async () => {
        const nestedJson = 'data = {"a":{"b":1}} done'

        const { prompt } = await PromptGenerator.generate( buildPayloadWithValue( { 'value': nestedJson } ) )

        expect( prompt ).toContain( nestedJson )
    } )


    test( 'documented semantics: an unpaired {{ with NO later }} is literal content', async () => {
        const unpairedOpen = 'code sample with {{OPEN and no closing pair at all'

        const { prompt } = await PromptGenerator.generate( buildPayloadWithValue( { 'value': unpairedOpen } ) )

        expect( prompt ).toContain( unpairedOpen )
    } )


    test( 'documented semantics: an unpaired }} with NO earlier {{ is literal content', async () => {
        const unpairedClose = 'closing braces }} without any opener'

        const { prompt } = await PromptGenerator.generate( buildPayloadWithValue( { 'value': unpairedClose } ) )

        expect( prompt ).toContain( unpairedClose )
    } )
} )
