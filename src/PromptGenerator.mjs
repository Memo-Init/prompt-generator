/**
 * PromptGenerator — deterministic prompt composition. No LLM call.
 *
 * Purpose: compose a prompt string from a template and typed placeholder
 * sources. Pure composition plus strict validation — the generator never
 * calls a model, never orchestrates agents and knows no domain concepts.
 *
 * Three placeholder sources (every entry MUST be an object with an
 * explicit type — no shorthand values):
 *   - type 'string'   — value is inserted directly (non-empty string only)
 *   - type 'file'     — file at filePath is read completely (utf-8);
 *                       missing or empty/whitespace-only file = hard error
 *   - type 'function' — fn is called with args (single object parameter);
 *                       return contract is { status, text } — exactly these
 *                       keys, status === true (strict) and text a non-empty
 *                       string; exceptions are caught and rethrown as coded
 *                       errors with function context and preserved cause
 *
 * The template itself uses the same source model: { type: 'string', value }
 * or { type: 'file', filePath } — type 'function' is not allowed for templates.
 *
 * Validation pipeline (fixed stage order, every finding = hard throw,
 * no prompt ever leaves the generator with findings):
 *   1. payload validation                    PGEN-001..004
 *   2. template resolution + validation      PGEN-010..013, 020/021/052
 *   3. source resolution per placeholder     PGEN-003, 020/021/052, 030..033
 *   4. composition guard (values = strings)  PGEN-005
 *   5. composition (single-pass)             —
 *   6. torso check + length limits           PGEN-040, 050/051
 *
 * Substitution is SINGLE-PASS: the template is split once at its tokens
 * and the resolved values are inserted as inert segments — values are
 * NEVER re-scanned for tokens. A {{...}} token that a value carries into
 * the prompt therefore survives composition and fails the torso check.
 *
 * Token syntax is {{KEY}} with KEY matching ^[A-Z][A-Z0-9_]*$ (strict
 * grammar). The torso scan after composition is deliberately broader:
 * EVERY remaining {{...}} sequence — regardless of grammar — is a torso.
 *
 * Error messages are AI-readable: each finding is built from the frozen
 * PGEN registry (src/data/errorCodes.mjs) in the format
 * 'PGEN-XXX {location}: {description}' and thrown with method context.
 * No silent defaults, no fallbacks, no partial results.
 */

import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

import { ERROR_CODES } from './data/errorCodes.mjs'


const TOP_LEVEL_REQUIRED_KEYS = [ 'template', 'placeholders' ]
const TOP_LEVEL_ALLOWED_KEYS = [ 'template', 'placeholders', 'limits' ]
const TEMPLATE_TYPES = [ 'string', 'file' ]
const PLACEHOLDER_TYPES = [ 'string', 'file', 'function' ]
const LIMIT_KEYS = [ 'maxPromptLength', 'maxPlaceholderValueLength' ]
const FUNCTION_RESULT_KEYS = [ 'status', 'text' ]

// Hard guards against runaway composition — NOT a usability limit (that is
// the consumer's concern). Sized so that large file sources (schemas up to
// 150 KB, very long test outputs) pass without friction. Override only via
// the explicit payload entry limits: { maxPromptLength?, maxPlaceholderValueLength? };
// every override is hard-validated, no ||-fallback (explicit === undefined handling).
const DEFAULT_MAX_PROMPT_LENGTH = 1_000_000
const DEFAULT_MAX_PLACEHOLDER_VALUE_LENGTH = 500_000

// Strict placeholder key grammar — uppercase start, then uppercase/digits/underscore.
const PLACEHOLDER_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/

// Detects every {{...}} token occurrence in the template; captured keys are
// validated separately against the strict grammar (malformed = PGEN-013).
const TOKEN_PATTERN = /\{\{([^{}]*)\}\}/g

// Single-pass split pattern — the capture group keeps the tokens as segments.
// Only grammar-valid tokens are split out; stage 2 guarantees the template
// contains no other token forms at composition time.
const TOKEN_SPLIT_PATTERN = /(\{\{[A-Z][A-Z0-9_]*\}\})/

// Exact-match form of a grammar-valid token, used on split segments.
const TOKEN_EXACT_PATTERN = /^\{\{([A-Z][A-Z0-9_]*)\}\}$/

