/**
 * Error-path matrix for PromptGenerator.generate (PRD-004 A5 + A6).
 *
 * Source of truth is the implemented PGEN registry (src/data/errorCodes.mjs).
 * Every registry code is triggered by at least one negative scenario below;
 * the completeness guard fails this suite if the registry ever grows past
 * the scenario map.
 *
 * Mapping of the seven hard validation rules (Memo 131 Kap. 7) to tests:
 *
 * | Rule | Statement                                        | Covered by                                              |
 * |------|--------------------------------------------------|---------------------------------------------------------|
 * | 1    | Validation failure -> hard throw, no prompt      | 'rule 1' describe block (no partial prompt accessible)   |
 * | 2    | Empty strings forbidden (value/file/function)    | PGEN-003 scenarios, PGEN-021 scenarios, PGEN-033 scenario|
 * | 3    | No half-filled prompts (torso check)             | PGEN-040 scenario here + PromptGenerator.torso.test.mjs  |
 * | 4    | Function contract double-checked (a-d)           | PGEN-031/032/033 scenarios + PGEN-030 dedicated tests    |
 * | 5    | null/undefined never stringified                 | PGEN-005 TOCTOU scenarios + 'rule 5' describe block      |
 * | 6    | AI-readable errors (PREFIX-NUMBER + plain text)  | 'rule 6' describe block (format assertions)              |
 * | 7    | No silent defaults (unknown/missing type throws) | PGEN-004 scenarios, PGEN-001 missing-type scenario,      |
 * |      |                                                  | PGEN-002 shorthand-value scenario                        |
 */

import { describe, test, expect } from '@jest/globals'
import { fileURLToPath } from 'node:url'

import { PromptGenerator } from '../../src/index.mjs'
import { ERROR_CODES } from '../../src/data/errorCodes.mjs'


const fixturePath = ( { name } ) => {
    const resolved = fileURLToPath( new URL( `../fixtures/${name}`, import.meta.url ) )

    return resolved
}


const NULL_BYTE = String.fromCharCode( 0 )


const buildTemplate = ( { tokens } ) => {
    const text = tokens
        .map( ( token ) => {
            const rendered = `{{${token}}}`

            return rendered
        } )
        .join( ' and ' )

    return { 'type': 'string', 'value': `Intro. ${text}. Outro.` }
}


// Builds an entry whose property degrades AFTER the first read — the stage-1
// validation read sees a valid value, every later read sees the degraded one
// (TOCTOU: time-of-check vs time-of-use via getter).
const buildDegradingEntry = ( { property, firstValue, laterValue, type } ) => {
    let readCount = 0
    const entry = { 'type': type }
    Object.defineProperty( entry, property, {
        'enumerable': true,
        get() {
            readCount = readCount + 1
            const value = readCount === 1 ? firstValue : laterValue

            return value
        }
    } )

    return entry
}


