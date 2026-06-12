/**
 * ReqFind — render a deterministic requirements block from a match-engine result.
 *
 * Cross-repo note (PRD-009 B6): the THREE-AXIS match engine is the canonical heart
 * in repos/core/lib/requirements/match.mjs, reached here via its store-reading CLI
 * wrapper repos/core/skills/evals/memo-req-store/scripts/match-engine.mjs (--json).
 * This module does NOT copy the engine (Schrottplatz-Verbot). It only:
 *   1. resolves the path to that CLI and runs it as a child process (runMatchEngine),
 *   2. renders the resulting evalSet into a stable text block (renderBlock).
 * renderBlock is a pure function (no I/O) so the determinism contract — same eval set
 * in, same text out — is unit-testable without spawning a process.
 */

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'


class ReqFind {
    static #engineRelativePath = [ '..', '..', 'core', 'skills', 'evals', 'memo-req-store', 'scripts', 'match-engine.mjs' ]


    static renderBlock( { evalSet } ) {
        const entries = Array.isArray( evalSet ) ? evalSet : []
        const sorted = entries
            .slice()
            .sort( ( a, b ) => a.id.localeCompare( b.id ) )

        if( sorted.length === 0 ) {
            return { block: '## Requirements (0)\n\n(no matching requirements)\n' }
        }

        const lines = sorted
            .map( ( entry ) => `- ${ entry.id } [${ entry.severity }] (${ entry.checkKind }) ${ entry.title }` )
        const block = `## Requirements (${ sorted.length })\n\n${ lines.join( '\n' ) }\n`

        return { block }
    }


    static resolveEnginePath( { fromDir } ) {
        const base = fromDir !== undefined ? fromDir : dirname( fileURLToPath( import.meta.url ) )

        return { enginePath: resolve( base, ...ReqFind.#engineRelativePath ) }
    }


    static runMatchEngine( { repos = [], keywords = [], enginePath } ) {
        const { enginePath: resolvedPath } = enginePath !== undefined
            ? { enginePath }
            : ReqFind.resolveEnginePath( {} )

        const args = [ resolvedPath, '--json' ]
        const withRepos = repos.length > 0 ? [ ...args, '--repos', repos.join( ',' ) ] : args
        const withKeywords = keywords.length > 0 ? [ ...withRepos, '--keywords', keywords.join( ',' ) ] : withRepos

        const result = spawnSync( 'node', withKeywords, { encoding: 'utf-8' } )
        if( result.status !== 0 ) {
            throw new Error( `match-engine failed (exit ${ result.status }): ${ result.stderr }` )
        }

        const parsed = JSON.parse( result.stdout )

        return { evalSet: parsed.evalSet ?? [], context: parsed.context ?? {} }
    }


    static find( { repos = [], keywords = [], enginePath } ) {
        const { evalSet, context } = ReqFind.runMatchEngine( { repos, keywords, enginePath } )
        const { block } = ReqFind.renderBlock( { evalSet } )

        return { block, evalSet, context }
    }
}


export { ReqFind }
