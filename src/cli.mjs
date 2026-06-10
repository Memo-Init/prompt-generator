/**
 * Thin CLI entry — argument parsing, printing and exit code ONLY.
 *
 * Usage: node src/cli.mjs --config=<payload.mjs> --out=<dir>
 *
 * By-design exception (PRD-005): this file is the single place in the
 * repository that reads process.argv (via parseArgs from node:util) and
 * sets the process exit code. The library (PromptGenerator,
 * PromptGeneratorCli) stays free of process access and is testable with
 * plain object parameters.
 *
 * Behavior:
 *   - success: per-unit summary lines plus manifest path to stdout, exit 0
 *   - any error: error message plus usage line to stderr, exit 1
 *   - CLI-level errors are plain-text throws from PromptGeneratorCli;
 *     PGEN errors from the library pass through unchanged (codes visible)
 */

import { parseArgs } from 'node:util'

import { PromptGeneratorCli } from './PromptGeneratorCli.mjs'


const USAGE_LINE = 'Usage: node src/cli.mjs --config=<payload.mjs> --out=<dir>'

try {
    const { values } = parseArgs( {
        'args': process.argv.slice( 2 ),
        'options': {
            'config': { 'type': 'string' },
            'out': { 'type': 'string' }
        },
        'strict': true
    } )
    const { config, out } = values

    const { summaryLines } = await PromptGeneratorCli.run( { 'configPath': config, 'outDir': out } )
    summaryLines
        .forEach( ( summaryLine ) => { console.log( summaryLine ) } )
} catch( error ) {
    const message = error instanceof Error ? error.message : String( error )
    console.error( message )
    console.error( USAGE_LINE )
    process.exitCode = 1
}