// codeToScenario maps EVERY implemented PGEN code to at least one scenario
// that really triggers it. Each scenario builds a fresh payload (stateful
// getters must not leak between runs) and carries the regex asserted on the
// thrown message (code + context fragment).
const codeToScenario = {
    'PGEN-001': [
        {
            'name': 'payload missing entirely (undefined)',
            'build': () => {
                return { 'payload': undefined, 'match': /PGEN-001 payload: required parameter is missing/ }
            }
        },
        {
            'name': 'payload is null',
            'build': () => {
                return { 'payload': null, 'match': /PGEN-001 payload: required parameter is missing/ }
            }
        },
        {
            'name': 'required key template missing',
            'build': () => {
                const payload = { 'placeholders': { 'A': { 'type': 'string', 'value': 'x' } } }

                return { payload, 'match': /PGEN-001 payload\.template: required parameter is missing/ }
            }
        },
        {
            'name': 'required key placeholders missing',
            'build': () => {
                const payload = { 'template': buildTemplate( { 'tokens': [ 'A' ] } ) }

                return { payload, 'match': /PGEN-001 payload\.placeholders: required parameter is missing/ }
            }
        },
        {
            'name': 'string entry without value',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'string' } }
                }

                return { payload, 'match': /PGEN-001 payload\.placeholders\.A\.value/ }
            }
        },
        {
            'name': 'file entry without filePath',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'file' } }
                }

                return { payload, 'match': /PGEN-001 payload\.placeholders\.A\.filePath/ }
            }
        },
        {
            'name': 'function entry without fn',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'function' } }
                }

                return { payload, 'match': /PGEN-001 payload\.placeholders\.A\.fn/ }
            }
        },
        {
            'name': 'entry without type (rule 7: no default type)',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'value': 'x' } }
                }

                return { payload, 'match': /PGEN-001 payload\.placeholders\.A\.type/ }
            }
        },
        {
            'name': 'template of type file without filePath',
            'build': () => {
                const payload = {
                    'template': { 'type': 'file' },
                    'placeholders': { 'A': { 'type': 'string', 'value': 'x' } }
                }

                return { payload, 'match': /PGEN-001 payload\.template\.filePath/ }
            }
        }
    ],
    'PGEN-002': [
        {
            'name': 'payload is an array, not a plain object',
            'build': () => {
                return { 'payload': [], 'match': /PGEN-002 payload: must be a plain object, got array/ }
            }
        },
        {
            'name': 'unknown top-level payload key',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'string', 'value': 'x' } },
                    'extra': 1
                }

                return { payload, 'match': /PGEN-002 payload: unknown payload key\(s\): extra/ }
            }
        },
        {
            'name': 'template given as shorthand string',
            'build': () => {
                const payload = {
                    'template': 'naked template string',
                    'placeholders': { 'A': { 'type': 'string', 'value': 'x' } }
                }

                return { payload, 'match': /PGEN-002 payload\.template: must be a plain object/ }
            }
        },
        {
            'name': 'placeholders is not an object',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': 'not-an-object'
                }

                return { payload, 'match': /PGEN-002 payload\.placeholders: must be a plain object/ }
            }
        },
        {
            'name': 'placeholder entry given as shorthand string (rule 7)',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': 'shorthand-value' }
                }

                return { payload, 'match': /PGEN-002 payload\.placeholders\.A: .*shorthand values are not allowed/ }
            }
        },
        {
            'name': 'placeholder key violates the grammar',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'bad-key': { 'type': 'string', 'value': 'x' } }
                }

                return { payload, 'match': /PGEN-002 payload\.placeholders\.bad-key: placeholder key must match/ }
            }
        },
        {
            'name': 'fn is not a function',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'function', 'fn': 'not-a-function' } }
                }

                return { payload, 'match': /PGEN-002 payload\.placeholders\.A\.fn: must be a function/ }
            }
        },
        {
            'name': 'args is not a plain object',
            'build': () => {
                const noop = () => {
                    return { 'status': true, 'text': 'unused' }
                }
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'function', 'fn': noop, 'args': [ 1, 2 ] } }
                }

                return { payload, 'match': /PGEN-002 payload\.placeholders\.A\.args: must be a plain object when present, got array/ }
            }
        },
        {
            'name': 'limits is not an object',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'string', 'value': 'x' } },
                    'limits': 5
                }

                return { payload, 'match': /PGEN-002 payload\.limits: must be a plain object when present/ }
            }
        },
        {
            'name': 'unknown limits key',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'string', 'value': 'x' } },
                    'limits': { 'maxTokens': 10 }
                }

                return { payload, 'match': /PGEN-002 payload\.limits: unknown limits key\(s\): maxTokens/ }
            }
        },
        {
            'name': 'limits override is not a positive integer',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'string', 'value': 'x' } },
                    'limits': { 'maxPromptLength': '10' }
                }

                return { payload, 'match': /PGEN-002 payload\.limits\.maxPromptLength: must be a positive integer/ }
            }
        },
        {
            'name': 'string entry value is a number',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'string', 'value': 42 } }
                }

                return { payload, 'match': /PGEN-002 payload\.placeholders\.A\.value: must be a string, got number/ }
            }
        }
    ],
    'PGEN-003': [
        {
            'name': 'whitespace-only string value (rule 2)',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'string', 'value': '   ' } }
                }

                return { payload, 'match': /PGEN-003 payload\.placeholders\.A\.value: must not be an empty or whitespace-only string/ }
            }
        },
        {
            'name': 'empty placeholders object',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': {}
                }

                return { payload, 'match': /PGEN-003 payload\.placeholders: must contain at least one entry/ }
            }
        },
        {
            'name': 'whitespace-only template value',
            'build': () => {
                const payload = {
                    'template': { 'type': 'string', 'value': '   ' },
                    'placeholders': { 'A': { 'type': 'string', 'value': 'x' } }
                }

                return { payload, 'match': /PGEN-003 payload\.template\.value: must not be an empty or whitespace-only string/ }
            }
        },
        {
            'name': 'value degrades to whitespace after validation (TOCTOU, caught at resolution)',
            'build': () => {
                const entry = buildDegradingEntry( {
                    'property': 'value',
                    'firstValue': 'looks valid on first read',
                    'laterValue': '   ',
                    'type': 'string'
                } )
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': entry }
                }

                return { payload, 'match': /PGEN-003 A: resolved string value is empty or whitespace-only/ }
            }
        }
    ],
    'PGEN-004': [
        {
            'name': "unknown placeholder type 'inline' (rule 7: throws, never defaults)",
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'inline', 'value': 'x' } }
                }

                return { payload, 'match': /PGEN-004 payload\.placeholders\.A\.type: must be one of: string, file, function — got 'inline'/ }
            }
        },
        {
            'name': "template type 'function' is not allowed",
            'build': () => {
                const noop = () => {
                    return { 'status': true, 'text': 'unused' }
                }
                const payload = {
                    'template': { 'type': 'function', 'fn': noop },
                    'placeholders': { 'A': { 'type': 'string', 'value': 'x' } }
                }

                return { payload, 'match': /PGEN-004 payload\.template\.type: must be one of: string, file — got 'function'/ }
            }
        }
    ],
    'PGEN-005': [
        {
            'name': 'string value degrades to null after validation (rule 5, stage-4 guard)',
            'build': () => {
                const entry = buildDegradingEntry( {
                    'property': 'value',
                    'firstValue': 'looks valid on first read',
                    'laterValue': null,
                    'type': 'string'
                } )
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'EVIL' ] } ),
                    'placeholders': { 'EVIL': entry }
                }

                return { payload, 'match': /PGEN-005 EVIL: resolved value is not a string at composition time, got null/ }
            }
        },
        {
            'name': 'fn degrades to null after validation (TOCTOU, caught at call time)',
            'build': () => {
                const validFn = () => {
                    return { 'status': true, 'text': 'never reached' }
                }
                const entry = buildDegradingEntry( {
                    'property': 'fn',
                    'firstValue': validFn,
                    'laterValue': null,
                    'type': 'function'
                } )
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': entry }
                }

                return { payload, 'match': /PGEN-005 A: 'fn' is no longer a callable function at call time, got null/ }
            }
        },
        {
            'name': 'template value degrades to null after validation',
            'build': () => {
                const template = buildDegradingEntry( {
                    'property': 'value',
                    'firstValue': 'valid template with {{A}} token',
                    'laterValue': null,
                    'type': 'string'
                } )
                const payload = {
                    'template': template,
                    'placeholders': { 'A': { 'type': 'string', 'value': 'x' } }
                }

                return { payload, 'match': /PGEN-005 template: resolved template value is not a string at composition time, got null/ }
            }
        }
    ],
    'PGEN-010': [
        {
            'name': 'template contains no placeholder token',
            'build': () => {
                const payload = {
                    'template': { 'type': 'string', 'value': 'static text without any token' },
                    'placeholders': { 'A': { 'type': 'string', 'value': 'x' } }
                }

                return { payload, 'match': /PGEN-010 template: template contains no placeholders/ }
            }
        }
    ],
    'PGEN-011': [
        {
            'name': 'template token not covered by a payload key',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A', 'B' ] } ),
                    'placeholders': { 'A': { 'type': 'string', 'value': 'x' } }
                }

                return { payload, 'match': /PGEN-011 \{\{B\}\}: template placeholder is not covered/ }
            }
        }
    ],
    'PGEN-012': [
        {
            'name': 'payload key not used in the template',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': {
                        'A': { 'type': 'string', 'value': 'x' },
                        'B': { 'type': 'string', 'value': 'y' }
                    }
                }

                return { payload, 'match': /PGEN-012 payload\.placeholders\.B: payload key does not occur in the template/ }
            }
        }
    ],
    'PGEN-013': [
        {
            'name': 'token with inner space violates the grammar',
            'build': () => {
                const payload = {
                    'template': { 'type': 'string', 'value': 'x {{bad key}} y {{A}}' },
                    'placeholders': { 'A': { 'type': 'string', 'value': 'x' } }
                }

                return { payload, 'match': /PGEN-013 template: malformed placeholder token\(s\): \{\{bad key\}\}/ }
            }
        },
        {
            'name': 'empty token {{}} in the template',
            'build': () => {
                const payload = {
                    'template': { 'type': 'string', 'value': 'x {{}} y {{A}}' },
                    'placeholders': { 'A': { 'type': 'string', 'value': 'x' } }
                }

                return { payload, 'match': /PGEN-013 template: malformed placeholder token\(s\): \{\{\}\}/ }
            }
        },
        {
            'name': 'lowercase token violates the grammar',
            'build': () => {
                const payload = {
                    'template': { 'type': 'string', 'value': 'x {{abc}} y {{A}}' },
                    'placeholders': { 'A': { 'type': 'string', 'value': 'x' } }
                }

                return { payload, 'match': /PGEN-013 template: malformed placeholder token\(s\): \{\{abc\}\}/ }
            }
        }
    ],
    'PGEN-020': [
        {
            'name': 'placeholder source file is missing (repo-internal path)',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'file', 'filePath': fixturePath( { 'name': 'does-not-exist.md' } ) } }
                }

                return { payload, 'match': /PGEN-020 A: source file is missing or not readable/ }
            }
        },
        {
            'name': 'template source file is missing (repo-internal path)',
            'build': () => {
                const payload = {
                    'template': { 'type': 'file', 'filePath': fixturePath( { 'name': 'does-not-exist.md' } ) },
                    'placeholders': { 'A': { 'type': 'string', 'value': 'x' } }
                }

                return { payload, 'match': /PGEN-020 template: source file is missing or not readable/ }
            }
        }
    ],
    'PGEN-021': [
        {
            'name': 'placeholder source file is whitespace-only (rule 2)',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'file', 'filePath': fixturePath( { 'name': 'empty-whitespace.md' } ) } }
                }

                return { payload, 'match': /PGEN-021 A: source file at filePath .* is empty or whitespace-only/ }
            }
        },
        {
            'name': 'template source file is whitespace-only',
            'build': () => {
                const payload = {
                    'template': { 'type': 'file', 'filePath': fixturePath( { 'name': 'empty-whitespace.md' } ) },
                    'placeholders': { 'A': { 'type': 'string', 'value': 'x' } }
                }

                return { payload, 'match': /PGEN-021 template: source file at filePath .* is empty or whitespace-only/ }
            }
        }
    ],
    'PGEN-030': [
        {
            'name': 'function throws synchronously (rule 4d)',
            'build': () => {
                const failingStepPlan = () => {
                    throw new Error( 'boom' )
                }
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'STEP_PLAN' ] } ),
                    'placeholders': { 'STEP_PLAN': { 'type': 'function', 'fn': failingStepPlan } }
                }

                return { payload, 'match': /PGEN-030 STEP_PLAN: function 'failingStepPlan' threw an exception or rejected — boom/ }
            }
        },
        {
            'name': 'async function rejects (rule 4d)',
            'build': () => {
                const rejectingSource = async () => {
                    throw new Error( 'async boom' )
                }
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'function', 'fn': rejectingSource } }
                }

                return { payload, 'match': /PGEN-030 A: function 'rejectingSource' threw an exception or rejected — async boom/ }
            }
        },
        {
            'name': 'function throws a non-Error value',
            'build': () => {
                const primitiveThrower = () => {
                    throw 'string-throw'
                }
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'function', 'fn': primitiveThrower } }
                }

                return { payload, 'match': /PGEN-030 A: function 'primitiveThrower' threw an exception or rejected — string-throw/ }
            }
        }
    ],
    'PGEN-031': [
        {
            'name': 'function returns a naked string (rule 4a)',
            'build': () => {
                const nakedString = () => {
                    return 'just a string'
                }
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'function', 'fn': nakedString } }
                }

                return { payload, 'match': /PGEN-031 A: function 'nakedString' must return a plain object of shape \{ status, text \}, got string/ }
            }
        },
        {
            'name': 'function returns undefined (rule 4a)',
            'build': () => {
                const returnsNothing = () => {
                    return undefined
                }
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'function', 'fn': returnsNothing } }
                }

                return { payload, 'match': /PGEN-031 A: function 'returnsNothing' must return a plain object of shape \{ status, text \}, got undefined/ }
            }
        },
        {
            'name': 'function returns extra keys beyond { status, text } (rule 4a)',
            'build': () => {
                const driftingShape = () => {
                    return { 'status': true, 'text': 'ok', 'extra': 1 }
                }
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'function', 'fn': driftingShape } }
                }

                return { payload, 'match': /PGEN-031 A: function 'driftingShape' returned key\(s\) beyond the exact \{ status, text \} shape: extra/ }
            }
        }
    ],
    'PGEN-032': [
        {
            'name': "status is the string 'true' (rule 4b: strict, not truthy)",
            'build': () => {
                const looseStatus = () => {
                    return { 'status': 'true', 'text': 'ok' }
                }
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'function', 'fn': looseStatus } }
                }

                return { payload, 'match': /PGEN-032 A: function 'looseStatus' did not return status === true \(strict check\), got string/ }
            }
        },
        {
            'name': 'status is the number 1 (rule 4b: strict, not truthy)',
            'build': () => {
                const numericStatus = () => {
                    return { 'status': 1, 'text': 'ok' }
                }
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'function', 'fn': numericStatus } }
                }

                return { payload, 'match': /PGEN-032 A: function 'numericStatus' did not return status === true/ }
            }
        },
        {
            'name': 'status is false (rule 4b)',
            'build': () => {
                const falseStatus = () => {
                    return { 'status': false, 'text': 'ok' }
                }
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'function', 'fn': falseStatus } }
                }

                return { payload, 'match': /PGEN-032 A: function 'falseStatus' did not return status === true/ }
            }
        },
        {
            'name': 'status is missing (rule 4b)',
            'build': () => {
                const missingStatus = () => {
                    return { 'text': 'ok' }
                }
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'function', 'fn': missingStatus } }
                }

                return { payload, 'match': /PGEN-032 A: function 'missingStatus' did not return status === true \(strict check\), got undefined/ }
            }
        }
    ],
    'PGEN-033': [
        {
            'name': 'text is whitespace-only (rules 2 + 4c)',
            'build': () => {
                const emptyText = () => {
                    return { 'status': true, 'text': '   ' }
                }
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'function', 'fn': emptyText } }
                }

                return { payload, 'match': /PGEN-033 A: function 'emptyText' must return a non-empty string 'text', got string/ }
            }
        },
        {
            'name': 'text is missing (rule 4c)',
            'build': () => {
                const missingText = () => {
                    return { 'status': true }
                }
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'function', 'fn': missingText } }
                }

                return { payload, 'match': /PGEN-033 A: function 'missingText' must return a non-empty string 'text', got undefined/ }
            }
        },
        {
            'name': 'text is a number (rule 4c)',
            'build': () => {
                const numericText = () => {
                    return { 'status': true, 'text': 42 }
                }
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'function', 'fn': numericText } }
                }

                return { payload, 'match': /PGEN-033 A: function 'numericText' must return a non-empty string 'text', got number/ }
            }
        }
    ],
    'PGEN-040': [
        {
            'name': 'token injected via string value survives single-pass substitution (rule 3)',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A', 'B' ] } ),
                    'placeholders': {
                        'A': { 'type': 'string', 'value': 'injected {{B}} token' },
                        'B': { 'type': 'string', 'value': 'bee' }
                    }
                }

                return { payload, 'match': /PGEN-040 prompt: unresolved token '\{\{B\}\}' survived substitution/ }
            }
        }
    ],
    'PGEN-050': [
        {
            'name': 'composed prompt exceeds the explicit maxPromptLength override',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'string', 'value': 'a long enough value' } },
                    'limits': { 'maxPromptLength': 10 }
                }

                return { payload, 'match': /PGEN-050 prompt: composed prompt length \d+ exceeds maxPromptLength 10/ }
            }
        },
        {
            'name': 'composed prompt exceeds the DEFAULT maxPromptLength (two values below the value limit)',
            'build': () => {
                const halfMillion = 'x'.repeat( 500_000 )
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A', 'B' ] } ),
                    'placeholders': {
                        'A': { 'type': 'string', 'value': halfMillion },
                        'B': { 'type': 'string', 'value': halfMillion }
                    }
                }

                return { payload, 'match': /PGEN-050 prompt: composed prompt length \d+ exceeds maxPromptLength 1000000/ }
            }
        }
    ],
    'PGEN-051': [
        {
            'name': 'resolved value exceeds the explicit maxPlaceholderValueLength override',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'string', 'value': 'longer than five' } },
                    'limits': { 'maxPlaceholderValueLength': 5 }
                }

                return { payload, 'match': /PGEN-051 A: resolved value length \d+ exceeds maxPlaceholderValueLength 5/ }
            }
        },
        {
            'name': 'resolved value exceeds the DEFAULT maxPlaceholderValueLength',
            'build': () => {
                const oversized = 'x'.repeat( 500_001 )
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'string', 'value': oversized } }
                }

                return { payload, 'match': /PGEN-051 A: resolved value length 500001 exceeds maxPlaceholderValueLength 500000/ }
            }
        }
    ],
    'PGEN-052': [
        {
            'name': 'source file with broken encoding (U+FFFD after utf-8 decode)',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'file', 'filePath': fixturePath( { 'name': 'broken-encoding.txt' } ) } }
                }

                return { payload, 'match': /PGEN-052 A: source file at filePath .* contains invalid encoding/ }
            }
        },
        {
            'name': 'string value with a null byte',
            'build': () => {
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'string', 'value': `broken${NULL_BYTE}value` } }
                }

                return { payload, 'match': /PGEN-052 A: string value contains a null byte/ }
            }
        },
        {
            'name': 'function text with a null byte',
            'build': () => {
                const nullByteText = () => {
                    return { 'status': true, 'text': `broken${NULL_BYTE}text` }
                }
                const payload = {
                    'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                    'placeholders': { 'A': { 'type': 'function', 'fn': nullByteText } }
                }

                return { payload, 'match': /PGEN-052 A: function 'nullByteText' returned text containing a null byte/ }
            }
        },
        {
            'name': 'template value with a null byte',
            'build': () => {
                const payload = {
                    'template': { 'type': 'string', 'value': `broken${NULL_BYTE}template {{A}}` },
                    'placeholders': { 'A': { 'type': 'string', 'value': 'x' } }
                }

                return { payload, 'match': /PGEN-052 template: template value contains a null byte/ }
            }
        }
    ]
}