// Torso scan — deliberately BROADER than the grammar: every {{...}} sequence
// with any content (including newlines) counts as an unresolved torso token.
const TORSO_PATTERN = /\{\{[\s\S]*?\}\}/g

// Encoding markers that prove a broken source: UTF-8 replacement character
// (U+FFFD, produced when decoding invalid bytes) and the null byte.
const ENCODING_MARKERS = [ '\uFFFD', '\u0000' ]


class PromptGenerator {
    static async generate( payload ) {
        // Stage 1 — payload validation (PGEN-001..004)
        const payloadValidation = PromptGenerator.#validationGenerate( { payload } )
        PromptGenerator.#assertStruct( { struct: payloadValidation } )

        const { template, placeholders, limits } = payload
        const resolvedLimits = PromptGenerator.#resolveLimits( { limits } )

        // Stage 2 — template resolution + bidirectional template validation
        const templateResolved = await PromptGenerator.#resolveTemplate( { template } )
        const templateTokens = PromptGenerator.#extractTemplateTokens( { templateText: templateResolved.text } )
        const coverageValidation = PromptGenerator.#validationCoverage( { templateTokens, placeholders } )
        PromptGenerator.#assertStruct( { struct: coverageValidation } )

        // Stage 3 — source resolution per placeholder (string/file/function)
        const resolvedPlaceholders = await PromptGenerator.#resolvePlaceholders( { placeholders } )

        // Stage 4 — composition guard: every resolved value is a string (PGEN-005)
        const guardValidation = PromptGenerator.#validationCompositionGuard( { resolvedPlaceholders } )
        PromptGenerator.#assertStruct( { struct: guardValidation } )

        // Stage 5 — single-pass composition (values are inert, never re-substituted)
        const prompt = PromptGenerator.#substituteSinglePass( { templateText: templateResolved.text, resolvedPlaceholders } )

        // Stage 6 — torso check + length limits on the composed prompt
        const composedValidation = PromptGenerator.#validationComposedPrompt( { prompt, resolvedPlaceholders, resolvedLimits } )
        PromptGenerator.#assertStruct( { struct: composedValidation } )

        const metadata = PromptGenerator.#buildMetadata( { templateResolved, resolvedPlaceholders, prompt } )

        return { prompt, metadata }
    }


    static #validationGenerate( { payload } ) {
        const struct = { 'status': false, 'messages': [] }

