#!/usr/bin/env node
/**
 * req-find — CLI entry for `req find` (PRD-009 B6).
 *
 * Thin CLI: argument parsing, printing and exit code ONLY. The matching itself is
 * delegated to the core match-engine via ReqFind (no engine copy). Renders a
 * deterministic requirements block to stdout.
 *
 * Usage: node src/req-find.mjs --repos=<a,b> --keywords=<x,y>
 */

import { parseArgs } from 'node:util'

import { ReqFind } from './ReqFind.mjs'


const USAGE_LINE = 'Usage: node src/req-find.mjs --repos=<a,b> --keywords=<x,y>'

const splitList = ( { value } ) => {
    return typeof value === 'string' && value.length > 0
        ? value.split( ',' ).map( ( item ) => item.trim() ).filter( ( item ) => item.length > 0 )
        : []
}


try {
    const { values } = parseArgs( {
        'args': process.argv.slice( 2 ),
        'options': {
            'repos': { 'type': 'string' },
            'keywords': { 'type': 'string' }
        },
        'strict': true
    } )
    const repos = splitList( { value: values.repos } )
    const keywords = splitList( { value: values.keywords } )

    const { block } = ReqFind.find( { repos, keywords } )
    console.log( block )
} catch( error ) {
    const message = error instanceof Error ? error.message : String( error )
    console.error( message )
    console.error( USAGE_LINE )
    process.exitCode = 1
}