const matrixRows = Object.entries( codeToScenario )
    .flatMap( ( [ code, scenarios ] ) => {
        const rows = scenarios
            .map( ( scenario ) => {
                return [ code, scenario.name, scenario ]
            } )

        return rows
    } )


describe( 'PGEN error matrix — completeness guard', () => {
    test( 'every registry code has at least one negative-test scenario', () => {
        const registryCodes = Object.keys( ERROR_CODES )
        const coveredCodes = Object.keys( codeToScenario )
        const missing = registryCodes
            .filter( ( code ) => {
                const isCovered = coveredCodes.includes( code )

                return isCovered === false
            } )

        expect( missing ).toEqual( [] )
    } )


    test( 'the scenario map contains no codes outside the registry', () => {
        const registryCodes = Object.keys( ERROR_CODES )
        const stale = Object.keys( codeToScenario )
            .filter( ( code ) => {
                const isKnown = registryCodes.includes( code )

                return isKnown === false
            } )

        expect( stale ).toEqual( [] )
    } )


    test( 'every scenario asserts its own code in the throw pattern', () => {
        const mismatches = matrixRows
            .filter( ( [ code, , scenario ] ) => {
                const { match } = scenario.build()
                const assertsOwnCode = match.source.includes( code )

                return assertsOwnCode === false
            } )
            .map( ( [ code, name ] ) => {
                const label = `${code} — ${name}`

                return label
            } )

        expect( mismatches ).toEqual( [] )
    } )
} )


