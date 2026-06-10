/**
 * PromptGeneratorCli — batch composition from a config module to files.
 *
 * One public static method: run( { configPath, outDir } ). It loads a
 * config module via dynamic import, obtains the units (static export
 * 'units' OR factory export 'buildUnits' — exactly one form), composes
 * every unit through PromptGenerator.generate() and writes one prompt
 * file per unit plus a manifest.json into outDir.
 *
 * Contracts (PRD-005):
 *   - config module exports EXACTLY ONE of:
 *       export const units = [ { id, payload }, … ]
 *       export async function buildUnits() { … return { units } }
 *   - unit ids must match ^[A-Za-z0-9][A-Za-z0-9_-]*$ and be unique
 *   - composition is sequential and fail-fast: the first failing unit
 *     aborts the whole run, its error message is augmented with the unit
 *     id and rethrown unchanged (PGEN codes stay visible)
 *   - all-or-nothing write phase: nothing is written before EVERY unit
 *     composed successfully; an existing target file is a hard error
 *     listing ALL colliding paths — there is no force/overwrite mode
 *   - CLI-level errors are hard throws with method context
 *     ('PromptGeneratorCli.run: …'); no PGEN codes are minted here
 *
 * This class never touches process.argv, process.exit or stdout — the
 * thin entry src/cli.mjs owns argument parsing, printing and exit codes.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { PromptGenerator } from './PromptGenerator.mjs'


const UNIT_REQUIRED_KEYS = [ 'id', 'payload' ]

// Unit ids become file names — restricted to a safe portable subset.
const UNIT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

const MANIFEST_FILE_NAME = 'manifest.json'

// First 12 hex characters of the prompt sha256 shown in the summary lines.
const SUMMARY_HASH_PREFIX_LENGTH = 12


class PromptGeneratorCli {
    static async run( { configPath, outDir } ) {
        // Stage 1 — argument validation (no default paths, no silent fallbacks)
        const argumentValidation = PromptGeneratorCli.#validationRunArguments( { configPath, outDir } )
        PromptGeneratorCli.#assertMessages( { messages: argumentValidation.messages } )

        // Stage 2 — load the config module and obtain the units (exactly one export form)
        const configModule = await PromptGeneratorCli.#loadConfigModule( { configPath } )
        const { units } = await PromptGeneratorCli.#resolveConfigUnits( { configModule, configPath } )

        // Stage 3 — unit-list validation (shape, ids, duplicates) before any composition
        const unitValidation = PromptGeneratorCli.#validationUnits( { units } )
        PromptGeneratorCli.#assertMessages( { messages: unitValidation.messages } )

        // Stage 4 — sequential, fail-fast composition (payloads pass through unchanged)
        const composedUnits = await PromptGeneratorCli.#composeUnits( { units } )

        // Stage 5 — all-or-nothing write phase (collision check first, then write)
        const targets = composedUnits
            .map( ( composedUnit ) => {
                const { id } = composedUnit
                const file = `${id}.md`
                const target = { id, file, 'path': join( outDir, file ) }

                return target
            } )
        const manifestPath = join( outDir, MANIFEST_FILE_NAME )
        const targetPaths = targets
            .map( ( target ) => {
                const { path } = target
                return path
            } )
            .concat( [ manifestPath ] )
        await PromptGeneratorCli.#assertNoCollisions( { targetPaths } )

        const generator = await PromptGeneratorCli.#readGeneratorInfo()
        const { manifest } = PromptGeneratorCli.#buildManifest( { configPath, generator, composedUnits, targets } )
        await PromptGeneratorCli.#writeOutputs( { outDir, composedUnits, targets, manifest, manifestPath } )

        const summaryLines = PromptGeneratorCli.#buildSummaryLines( { composedUnits, targets, manifestPath } )

        return {
            summaryLines,
            manifestPath,
            'unitCount': composedUnits.length,
            'writtenFiles': targets
        }
    }


    static #validationRunArguments( { configPath, outDir } ) {
        const messages = []

        if( PromptGeneratorCli.#isNonEmptyString( { value: configPath } ) === false ) {
            messages.push( `configPath: must be a non-empty string (--config=<payload.mjs>), got ${PromptGeneratorCli.#describeValueType( { value: configPath } )}` )
        }
        if( PromptGeneratorCli.#isNonEmptyString( { value: outDir } ) === false ) {
            messages.push( `outDir: must be a non-empty string (--out=<dir>), got ${PromptGeneratorCli.#describeValueType( { value: outDir } )}` )
        }

        return { messages }
    }


    static async #loadConfigModule( { configPath } ) {
        // resolve() + pathToFileURL() works for relative AND absolute paths.
        const moduleUrl = pathToFileURL( resolve( configPath ) ).href

        let configModule
        try {
            configModule = await import( moduleUrl )
        } catch( error ) {
            const reason = error instanceof Error ? error.message : String( error )
            throw new Error( `PromptGeneratorCli.run: config module could not be loaded from '${configPath}' — ${reason}`, { 'cause': error } )
        }

        return configModule
    }


    static async #resolveConfigUnits( { configModule, configPath } ) {
        const exportKeys = Object.keys( configModule )
        const hasUnits = exportKeys.includes( 'units' )
        const hasFactory = exportKeys.includes( 'buildUnits' )

        if( hasUnits === true && hasFactory === true ) {
            PromptGeneratorCli.#assertMessages( { messages: [ `config module '${configPath}' exports both 'units' and 'buildUnits' — exactly one export form is required` ] } )
        }
        if( hasUnits === false && hasFactory === false ) {
            PromptGeneratorCli.#assertMessages( { messages: [ `config module '${configPath}' exports neither 'units' nor 'buildUnits' — exactly one export form is required` ] } )
        }

        if( hasUnits === true ) {
            const { units } = configModule
            return { units }
        }

        const { buildUnits } = configModule
        if( typeof buildUnits !== 'function' ) {
            PromptGeneratorCli.#assertMessages( { messages: [ `config export 'buildUnits' must be a function, got ${PromptGeneratorCli.#describeValueType( { value: buildUnits } )}` ] } )
        }

        let factoryResult
        try {
            factoryResult = await buildUnits()
        } catch( error ) {
            const reason = error instanceof Error ? error.message : String( error )
            throw new Error( `PromptGeneratorCli.run: config factory 'buildUnits' threw an exception or rejected — ${reason}`, { 'cause': error } )
        }

        if( Array.isArray( factoryResult ) ) {
            PromptGeneratorCli.#assertMessages( { messages: [ "config factory 'buildUnits' must return an object { units } — got a bare array (object returns, never the naked array)" ] } )
        }
        if( PromptGeneratorCli.#isPlainObject( { value: factoryResult } ) === false ) {
            PromptGeneratorCli.#assertMessages( { messages: [ `config factory 'buildUnits' must return an object { units }, got ${PromptGeneratorCli.#describeValueType( { value: factoryResult } )}` ] } )
        }
        if( Object.keys( factoryResult ).includes( 'units' ) === false ) {
            PromptGeneratorCli.#assertMessages( { messages: [ "config factory 'buildUnits' result is missing the 'units' key — expected shape is { units }" ] } )
        }

        const { units } = factoryResult

        return { units }
    }


    static #validationUnits( { units } ) {
        const messages = []

        if( Array.isArray( units ) === false ) {
            messages.push( `units: must be an array of { id, payload } entries, got ${PromptGeneratorCli.#describeValueType( { value: units } )}` )
            return { messages }
        }
        if( units.length === 0 ) {
            messages.push( 'units: must contain at least one entry — an empty units array is forbidden' )
            return { messages }
        }

        units
            .forEach( ( unit, unitIndex ) => {
                const location = `units[${unitIndex}]`

                if( PromptGeneratorCli.#isPlainObject( { value: unit } ) === false ) {
                    messages.push( `${location}: must be a plain object with exactly the keys { id, payload }, got ${PromptGeneratorCli.#describeValueType( { value: unit } )}` )
                    return
                }

                const presentKeys = Object.keys( unit )
                const unknownKeys = presentKeys
                    .filter( ( presentKey ) => {
                        const isAllowed = UNIT_REQUIRED_KEYS.includes( presentKey )
                        return isAllowed === false
                    } )
                if( unknownKeys.length > 0 ) {
                    messages.push( `${location}: unknown key(s): ${unknownKeys.join( ', ' )} — allowed keys are exactly ${UNIT_REQUIRED_KEYS.join( ', ' )}` )
                }

                const { id, payload } = unit

                if( PromptGeneratorCli.#isMissing( { value: id } ) ) {
                    messages.push( `${location}.id: required key is missing (undefined or null)` )
                } else if( typeof id !== 'string' ) {
                    messages.push( `${location}.id: must be a string, got ${PromptGeneratorCli.#describeValueType( { value: id } )}` )
                } else if( UNIT_ID_PATTERN.test( id ) === false ) {
                    messages.push( `${location}.id: must match ^[A-Za-z0-9][A-Za-z0-9_-]*$ to be usable as a file name, got '${id}'` )
                }

                if( PromptGeneratorCli.#isMissing( { value: payload } ) ) {
                    messages.push( `${location}.payload: required key is missing (undefined or null)` )
                } else if( PromptGeneratorCli.#isPlainObject( { value: payload } ) === false ) {
                    messages.push( `${location}.payload: must be a plain object, got ${PromptGeneratorCli.#describeValueType( { value: payload } )}` )
                }
            } )

        const duplicateIds = PromptGeneratorCli.#findDuplicateIds( { units } )
        if( duplicateIds.length > 0 ) {
            messages.push( `units: duplicate unit id(s): ${duplicateIds.join( ', ' )} — every id must be unique` )
        }

        return { messages }
    }


    static #findDuplicateIds( { units } ) {
        const idCounts = units
            .filter( ( unit ) => {
                const isObject = PromptGeneratorCli.#isPlainObject( { value: unit } )
                return isObject
            } )
            .map( ( unit ) => {
                const { id } = unit
                return id
            } )
            .filter( ( id ) => {
                const isString = typeof id === 'string'
                return isString
            } )
            .reduce( ( accumulator, id ) => {
                const currentCount = accumulator[ id ] === undefined ? 0 : accumulator[ id ]
                accumulator[ id ] = currentCount + 1
                return accumulator
            }, {} )
        const duplicateIds = Object.entries( idCounts )
            .filter( ( [ , idCount ] ) => {
                const isDuplicate = idCount > 1
                return isDuplicate
            } )
            .map( ( [ id ] ) => {
                return id
            } )

        return duplicateIds
    }


    // Sequential, fail-fast composition in config order — the first failing
    // unit aborts the whole run; its message is augmented with the unit id
    // and rethrown unchanged (PGEN codes stay visible, cause preserved).
    static async #composeUnits( { units } ) {
        const composedUnits = await units
            .reduce( async ( accumulatorPromise, unit ) => {
                const accumulator = await accumulatorPromise
                const { id, payload } = unit

                let result
                try {
                    result = await PromptGenerator.generate( payload )
                } catch( error ) {
                    const reason = error instanceof Error ? error.message : String( error )
                    throw new Error( `PromptGeneratorCli.run: unit '${id}' failed — ${reason}`, { 'cause': error } )
                }

                const { prompt, metadata } = result
                accumulator.push( { id, prompt, metadata } )

                return accumulator
            }, Promise.resolve( [] ) )

        return composedUnits
    }


    static async #assertNoCollisions( { targetPaths } ) {
        const existenceChecks = await Promise.all( targetPaths
            .map( async ( targetPath ) => {
                const exists = await PromptGeneratorCli.#pathExists( { targetPath } )
                return { targetPath, exists }
            } )
        )
        const collisions = existenceChecks
            .filter( ( existenceCheck ) => {
                const { exists } = existenceCheck
                return exists
            } )
            .map( ( existenceCheck ) => {
                const { targetPath } = existenceCheck
                return targetPath
            } )

        if( collisions.length > 0 ) {
            PromptGeneratorCli.#assertMessages( { messages: [ `output collision — the following target file(s) already exist: ${collisions.join( ', ' )} — nothing was written; there is no overwrite mode, re-run against a fresh or emptied directory` ] } )
        }
    }


    static async #pathExists( { targetPath } ) {
        let exists = true
        try {
            await stat( targetPath )
        } catch( error ) {
            if( error.code !== 'ENOENT' ) {
                const reason = error instanceof Error ? error.message : String( error )
                throw new Error( `PromptGeneratorCli.run: output path '${targetPath}' could not be checked — ${reason}`, { 'cause': error } )
            }
            exists = false
        }

        return exists
    }


    static async #readGeneratorInfo() {
        const packagePath = fileURLToPath( new URL( '../package.json', import.meta.url ) )
        const packageText = await readFile( packagePath, 'utf-8' )
        const { name, version } = JSON.parse( packageText )

        const fields = [ [ 'name', name ], [ 'version', version ] ]
        fields
            .forEach( ( [ fieldKey, fieldValue ] ) => {
                if( PromptGeneratorCli.#isNonEmptyString( { value: fieldValue } ) === false ) {
                    PromptGeneratorCli.#assertMessages( { messages: [ `own package.json is missing a non-empty '${fieldKey}' field` ] } )
                }
            } )

        return { name, version }
    }


    // Manifest field names come straight from the generate() metadata —
    // one source of truth, no renaming. configPath stays exactly as passed
    // on the CLI (never absolutized — no user paths in the artifact).
    static #buildManifest( { configPath, generator, composedUnits, targets } ) {
        const units = composedUnits
            .map( ( composedUnit, unitIndex ) => {
                const { id, metadata } = composedUnit
                const { file } = targets[ unitIndex ]
                const unitRecord = {
                    id,
                    file,
                    'prompt': metadata.prompt,
                    'placeholders': metadata.placeholders,
                    'template': metadata.template
                }

                return unitRecord
            } )
        const manifest = {
            generator,
            configPath,
            'generatedAt': new Date().toISOString(),
            units
        }

        return { manifest }
    }


    // Write phase — only reached after every unit composed successfully and
    // the collision check passed. The 'wx' flag is a second guard: even a
    // file appearing mid-run is never overwritten silently.
    static async #writeOutputs( { outDir, composedUnits, targets, manifest, manifestPath } ) {
        try {
            await mkdir( outDir, { 'recursive': true } )
        } catch( error ) {
            const reason = error instanceof Error ? error.message : String( error )
            throw new Error( `PromptGeneratorCli.run: output directory '${outDir}' could not be created — ${reason}`, { 'cause': error } )
        }

        const promptJobs = targets
            .map( ( target, targetIndex ) => {
                const { path } = target
                const { prompt } = composedUnits[ targetIndex ]
                const writeJob = { path, 'content': prompt }

                return writeJob
            } )
        const manifestContent = `${JSON.stringify( manifest, null, 4 )}\n`
        const writeJobs = promptJobs
            .concat( [ { 'path': manifestPath, 'content': manifestContent } ] )

        await writeJobs
            .reduce( async ( previousPromise, writeJob ) => {
                await previousPromise
                const { path, content } = writeJob
                await writeFile( path, content, { 'encoding': 'utf-8', 'flag': 'wx' } )
                return undefined
            }, Promise.resolve( undefined ) )
    }


    static #buildSummaryLines( { composedUnits, targets, manifestPath } ) {
        const summaryLines = targets
            .map( ( target, targetIndex ) => {
                const { path } = target
                const { metadata } = composedUnits[ targetIndex ]
                const hashPrefix = metadata.prompt.hash.slice( 0, SUMMARY_HASH_PREFIX_LENGTH )
                const summaryLine = `written ${path} (${metadata.prompt.length} chars, sha256 ${hashPrefix})`

                return summaryLine
            } )
            .concat( [ `manifest: ${manifestPath}`, `units: ${composedUnits.length}` ] )

        return summaryLines
    }


    static #assertMessages( { messages } ) {
        if( messages.length === 0 ) { return }
        throw new Error( `PromptGeneratorCli.run: ${messages.join( '; ' )}` )
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


export { PromptGeneratorCli }
