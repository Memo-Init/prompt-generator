/**
 * Example only — tool-requirement consumer code for the prompt-generator.
 * The core generator stays generic; this module knows the entry schema
 * ( tool, appliesTo, validationTactic, requirement ) and renders a selected
 * entry into the TOOL_REQUIREMENT placeholder text. It is NOT part of the
 * package API: nothing in src/ imports it and src/index.mjs does not export
 * it.
 *
 * renderToolRequirement fulfills the generator's function-source contract:
 * on success it returns exactly { status: true, text } with a non-empty
 * text; a missing entry or an empty field leads to a hard throw WITH
 * context — never status true with a torso text. The generator wraps such
 * throws as PGEN-030 with function context and preserved cause.
 */

import { selectEntry } from './entries/tool-entries.mjs'


const assertNonEmptyString = ( { key, value } ) => {
    const isValid = typeof value === 'string' && value.trim() !== ''
    if( isValid === false ) {
        throw new Error( `${key}: must be a non-empty string` )
    }
}


// Looks up the deposited entry for `tool`, asserts every field is present and
// non-empty, then renders the readable block embedded into the prompt. Two
// runs over the same entry produce the identical text (deterministic).
function renderToolRequirement( { tool } ) {
    assertNonEmptyString( { 'key': 'tool', 'value': tool } )

    const { entry } = selectEntry( { tool } )
    const fieldKeys = [ 'tool', 'appliesTo', 'validationTactic', 'requirement' ]
    fieldKeys
        .forEach( ( fieldKey ) => {
            const fieldValue = entry[ fieldKey ]
            assertNonEmptyString( { 'key': `entry.${fieldKey}`, 'value': fieldValue } )
        } )

    const lines = [
        `Tool:              ${entry.tool}`,
        `Applies to:        ${entry.appliesTo}`,
        `Validation tactic: ${entry.validationTactic}`,
        `Requirement:       ${entry.requirement}`
    ]
    const text = lines.join( '\n' )

    return { 'status': true, 'text': text }
}


export { renderToolRequirement }
