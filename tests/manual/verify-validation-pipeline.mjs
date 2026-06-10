/**
 * Manual verification of the PRD-003 validation pipeline.
 *
 * Bounded, self-terminating script:
 *   - happy path (string + file + function sources) -> { prompt, metadata }
 *   - every of the 19 PGEN codes provoked at least once (negative payloads)
 *   - PGEN-030: error.cause preserved + placeholder key + function name
 *   - rule 5: type anomaly fails BEFORE composition, no prompt exists
 *   - registry consistency (19 entries, format, severity, frozen)
 *
 * Run: node tests/manual/verify-validation-pipeline.mjs
 * Exit 0 = all cases green, exit 1 = failed cases listed.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PromptGenerator, DEFAULT_MAX_PROMPT_LENGTH, DEFAULT_MAX_PLACEHOLDER_VALUE_LENGTH } from '../../src/index.mjs'
import { ERROR_CODES } from '../../src/data/errorCodes.mjs'


const currentDir = dirname( fileURLToPath( import.meta.url ) )
const fixturesDir = join( currentDir, 'fixtures' )

const EXPECTED_CODES = [
    'PGEN-001', 'PGEN-002', 'PGEN-003', 'PGEN-004', 'PGEN-005',
    'PGEN-010', 'PGEN-011', 'PGEN-012', 'PGEN-013',
    'PGEN-020', 'PGEN-021',
    'PGEN-030', 'PGEN-031', 'PGEN-032', 'PGEN-033',
    'PGEN-040',
    'PGEN-050', 'PGEN-051', 'PGEN-052'
]

const NULL_BYTE = String.fromCharCode( 0 )


// Generic negative-case runner: generate() must throw, no result may exist,
// the message must carry the expected PGEN code and the method context.
const expectThrow = async ( { expectedCode, payload, extraAssert } ) => {
    const failures = []
    let caught
    let result
    try {
        result = await PromptGenerator.generate( payload )
    } catch( error ) {
        caught = error
    }

    if( result !== undefined ) {
        failures.push( 'generate() returned a result instead of throwing' )
    }
    if( caught === undefined ) {
        failures.push( 'no error was thrown' )
        return { 'passed': false, 'detail': failures.join( ' | ' ) }
    }
    if( caught.message.includes( expectedCode ) === false ) {
        failures.push( `message does not contain ${expectedCode} — got: ${caught.message}` )
    }
    if( caught.message.startsWith( 'PromptGenerator.generate: PGEN-' ) === false && caught.message.includes( '; PGEN-' ) === false ) {
        failures.push( `message does not start with method context + PGEN code — got: ${caught.message}` )
    }
    if( extraAssert !== undefined ) {
        const { failures: extraFailures } = extraAssert( { 'error': caught } )
        extraFailures
            .forEach( ( extraFailure ) => { failures.push( extraFailure ) } )
    }

    return { 'passed': failures.length === 0, 'detail': failures.join( ' | ' ) }
}


const buildValidTemplate = ( { tokens } ) => {
    const text = tokens
        .map( ( token ) => {
            const rendered = `{{${token}}}`
            return rendered
        } )
        .join( ' and ' )

    return { 'type': 'string', 'value': `Intro. ${text}. Outro.` }
}


const cases = [
    {
        'id': 'HAPPY  3 sources (string+file+function) -> { prompt, metadata }',
        'run': async () => {
            const failures = []
            const buildStepPlan = ( { namespace } ) => {
                return { 'status': true, 'text': `1. inspect ${namespace}\n2. write report` }
            }
            const { prompt, metadata } = await PromptGenerator.generate( {
                'template': { 'type': 'file', 'filePath': join( fixturesDir, 'template-happy.md' ) },
                'placeholders': {
                    'NAMESPACE': { 'type': 'string', 'value': 'example-namespace' },
                    'PERSONA_BLOCK': { 'type': 'file', 'filePath': join( fixturesDir, 'persona-block.md' ) },
                    'STEP_PLAN': { 'type': 'function', 'fn': buildStepPlan, 'args': { 'namespace': 'example-namespace' } }
                }
            } )

            if( typeof prompt !== 'string' ) { failures.push( 'prompt is not a string' ) }
            if( prompt.includes( 'Namespace: example-namespace' ) === false ) { failures.push( 'string source was not substituted' ) }
            if( prompt.includes( 'precise, methodical engineer' ) === false ) { failures.push( 'file source was not substituted' ) }
            if( prompt.includes( '1. inspect example-namespace' ) === false ) { failures.push( 'function source was not substituted' ) }
            if( prompt.includes( '{{' ) ) { failures.push( 'prompt still contains a {{ sequence' ) }
            if( metadata.prompt.length !== prompt.length ) { failures.push( 'metadata.prompt.length mismatch' ) }
            if( /^[0-9a-f]{64}$/.test( metadata.prompt.hash ) === false ) { failures.push( 'metadata.prompt.hash is not sha256 hex' ) }
            if( metadata.template.source !== 'file' ) { failures.push( 'metadata.template.source mismatch' ) }
            if( metadata.placeholders.STEP_PLAN.functionName !== 'buildStepPlan' ) { failures.push( 'metadata functionName mismatch' ) }

            return { 'passed': failures.length === 0, 'detail': failures.join( ' | ' ) }
        }
    },
    {
        'id': 'REGISTRY  exactly 19 frozen PGEN entries, format + severity',
        'run': async () => {
            const failures = []
            const codes = Object.keys( ERROR_CODES )

            if( codes.length !== 19 ) { failures.push( `registry has ${codes.length} entries, expected 19` ) }
            const formatViolations = codes
                .filter( ( code ) => {
                    const isValid = /^PGEN-\d{3}$/.test( code )
                    return isValid === false
                } )
            if( formatViolations.length > 0 ) { failures.push( `code format violations: ${formatViolations.join( ', ' )}` ) }
            const missingCodes = EXPECTED_CODES
                .filter( ( expectedCode ) => {
                    const isPresent = codes.includes( expectedCode )
                    return isPresent === false
                } )
            if( missingCodes.length > 0 ) { failures.push( `missing codes: ${missingCodes.join( ', ' )}` ) }
            const unexpectedCodes = codes
                .filter( ( code ) => {
                    const isExpected = EXPECTED_CODES.includes( code )
                    return isExpected === false
                } )
            if( unexpectedCodes.length > 0 ) { failures.push( `unexpected codes: ${unexpectedCodes.join( ', ' )}` ) }
            const entryViolations = codes
                .filter( ( code ) => {
                    const entry = ERROR_CODES[ code ]
                    const isValid = entry.severity === 'ERROR'
                        && typeof entry.category === 'string' && entry.category.trim() !== ''
                        && typeof entry.description === 'string' && entry.description.trim() !== ''
                        && Object.isFrozen( entry )
                    return isValid === false
                } )
            if( entryViolations.length > 0 ) { failures.push( `entry violations (severity/category/description/frozen): ${entryViolations.join( ', ' )}` ) }
            if( Object.isFrozen( ERROR_CODES ) === false ) { failures.push( 'registry object is not frozen' ) }
            if( DEFAULT_MAX_PROMPT_LENGTH !== 1_000_000 ) { failures.push( 'DEFAULT_MAX_PROMPT_LENGTH is not 1_000_000' ) }
            if( DEFAULT_MAX_PLACEHOLDER_VALUE_LENGTH !== 500_000 ) { failures.push( 'DEFAULT_MAX_PLACEHOLDER_VALUE_LENGTH is not 500_000' ) }

            return { 'passed': failures.length === 0, 'detail': failures.join( ' | ' ) }
        }
    },
    {
        'id': 'PGEN-001  required payload key missing (template)',
        'run': async () => {
            const outcome = await expectThrow( {
                'expectedCode': 'PGEN-001',
                'payload': { 'placeholders': { 'A': { 'type': 'string', 'value': 'x' } } }
            } )
            return outcome
        }
    },
    {
        'id': 'PGEN-002  type mismatch (fn is not a function)',
        'run': async () => {
            const outcome = await expectThrow( {
                'expectedCode': 'PGEN-002',
                'payload': {
                    'template': buildValidTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'function', 'fn': 'not-a-function' } }
                },
                'extraAssert': ( { error } ) => {
                    const failures = []
                    if( error.message.includes( 'payload.placeholders.A.fn' ) === false ) { failures.push( 'message does not carry the parameter path' ) }
                    return { failures }
                }
            } )
            return outcome
        }
    },
    {
        'id': 'PGEN-002  invalid limits override (maxPromptLength as string)',
        'run': async () => {
            const outcome = await expectThrow( {
                'expectedCode': 'PGEN-002',
                'payload': {
                    'template': buildValidTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'string', 'value': 'x' } },
                    'limits': { 'maxPromptLength': '10' }
                }
            } )
            return outcome
        }
    },
    {
        'id': 'PGEN-003  empty string value (whitespace-only)',
        'run': async () => {
            const outcome = await expectThrow( {
                'expectedCode': 'PGEN-003',
                'payload': {
                    'template': buildValidTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'string', 'value': '   ' } }
                }
            } )
            return outcome
        }
    },
    {
        'id': 'PGEN-004  invalid source type (magic)',
        'run': async () => {
            const outcome = await expectThrow( {
                'expectedCode': 'PGEN-004',
                'payload': {
                    'template': buildValidTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'magic', 'value': 'x' } }
                }
            } )
            return outcome
        }
    },
    {
        'id': 'PGEN-005  rule 5: type anomaly caught BEFORE composition (no null in prompt)',
        'run': async () => {
            // Mutating getter: passes the stage-1 read, degrades to null at the
            // stage-3 read — exactly the anomaly the stage-4 guard exists for.
            let accessCount = 0
            const evilEntry = {
                'type': 'string',
                get value() {
                    accessCount = accessCount + 1
                    const result = accessCount === 1 ? 'looks valid on first read' : null
                    return result
                }
            }
            const outcome = await expectThrow( {
                'expectedCode': 'PGEN-005',
                'payload': {
                    'template': buildValidTemplate( { 'tokens': [ 'EVIL' ] } ),
                    'placeholders': { 'EVIL': evilEntry }
                },
                'extraAssert': ( { error } ) => {
                    const failures = []
                    if( error.message.includes( 'EVIL' ) === false ) { failures.push( 'message does not carry the placeholder key' ) }
                    if( error.message.includes( 'not a string at composition time' ) === false ) { failures.push( 'message does not state the pre-composition guard' ) }
                    return { failures }
                }
            } )
            return outcome
        }
    },
    {
        'id': 'PGEN-010  template without placeholders',
        'run': async () => {
            const outcome = await expectThrow( {
                'expectedCode': 'PGEN-010',
                'payload': {
                    'template': { 'type': 'string', 'value': 'static text without any token' },
                    'placeholders': { 'A': { 'type': 'string', 'value': 'x' } }
                }
            } )
            return outcome
        }
    },
    {
        'id': 'PGEN-011  template token not covered by payload',
        'run': async () => {
            const outcome = await expectThrow( {
                'expectedCode': 'PGEN-011',
                'payload': {
                    'template': buildValidTemplate( { 'tokens': [ 'A', 'B' ] } ),
                    'placeholders': { 'A': { 'type': 'string', 'value': 'x' } }
                }
            } )
            return outcome
        }
    },
    {
        'id': 'PGEN-012  payload key not used in template',
        'run': async () => {
            const outcome = await expectThrow( {
                'expectedCode': 'PGEN-012',
                'payload': {
                    'template': buildValidTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': {
                        'A': { 'type': 'string', 'value': 'x' },
                        'B': { 'type': 'string', 'value': 'y' }
                    }
                }
            } )
            return outcome
        }
    },
    {
        'id': 'PGEN-013  malformed token in template',
        'run': async () => {
            const outcome = await expectThrow( {
                'expectedCode': 'PGEN-013',
                'payload': {
                    'template': { 'type': 'string', 'value': 'x {{bad key}} y {{A}}' },
                    'placeholders': { 'A': { 'type': 'string', 'value': 'x' } }
                }
            } )
            return outcome
        }
    },
    {
        'id': 'PGEN-020  source file missing',
        'run': async () => {
            const outcome = await expectThrow( {
                'expectedCode': 'PGEN-020',
                'payload': {
                    'template': buildValidTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'file', 'filePath': join( fixturesDir, 'does-not-exist.md' ) } }
                }
            } )
            return outcome
        }
    },
    {
        'id': 'PGEN-021  source file empty (whitespace-only)',
        'run': async () => {
            const outcome = await expectThrow( {
                'expectedCode': 'PGEN-021',
                'payload': {
                    'template': buildValidTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'file', 'filePath': join( fixturesDir, 'empty-whitespace.md' ) } }
                }
            } )
            return outcome
        }
    },
    {
        'id': 'PGEN-030  function throws -> wrapped with key + name + cause',
        'run': async () => {
            const failingStepPlan = () => { throw new Error( 'boom' ) }
            const outcome = await expectThrow( {
                'expectedCode': 'PGEN-030',
                'payload': {
                    'template': buildValidTemplate( { 'tokens': [ 'STEP_PLAN' ] } ),
                    'placeholders': { 'STEP_PLAN': { 'type': 'function', 'fn': failingStepPlan } }
                },
                'extraAssert': ( { error } ) => {
                    const failures = []
                    if( error.message.includes( 'STEP_PLAN' ) === false ) { failures.push( 'message does not carry the placeholder key' ) }
                    if( error.message.includes( 'failingStepPlan' ) === false ) { failures.push( 'message does not carry the function name' ) }
                    if( ( error.cause instanceof Error ) === false ) { failures.push( 'error.cause is not the original Error' ) }
                    if( error.cause instanceof Error && error.cause.message !== 'boom' ) { failures.push( 'error.cause does not carry the original message' ) }
                    return { failures }
                }
            } )
            return outcome
        }
    },
    {
        'id': 'PGEN-030  function rejects (async) -> wrapped with cause',
        'run': async () => {
            const rejectingSource = async () => {
                throw new Error( 'async boom' )
            }
            const outcome = await expectThrow( {
                'expectedCode': 'PGEN-030',
                'payload': {
                    'template': buildValidTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'function', 'fn': rejectingSource } }
                },
                'extraAssert': ( { error } ) => {
                    const failures = []
                    if( ( error.cause instanceof Error ) === false ) { failures.push( 'error.cause is not the original Error' ) }
                    return { failures }
                }
            } )
            return outcome
        }
    },
    {
        'id': 'PGEN-031  function returns naked string (wrong shape)',
        'run': async () => {
            const nakedString = () => { return 'just a string' }
            const outcome = await expectThrow( {
                'expectedCode': 'PGEN-031',
                'payload': {
                    'template': buildValidTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'function', 'fn': nakedString } }
                }
            } )
            return outcome
        }
    },
    {
        'id': 'PGEN-031  function returns extra keys beyond { status, text }',
        'run': async () => {
            const driftingShape = () => { return { 'status': true, 'text': 'ok', 'extra': 1 } }
            const outcome = await expectThrow( {
                'expectedCode': 'PGEN-031',
                'payload': {
                    'template': buildValidTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'function', 'fn': driftingShape } }
                }
            } )
            return outcome
        }
    },
    {
        'id': "PGEN-032  function status is 'true' (string, not strict true)",
        'run': async () => {
            const looseStatus = () => { return { 'status': 'true', 'text': 'ok' } }
            const outcome = await expectThrow( {
                'expectedCode': 'PGEN-032',
                'payload': {
                    'template': buildValidTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'function', 'fn': looseStatus } }
                }
            } )
            return outcome
        }
    },
    {
        'id': 'PGEN-033  function text is whitespace-only',
        'run': async () => {
            const emptyText = () => { return { 'status': true, 'text': '   ' } }
            const outcome = await expectThrow( {
                'expectedCode': 'PGEN-033',
                'payload': {
                    'template': buildValidTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'function', 'fn': emptyText } }
                }
            } )
            return outcome
        }
    },
    {
        'id': 'PGEN-040  token injection via value -> torso, NOT re-substituted',
        'run': async () => {
            const outcome = await expectThrow( {
                'expectedCode': 'PGEN-040',
                'payload': {
                    'template': buildValidTemplate( { 'tokens': [ 'A', 'B' ] } ),
                    'placeholders': {
                        'A': { 'type': 'string', 'value': 'injected {{B}} token' },
                        'B': { 'type': 'string', 'value': 'bee' }
                    }
                },
                'extraAssert': ( { error } ) => {
                    const failures = []
                    if( error.message.includes( '{{B}}' ) === false ) { failures.push( 'message does not name the surviving token' ) }
                    if( error.message.includes( 'survived substitution' ) === false ) { failures.push( 'message does not state the torso check' ) }
                    return { failures }
                }
            } )
            return outcome
        }
    },
    {
        'id': 'PGEN-050  composed prompt exceeds maxPromptLength override',
        'run': async () => {
            const outcome = await expectThrow( {
                'expectedCode': 'PGEN-050',
                'payload': {
                    'template': buildValidTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'string', 'value': 'a long enough value' } },
                    'limits': { 'maxPromptLength': 10 }
                }
            } )
            return outcome
        }
    },
    {
        'id': 'PGEN-051  resolved value exceeds maxPlaceholderValueLength override',
        'run': async () => {
            const outcome = await expectThrow( {
                'expectedCode': 'PGEN-051',
                'payload': {
                    'template': buildValidTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'string', 'value': 'longer than five' } },
                    'limits': { 'maxPlaceholderValueLength': 5 }
                }
            } )
            return outcome
        }
    },
    {
        'id': 'PGEN-052  file with broken encoding (U+FFFD after utf-8 decode)',
        'run': async () => {
            const outcome = await expectThrow( {
                'expectedCode': 'PGEN-052',
                'payload': {
                    'template': buildValidTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'file', 'filePath': join( fixturesDir, 'broken-encoding.txt' ) } }
                }
            } )
            return outcome
        }
    },
    {
        'id': 'PGEN-052  string value with null byte',
        'run': async () => {
            const outcome = await expectThrow( {
                'expectedCode': 'PGEN-052',
                'payload': {
                    'template': buildValidTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'string', 'value': `broken${NULL_BYTE}value` } }
                }
            } )
            return outcome
        }
    }
]


const runAll = async () => {
    const results = []
    await cases
        .reduce( async ( previousPromise, currentCase ) => {
            await previousPromise
            let outcome
            try {
                outcome = await currentCase.run()
            } catch( error ) {
                outcome = { 'passed': false, 'detail': `case crashed: ${error.message}` }
            }
            results.push( { 'id': currentCase.id, 'passed': outcome.passed, 'detail': outcome.detail } )
        }, Promise.resolve() )

    results
        .forEach( ( { id, passed, detail } ) => {
            const mark = passed === true ? '✓' : '✗'
            const suffix = passed === true ? '' : ` — ${detail}`
            console.log( `${mark} ${id}${suffix}` )
        } )

    const failedResults = results
        .filter( ( { passed } ) => {
            return passed === false
        } )
    console.log( '' )
    console.log( `${results.length - failedResults.length}/${results.length} cases passed` )
    if( failedResults.length > 0 ) {
        console.log( 'FAILED cases:' )
        failedResults
            .forEach( ( { id, detail } ) => { console.log( `  - ${id}: ${detail}` ) } )
        process.exitCode = 1
    }
}

await runAll()