describe( 'PGEN error matrix — every code is really triggered', () => {
    test.each( matrixRows )( '%s — %s', async ( code, name, scenario ) => {
        const { payload, match } = scenario.build()

        await expect( PromptGenerator.generate( payload ) )
            .rejects.toThrow( match )
    } )
} )


describe( 'rule 1 — validation failure means hard throw, no partial prompt', () => {
    test( 'the thrown error exposes no prompt and generate() returns nothing', async () => {
        let caught
        let result
        try {
            result = await PromptGenerator.generate( {
                'template': buildTemplate( { 'tokens': [ 'A', 'B' ] } ),
                'placeholders': { 'A': { 'type': 'string', 'value': 'only A is covered' } }
            } )
        } catch( error ) {
            caught = error
        }

        expect( result ).toBeUndefined()
        expect( caught ).toBeInstanceOf( Error )
        expect( caught ).not.toHaveProperty( 'prompt' )
        expect( caught ).not.toHaveProperty( 'metadata' )
    } )
} )


describe( 'rule 5 — null/undefined are never stringified into a prompt', () => {
    test( 'TOCTOU null value fails before composition; no result carries a stringified null', async () => {
        const entry = buildDegradingEntry( {
            'property': 'value',
            'firstValue': 'looks valid on first read',
            'laterValue': null,
            'type': 'string'
        } )

        let caught
        let result
        try {
            result = await PromptGenerator.generate( {
                'template': { 'type': 'string', 'value': 'Value is: {{EVIL}}' },
                'placeholders': { 'EVIL': entry }
            } )
        } catch( error ) {
            caught = error
        }

        expect( result ).toBeUndefined()
        expect( caught ).toBeInstanceOf( Error )
        expect( caught.message ).toMatch( /PGEN-005/ )
        expect( caught ).not.toHaveProperty( 'prompt' )
    } )


    test( 'a successful prompt never contains stringified null/undefined from sources', async () => {
        const { prompt } = await PromptGenerator.generate( {
            'template': { 'type': 'string', 'value': 'Value: {{A}}' },
            'placeholders': { 'A': { 'type': 'string', 'value': 'clean content' } }
        } )

        expect( prompt ).not.toContain( 'null' )
        expect( prompt ).not.toContain( 'undefined' )
    } )
} )


