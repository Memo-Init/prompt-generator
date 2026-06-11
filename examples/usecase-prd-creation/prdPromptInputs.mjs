/**
 * Example only — PRD-creation consumer code for the prompt-generator. The
 * core generator stays generic; this module knows the prd-creation layout
 * (a memo chapter file on disk) and is therefore NOT part of the package
 * API: nothing in src/ imports it and src/index.mjs does not export it.
 *
 * embedMemoChapter fulfills the generator's function-source contract: on
 * success it returns exactly { status: true, text } with a non-empty text;
 * every finding (missing file, empty content) leads to a hard throw WITH
 * path context — never status true with a torso text. The generator wraps
 * such throws as PGEN-030 with function context and preserved cause.
 */

import { readFile } from 'node:fs/promises'


const assertNonEmptyString = ( { key, value } ) => {
    const isValid = typeof value === 'string' && value.trim() !== ''
    if( isValid === false ) {
        throw new Error( `${key}: must be a non-empty string` )
    }
}


// Reads the memo chapter file and feeds it verbatim into the MEMO_CHAPTER
// placeholder. The source file is read-only input and never modified. Any
// '{{' / '}}' inside the chapter would survive into the prompt as a torso
// token, so they are rewritten losslessly to '[[' / ']]' — the chapter
// content stays readable while the generator's torso check (PGEN-040) only
// guards the template's own tokens.
async function embedMemoChapter( { memoChapterPath } ) {
    assertNonEmptyString( { 'key': 'memoChapterPath', 'value': memoChapterPath } )

    let content
    try {
        content = await readFile( memoChapterPath, 'utf-8' )
    } catch( error ) {
        const reason = error instanceof Error ? error.message : String( error )
        throw new Error( `memo chapter is missing or not readable at '${memoChapterPath}' — ${reason}`, { 'cause': error } )
    }

    if( content.trim() === '' ) {
        throw new Error( `memo chapter at '${memoChapterPath}' is empty or whitespace-only` )
    }

    const text = content
        .split( '{{' )
        .join( '[[' )
        .split( '}}' )
        .join( ']]' )

    return { 'status': true, 'text': text }
}


export { embedMemoChapter }