        // Existence and base type of the payload itself
        if( PromptGenerator.#isMissing( { value: payload } ) ) {
            struct.messages.push( PromptGenerator.#finding( { code: 'PGEN-001', location: 'payload', detail: 'required parameter is missing (undefined or null)' } ) )
        } else if( PromptGenerator.#isPlainObject( { value: payload } ) === false ) {
            struct.messages.push( PromptGenerator.#finding( { code: 'PGEN-002', location: 'payload', detail: `must be a plain object, got ${PromptGenerator.#describeValueType( { value: payload } )}` } ) )
        }

        // Breakpoint — detail checks only run on an existing, typed payload
        if( struct.messages.length > 0 ) { return struct }

        const presentKeys = Object.keys( payload )

        TOP_LEVEL_REQUIRED_KEYS
            .forEach( ( requiredKey ) => {
                const requiredValue = payload[ requiredKey ]
                if( PromptGenerator.#isMissing( { value: requiredValue } ) ) {
                    struct.messages.push( PromptGenerator.#finding( { code: 'PGEN-001', location: `payload.${requiredKey}`, detail: 'required parameter is missing (undefined or null)' } ) )
                }
            } )

        const unknownKeys = presentKeys
            .filter( ( presentKey ) => {
                const isAllowed = TOP_LEVEL_ALLOWED_KEYS.includes( presentKey )
                return isAllowed === false
            } )
        if( unknownKeys.length > 0 ) {
            struct.messages.push( PromptGenerator.#finding( { code: 'PGEN-002', location: 'payload', detail: `unknown payload key(s): ${unknownKeys.join( ', ' )} — allowed keys are ${TOP_LEVEL_ALLOWED_KEYS.join( ', ' )}` } ) )
        }

        const { template, placeholders, limits } = payload
        if( PromptGenerator.#isMissing( { value: template } ) === false ) {
            const { messages: templateMessages } = PromptGenerator.#validationTemplateSource( { template } )
            templateMessages
                .forEach( ( templateMessage ) => { struct.messages.push( templateMessage ) } )
        }
        if( PromptGenerator.#isMissing( { value: placeholders } ) === false ) {
            const { messages: placeholderMessages } = PromptGenerator.#validationPlaceholderEntries( { placeholders } )
            placeholderMessages
                .forEach( ( placeholderMessage ) => { struct.messages.push( placeholderMessage ) } )
        }
        if( limits !== undefined ) {
            const { messages: limitMessages } = PromptGenerator.#validationLimits( { limits } )
            limitMessages
                .forEach( ( limitMessage ) => { struct.messages.push( limitMessage ) } )
        }

        if( struct.messages.length === 0 ) { struct.status = true }

        return struct
    }


    static #validationTemplateSource( { template } ) {
        const messages = []

        if( PromptGenerator.#isPlainObject( { value: template } ) === false ) {
            messages.push( PromptGenerator.#finding( { code: 'PGEN-002', location: 'payload.template', detail: `must be a plain object with an explicit type, got ${PromptGenerator.#describeValueType( { value: template } )}` } ) )
            return { messages }
        }

        const { type, value, filePath } = template

        const typeFields = [
            [ 'payload.template.type', type, 'string', TEMPLATE_TYPES ]
        ]
        const { messages: typeMessages } = PromptGenerator.#validationFields( { fields: typeFields } )
        typeMessages
            .forEach( ( typeMessage ) => { messages.push( typeMessage ) } )

        // Breakpoint — per-type detail checks only run on a valid type
        if( messages.length > 0 ) { return { messages } }

        const detailFields = []
        if( type === 'string' ) {
            detailFields.push( [ 'payload.template.value', value, 'string', null ] )
        }
        if( type === 'file' ) {
            detailFields.push( [ 'payload.template.filePath', filePath, 'string', null ] )
        }
        const { messages: detailMessages } = PromptGenerator.#validationFields( { fields: detailFields } )
        detailMessages
            .forEach( ( detailMessage ) => { messages.push( detailMessage ) } )

        return { messages }
    }


    static #validationPlaceholderEntries( { placeholders } ) {
        const messages = []

        if( PromptGenerator.#isPlainObject( { value: placeholders } ) === false ) {
            messages.push( PromptGenerator.#finding( { code: 'PGEN-002', location: 'payload.placeholders', detail: `must be a plain object, got ${PromptGenerator.#describeValueType( { value: placeholders } )}` } ) )
            return { messages }
        }

        const entries = Object.entries( placeholders )
        if( entries.length === 0 ) {
            messages.push( PromptGenerator.#finding( { code: 'PGEN-003', location: 'payload.placeholders', detail: 'must contain at least one entry — an empty placeholders object is forbidden' } ) )
            return { messages }
        }

        entries
            .forEach( ( [ placeholderKey, entry ] ) => {
                if( PLACEHOLDER_KEY_PATTERN.test( placeholderKey ) === false ) {
                    messages.push( PromptGenerator.#finding( { code: 'PGEN-002', location: `payload.placeholders.${placeholderKey}`, detail: 'placeholder key must match ^[A-Z][A-Z0-9_]*$' } ) )
                    return
                }
                const { messages: entryMessages } = PromptGenerator.#validationPlaceholderEntry( { placeholderKey, entry } )
                entryMessages
                    .forEach( ( entryMessage ) => { messages.push( entryMessage ) } )
            } )

        return { messages }
    }


    static #validationPlaceholderEntry( { placeholderKey, entry } ) {
        const messages = []
        const location = `payload.placeholders.${placeholderKey}`

        if( PromptGenerator.#isPlainObject( { value: entry } ) === false ) {
            messages.push( PromptGenerator.#finding( { code: 'PGEN-002', location, detail: `must be a plain object with an explicit type — shorthand values are not allowed, got ${PromptGenerator.#describeValueType( { value: entry } )}` } ) )
            return { messages }
        }

        // Single property access per field — values are read exactly once here
        const { type, value, filePath, fn, args } = entry

        const typeFields = [
            [ `${location}.type`, type, 'string', PLACEHOLDER_TYPES ]
        ]
        const { messages: typeMessages } = PromptGenerator.#validationFields( { fields: typeFields } )
        typeMessages
            .forEach( ( typeMessage ) => { messages.push( typeMessage ) } )

        // Breakpoint — per-type detail checks only run on a valid type
        if( messages.length > 0 ) { return { messages } }

        const detailFields = []
        if( type === 'string' ) {
            detailFields.push( [ `${location}.value`, value, 'string', null ] )
        }
        if( type === 'file' ) {
            detailFields.push( [ `${location}.filePath`, filePath, 'string', null ] )
        }
        if( type === 'function' ) {
            detailFields.push( [ `${location}.fn`, fn, 'function', null ] )
        }
        const { messages: detailMessages } = PromptGenerator.#validationFields( { fields: detailFields } )
        detailMessages
            .forEach( ( detailMessage ) => { messages.push( detailMessage ) } )

        // args is optional — but when present it must be a plain object
        if( type === 'function' && args !== undefined && PromptGenerator.#isPlainObject( { value: args } ) === false ) {
            messages.push( PromptGenerator.#finding( { code: 'PGEN-002', location: `${location}.args`, detail: `must be a plain object when present, got ${PromptGenerator.#describeValueType( { value: args } )}` } ) )
        }

        return { messages }
    }


    static #validationLimits( { limits } ) {
        const messages = []

        if( PromptGenerator.#isPlainObject( { value: limits } ) === false ) {
            messages.push( PromptGenerator.#finding( { code: 'PGEN-002', location: 'payload.limits', detail: `must be a plain object when present, got ${PromptGenerator.#describeValueType( { value: limits } )}` } ) )
            return { messages }
        }

        const unknownKeys = Object.keys( limits )
            .filter( ( presentKey ) => {
                const isAllowed = LIMIT_KEYS.includes( presentKey )
                return isAllowed === false
            } )
        if( unknownKeys.length > 0 ) {
            messages.push( PromptGenerator.#finding( { code: 'PGEN-002', location: 'payload.limits', detail: `unknown limits key(s): ${unknownKeys.join( ', ' )} — allowed keys are ${LIMIT_KEYS.join( ', ' )}` } ) )
        }

        LIMIT_KEYS
            .forEach( ( limitKey ) => {
                const overrideValue = limits[ limitKey ]
                if( overrideValue === undefined ) { return }
                const isPositiveInteger = Number.isInteger( overrideValue ) && overrideValue > 0
                if( isPositiveInteger === false ) {
                    messages.push( PromptGenerator.#finding( { code: 'PGEN-002', location: `payload.limits.${limitKey}`, detail: `must be a positive integer, got ${PromptGenerator.#describeValueType( { value: overrideValue } )}` } ) )
                }
            } )

        return { messages }
    }


    // Bulk field validation in the [ key, value, type, list ] pattern.
    // Check order per field: existence (PGEN-001) -> type (PGEN-002) ->
    // emptiness for strings (PGEN-003) -> whitelist (PGEN-004).
    static #validationFields( { fields } ) {
        const messages = []

        fields
            .forEach( ( [ key, value, type, list ] ) => {
                if( PromptGenerator.#isMissing( { value } ) ) {
                    messages.push( PromptGenerator.#finding( { code: 'PGEN-001', location: key, detail: 'required parameter is missing (undefined or null)' } ) )
                    return
                }
                if( type === 'string' ) {
                    if( typeof value !== 'string' ) {
                        messages.push( PromptGenerator.#finding( { code: 'PGEN-002', location: key, detail: `must be a string, got ${PromptGenerator.#describeValueType( { value } )}` } ) )
                        return
                    }
                    if( value.trim() === '' ) {
                        messages.push( PromptGenerator.#finding( { code: 'PGEN-003', location: key, detail: 'must not be an empty or whitespace-only string' } ) )
                        return
                    }
                }
                if( type === 'function' && typeof value !== 'function' ) {
                    messages.push( PromptGenerator.#finding( { code: 'PGEN-002', location: key, detail: `must be a function, got ${PromptGenerator.#describeValueType( { value } )}` } ) )
                    return
                }
                if( type === 'object' && PromptGenerator.#isPlainObject( { value } ) === false ) {
                    messages.push( PromptGenerator.#finding( { code: 'PGEN-002', location: key, detail: `must be a plain object, got ${PromptGenerator.#describeValueType( { value } )}` } ) )
                    return
                }
                if( list !== null && list.includes( value ) === false ) {
                    messages.push( PromptGenerator.#finding( { code: 'PGEN-004', location: key, detail: `must be one of: ${list.join( ', ' )} — got '${value}'` } ) )
                }
            } )

        return { messages }
    }


    static #validationCoverage( { templateTokens, placeholders } ) {
        const struct = { 'status': false, 'messages': [] }
        const placeholderKeys = Object.keys( placeholders )

        templateTokens
            .filter( ( templateToken ) => {
                const isCovered = placeholderKeys.includes( templateToken )
                return isCovered === false
            } )
            .forEach( ( uncoveredToken ) => {
                struct.messages.push( PromptGenerator.#finding( { code: 'PGEN-011', location: `{{${uncoveredToken}}}`, detail: 'template placeholder is not covered by a payload placeholders key' } ) )
            } )

        placeholderKeys
            .filter( ( placeholderKey ) => {
                const isUsed = templateTokens.includes( placeholderKey )
                return isUsed === false
            } )
            .forEach( ( unusedKey ) => {
                struct.messages.push( PromptGenerator.#finding( { code: 'PGEN-012', location: `payload.placeholders.${unusedKey}`, detail: 'payload key does not occur in the template' } ) )
            } )

        if( struct.messages.length === 0 ) { struct.status = true }

        return struct
    }


    static #validationCompositionGuard( { resolvedPlaceholders } ) {
        const struct = { 'status': false, 'messages': [] }

        Object.entries( resolvedPlaceholders )
            .forEach( ( [ placeholderKey, resolvedEntry ] ) => {
                const { text } = resolvedEntry
                if( typeof text !== 'string' ) {
                    struct.messages.push( PromptGenerator.#finding( { code: 'PGEN-005', location: placeholderKey, detail: `resolved value is not a string at composition time, got ${PromptGenerator.#describeValueType( { value: text } )} — null/undefined are never stringified` } ) )
                }
            } )

        if( struct.messages.length === 0 ) { struct.status = true }

        return struct
    }


    static #validationComposedPrompt( { prompt, resolvedPlaceholders, resolvedLimits } ) {
        const struct = { 'status': false, 'messages': [] }
        const { maxPromptLength, maxPlaceholderValueLength } = resolvedLimits

        // Torso check — broad scan, EVERY remaining {{...}} sequence is a finding
        const torsoMatches = Array.from( prompt.matchAll( TORSO_PATTERN ) )
        const torsoTokens = Array.from( new Set( torsoMatches
            .map( ( torsoMatch ) => {
                const torsoToken = torsoMatch[ 0 ]
                return torsoToken
            } )
        ) )
        torsoTokens
            .forEach( ( torsoToken ) => {
                struct.messages.push( PromptGenerator.#finding( { code: 'PGEN-040', location: 'prompt', detail: `unresolved token '${torsoToken}' survived substitution — placeholder values are inert and never re-substituted` } ) )
            } )

        Object.entries( resolvedPlaceholders )
            .forEach( ( [ placeholderKey, resolvedEntry ] ) => {
                const { text } = resolvedEntry
                if( text.length > maxPlaceholderValueLength ) {
                    struct.messages.push( PromptGenerator.#finding( { code: 'PGEN-051', location: placeholderKey, detail: `resolved value length ${text.length} exceeds maxPlaceholderValueLength ${maxPlaceholderValueLength}` } ) )
                }
            } )

        if( prompt.length > maxPromptLength ) {
            struct.messages.push( PromptGenerator.#finding( { code: 'PGEN-050', location: 'prompt', detail: `composed prompt length ${prompt.length} exceeds maxPromptLength ${maxPromptLength}` } ) )
        }

        if( struct.messages.length === 0 ) { struct.status = true }

        return struct
    }


    static #resolveLimits( { limits } ) {
        // Explicit === undefined handling — documented defaults, no ||-fallback
        if( limits === undefined ) {
            return {
                'maxPromptLength': DEFAULT_MAX_PROMPT_LENGTH,
                'maxPlaceholderValueLength': DEFAULT_MAX_PLACEHOLDER_VALUE_LENGTH
            }
        }

        const maxPromptLength = limits.maxPromptLength === undefined
            ? DEFAULT_MAX_PROMPT_LENGTH
            : limits.maxPromptLength
        const maxPlaceholderValueLength = limits.maxPlaceholderValueLength === undefined
            ? DEFAULT_MAX_PLACEHOLDER_VALUE_LENGTH
            : limits.maxPlaceholderValueLength

        return { maxPromptLength, maxPlaceholderValueLength }
    }


    static async #resolveTemplate( { template } ) {
        if( template.type === 'string' ) {
            const { value } = template
            if( typeof value !== 'string' ) {
                PromptGenerator.#throwFindings( { messages: [ PromptGenerator.#finding( { code: 'PGEN-005', location: 'template', detail: `resolved template value is not a string at composition time, got ${PromptGenerator.#describeValueType( { value } )}` } ) ] } )
            }
            PromptGenerator.#assertNoNullByte( { text: value, location: 'template', detail: 'template value contains a null byte' } )
            return { source: 'string', text: value }
        }

        // template.type === 'file' — shape was validated in stage 1.
        const text = await PromptGenerator.#readFileStrict( { filePath: template.filePath, location: 'template' } )

        return { source: 'file', filePath: template.filePath, text }
    }


    static #extractTemplateTokens( { templateText } ) {
        const matches = Array.from( templateText.matchAll( TOKEN_PATTERN ) )
        const rawKeys = matches
            .map( ( match ) => {
                const rawKey = match[ 1 ]
                return rawKey
            } )

        const malformedKeys = rawKeys
            .filter( ( rawKey ) => {
                const isValid = PLACEHOLDER_KEY_PATTERN.test( rawKey )
                return isValid === false
            } )
        if( malformedKeys.length > 0 ) {
            const uniqueMalformed = Array.from( new Set( malformedKeys ) )
            const renderedTokens = uniqueMalformed
                .map( ( malformedKey ) => {
                    const rendered = `{{${malformedKey}}}`
                    return rendered
                } )
            PromptGenerator.#throwFindings( { messages: [ PromptGenerator.#finding( { code: 'PGEN-013', location: 'template', detail: `malformed placeholder token(s): ${renderedTokens.join( ', ' )} — token keys must match ^[A-Z][A-Z0-9_]*$` } ) ] } )
        }

        if( rawKeys.length === 0 ) {
            PromptGenerator.#throwFindings( { messages: [ PromptGenerator.#finding( { code: 'PGEN-010', location: 'template', detail: 'template contains no placeholders — at least one {{KEY}} token is required' } ) ] } )
        }

        const uniqueKeys = Array.from( new Set( rawKeys ) )

        return uniqueKeys
    }


    static async #resolvePlaceholders( { placeholders } ) {
        // Sequential resolution in key order keeps error reporting deterministic —
        // the FIRST failing source throws immediately (errors return at trigger
        // time, never later in the batch).
        const entries = Object.entries( placeholders )
        const resolved = await entries
            .reduce( async ( accumulatorPromise, [ placeholderKey, entry ] ) => {
                const accumulator = await accumulatorPromise
                const resolvedEntry = await PromptGenerator.#resolvePlaceholder( { placeholderKey, entry } )
                accumulator[ placeholderKey ] = resolvedEntry
                return accumulator
            }, Promise.resolve( {} ) )

        return resolved
    }


    static async #resolvePlaceholder( { placeholderKey, entry } ) {
        const { type } = entry

        if( type === 'string' ) {
            const { value } = entry
            // Late re-checks on the captured value (defense in depth). A type
            // anomaly at this point intentionally flows on to the stage-4
            // composition guard (PGEN-005) — it is never stringified.
            if( typeof value === 'string' ) {
                if( value.trim() === '' ) {
                    PromptGenerator.#throwFindings( { messages: [ PromptGenerator.#finding( { code: 'PGEN-003', location: placeholderKey, detail: 'resolved string value is empty or whitespace-only' } ) ] } )
                }
                PromptGenerator.#assertNoNullByte( { text: value, location: placeholderKey, detail: 'string value contains a null byte' } )
            }
            return { source: 'string', text: value }
        }
        if( type === 'file' ) {
            const { filePath } = entry
            const text = await PromptGenerator.#readFileStrict( { filePath, location: placeholderKey } )
            return { source: 'file', filePath, text }
        }

        // type === 'function' — shape was validated in stage 1.
        const { fn, args } = entry
        const { text, functionName } = await PromptGenerator.#callFunctionPlaceholder( { placeholderKey, fn, args } )

        return { source: 'function', functionName, text }
    }


    static async #readFileStrict( { filePath, location } ) {
        let content
        try {
            content = await readFile( filePath, 'utf-8' )
        } catch( error ) {
            const reason = error instanceof Error ? error.message : String( error )
            PromptGenerator.#throwFindings( { messages: [ PromptGenerator.#finding( { code: 'PGEN-020', location, detail: `source file is missing or not readable at filePath '${filePath}' — ${reason}` } ) ] } )
        }

        if( content.trim() === '' ) {
            PromptGenerator.#throwFindings( { messages: [ PromptGenerator.#finding( { code: 'PGEN-021', location, detail: `source file at filePath '${filePath}' is empty or whitespace-only` } ) ] } )
        }

        const hasBrokenEncoding = ENCODING_MARKERS
            .some( ( encodingMarker ) => {
                const isContained = content.includes( encodingMarker )
                return isContained
            } )
        if( hasBrokenEncoding ) {
            PromptGenerator.#throwFindings( { messages: [ PromptGenerator.#finding( { code: 'PGEN-052', location, detail: `source file at filePath '${filePath}' contains invalid encoding (U+FFFD replacement character or null byte)` } ) ] } )
        }

        return content
    }


    static async #callFunctionPlaceholder( { placeholderKey, fn, args } ) {
        // Re-validate at call time: a getter may have mutated 'fn' since the
        // stage-1 read (TOCTOU) — a raw TypeError here would violate rule 6.
        if( typeof fn !== 'function' ) {
            PromptGenerator.#throwFindings( { messages: [ PromptGenerator.#finding( { code: 'PGEN-005', location: placeholderKey, detail: `'fn' is no longer a callable function at call time, got ${PromptGenerator.#describeValueType( { value: fn } )}` } ) ] } )
        }

        // Anonymous functions have an empty .name — recorded explicitly.
        const functionName = fn.name === '' ? '<anonymous>' : fn.name

        // (d) Exception wrapping — any throw/rejection is rethrown as PGEN-030
        // with function context; the original error survives as error.cause.
        let result
        try {
            result = await fn( args )
        } catch( error ) {
            const reason = error instanceof Error ? error.message : String( error )
            const finding = PromptGenerator.#finding( { code: 'PGEN-030', location: placeholderKey, detail: `function '${functionName}' threw an exception or rejected — ${reason}` } )
            throw new Error( `PromptGenerator.generate: ${finding}`, { cause: error } )
        }

        // (a) Shape exact: plain object with exactly the keys { status, text } —
        // additional keys are a shape violation (a drifting contract multiplies).
        if( PromptGenerator.#isPlainObject( { value: result } ) === false ) {
            PromptGenerator.#throwFindings( { messages: [ PromptGenerator.#finding( { code: 'PGEN-031', location: placeholderKey, detail: `function '${functionName}' must return a plain object of shape { status, text }, got ${PromptGenerator.#describeValueType( { value: result } )}` } ) ] } )
        }
        const extraKeys = Object.keys( result )
            .filter( ( resultKey ) => {
                const isContractKey = FUNCTION_RESULT_KEYS.includes( resultKey )
                return isContractKey === false
            } )
        if( extraKeys.length > 0 ) {
            PromptGenerator.#throwFindings( { messages: [ PromptGenerator.#finding( { code: 'PGEN-031', location: placeholderKey, detail: `function '${functionName}' returned key(s) beyond the exact { status, text } shape: ${extraKeys.join( ', ' )}` } ) ] } )
        }

        const { status, text } = result

        // (b) Status strict: status === true — everything else is a hard error.
        if( status !== true ) {
            PromptGenerator.#throwFindings( { messages: [ PromptGenerator.#finding( { code: 'PGEN-032', location: placeholderKey, detail: `function '${functionName}' did not return status === true (strict check), got ${PromptGenerator.#describeValueType( { value: status } )}` } ) ] } )
        }

        // (c) Text: non-empty string — double-check, trust never replaces a check.
        if( PromptGenerator.#isNonEmptyString( { value: text } ) === false ) {
            PromptGenerator.#throwFindings( { messages: [ PromptGenerator.#finding( { code: 'PGEN-033', location: placeholderKey, detail: `function '${functionName}' must return a non-empty string 'text', got ${PromptGenerator.#describeValueType( { value: text } )}` } ) ] } )
        }

        PromptGenerator.#assertNoNullByte( { text, location: placeholderKey, detail: `function '${functionName}' returned text containing a null byte` } )

        return { text, functionName }
    }


    static #assertNoNullByte( { text, location, detail } ) {
        if( text.includes( '\u0000' ) ) {
            PromptGenerator.#throwFindings( { messages: [ PromptGenerator.#finding( { code: 'PGEN-052', location, detail } ) ] } )
        }
    }


    // SINGLE-PASS substitution: the template is split ONCE at its tokens;
    // resolved values are inserted as inert segments and never re-scanned.
    // A {{...}} token carried in by a value therefore survives composition
    // and is caught by the stage-6 torso check — never silently substituted.
    static #substituteSinglePass( { templateText, resolvedPlaceholders } ) {
        const segments = templateText.split( TOKEN_SPLIT_PATTERN )
        const prompt = segments
            .map( ( segment ) => {
                const tokenMatch = segment.match( TOKEN_EXACT_PATTERN )
                if( tokenMatch === null ) { return segment }
                const tokenKey = tokenMatch[ 1 ]
                const resolvedEntry = resolvedPlaceholders[ tokenKey ]
                // Coverage was enforced in stage 2 — an uncovered token here is
                // unreachable; it is kept verbatim and fails the torso check.
                if( resolvedEntry === undefined ) { return segment }
                return resolvedEntry.text
            } )
            .join( '' )

        return prompt
    }


    static #buildMetadata( { templateResolved, resolvedPlaceholders, prompt } ) {
        const placeholderMetadata = Object.entries( resolvedPlaceholders )
            .reduce( ( accumulator, [ placeholderKey, resolvedEntry ] ) => {
                const description = PromptGenerator.#describeText( {
                    source: resolvedEntry.source,
                    filePath: resolvedEntry.filePath,
                    functionName: resolvedEntry.functionName,
                    text: resolvedEntry.text
                } )
                accumulator[ placeholderKey ] = description
                return accumulator
            }, {} )

        const templateMetadata = PromptGenerator.#describeText( {
            source: templateResolved.source,
            filePath: templateResolved.filePath,
            functionName: undefined,
            text: templateResolved.text
        } )
        const promptMetadata = PromptGenerator.#describeText( {
            source: 'generated',
            filePath: undefined,
            functionName: undefined,
            text: prompt
        } )

        return {
            template: templateMetadata,
            placeholders: placeholderMetadata,
            prompt: promptMetadata
        }
    }