describe( 'rule 6 — errors are AI-readable (PREFIX-NUMBER plus plain text)', () => {
    const representativePayloads = [
        [ 'missing template', { 'placeholders': { 'A': { 'type': 'string', 'value': 'x' } } } ],
        [ 'unknown type', { 'template': buildTemplate( { 'tokens': [ 'A' ] } ), 'placeholders': { 'A': { 'type': 'inline', 'value': 'x' } } } ],
        [ 'uncovered token', { 'template': buildTemplate( { 'tokens': [ 'A', 'B' ] } ), 'placeholders': { 'A': { 'type': 'string', 'value': 'x' } } } ]
    ]


    test.each( representativePayloads )( 'message format for %s: method context + PGEN code + location + plain text', async ( name, payload ) => {
        let caught
        try {
            await PromptGenerator.generate( payload )
        } catch( error ) {
            caught = error
        }

        expect( caught ).toBeInstanceOf( Error )
        expect( caught.message ).toMatch( /^PromptGenerator\.generate: PGEN-\d{3} \S[\s\S]*: \S/ )
        expect( caught.message.length ).toBeGreaterThan( 'PGEN-000'.length )
    } )


    test( 'multiple findings are aggregated into one throw, each carrying its code', async () => {
        let caught
        try {
            await PromptGenerator.generate( {
                'placeholders': { 'A': { 'type': 'string', 'value': '   ' } }
            } )
        } catch( error ) {
            caught = error
        }

        expect( caught ).toBeInstanceOf( Error )
        expect( caught.message ).toMatch( /PGEN-001 payload\.template/ )
        expect( caught.message ).toMatch( /PGEN-003 payload\.placeholders\.A\.value/ )
        expect( caught.message ).toContain( '; ' )
    } )
} )