    static #describeText( { source, filePath, functionName, text } ) {
        const description = {
            source,
            length: text.length,
            hash: PromptGenerator.#sha256Hex( { text } )
        }
        if( filePath !== undefined ) { description.filePath = filePath }
        if( functionName !== undefined ) { description.functionName = functionName }

        return description
    }


    static #sha256Hex( { text } ) {
        const hash = createHash( 'sha256' )
            .update( text, 'utf8' )
            .digest( 'hex' )

        return hash
    }


    // Every finding is built from the frozen PGEN registry — an unknown code
    // is an internal defect and fails loudly (single source of truth).
    static #finding( { code, location, detail } ) {
        const registryEntry = ERROR_CODES[ code ]
        if( registryEntry === undefined ) {
            throw new Error( `PromptGenerator internal: error code '${code}' is not defined in the PGEN registry` )
        }
        const finding = `${code} ${location}: ${detail}`

        return finding
    }


    static #assertStruct( { struct } ) {
        if( struct.status === true ) { return }
        PromptGenerator.#throwFindings( { messages: struct.messages } )
    }


    static #throwFindings( { messages } ) {
        throw new Error( `PromptGenerator.generate: ${messages.join( '; ' )}` )
    }


    static #describeValueType( { value } ) {
        if( value === null ) { return 'null' }
        if( Array.isArray( value ) ) { return 'array' }

        return typeof value
    }


    static #isMissing( { value } ) {
        const isMissing = [ undefined, null ].includes( value )

        return isMissing
    }


    static #isPlainObject( { value } ) {
        const isObject = value !== null && typeof value === 'object' && Array.isArray( value ) === false

        return isObject
    }


    static #isNonEmptyString( { value } ) {
        const isValid = typeof value === 'string' && value.trim() !== ''

        return isValid
    }
}


export { PromptGenerator, DEFAULT_MAX_PROMPT_LENGTH, DEFAULT_MAX_PLACEHOLDER_VALUE_LENGTH }