describe( 'rule 4d — exception wrapping preserves context and cause', () => {
    test( 'sync throw: message carries placeholder key + function name, cause is the original Error', async () => {
        const failingStepPlan = () => {
            throw new Error( 'boom' )
        }

        let caught
        try {
            await PromptGenerator.generate( {
                'template': buildTemplate( { 'tokens': [ 'STEP_PLAN' ] } ),
                'placeholders': { 'STEP_PLAN': { 'type': 'function', 'fn': failingStepPlan } }
            } )
        } catch( error ) {
            caught = error
        }

        expect( caught ).toBeInstanceOf( Error )
        expect( caught.message ).toContain( 'STEP_PLAN' )
        expect( caught.message ).toContain( 'failingStepPlan' )
        expect( caught.cause ).toBeInstanceOf( Error )
        expect( caught.cause.message ).toBe( 'boom' )
    } )


    test( 'async rejection: cause is the original Error', async () => {
        const rejectingSource = async () => {
            throw new Error( 'async boom' )
        }

        let caught
        try {
            await PromptGenerator.generate( {
                'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                'placeholders': { 'A': { 'type': 'function', 'fn': rejectingSource } }
            } )
        } catch( error ) {
            caught = error
        }

        expect( caught ).toBeInstanceOf( Error )
        expect( caught.cause ).toBeInstanceOf( Error )
        expect( caught.cause.message ).toBe( 'async boom' )
    } )


    test( 'non-Error throw: the primitive survives as cause', async () => {
        const primitiveThrower = () => {
            throw 'string-throw'
        }

        let caught
        try {
            await PromptGenerator.generate( {
                'template': buildTemplate( { 'tokens': [ 'A' ] } ),
                'placeholders': { 'A': { 'type': 'function', 'fn': primitiveThrower } }
            } )
        } catch( error ) {
            caught = error
        }

        expect( caught ).toBeInstanceOf( Error )
        expect( caught.cause ).toBe( 'string-throw' )
    } )
} )
