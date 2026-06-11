/**
 * Example only — the deposited Tool/Requirement entries for this use case.
 * Each entry follows the schema in tool-requirement.schema.md
 * ( tool, appliesTo, validationTactic, requirement ). This module is plain
 * data plus a small selector; it is NOT part of the package API and nothing
 * in src/ imports it.
 *
 * A real deployment would source these from the calibration layer (own
 * phase). Here they are inline so the example stays self-contained.
 */


// The five tools named in the memo, one deposited entry each. Several entries
// may share a tool with different tactics; the selector picks exactly one.
const TOOL_ENTRIES = [
    {
        'tool': 'Pencil',
        'appliesTo': 'frontend-design-conformance',
        'validationTactic': 'Pencil->Playwright Soll/Ist screenshot diff (cf. image-pencil-playwright-diff)',
        'requirement': 'A built view must match its Pencil (.pen) design: extract a Soll-spec of named components, assert computed styles, screenshot both sides.'
    },
    {
        'tool': 'Playwright',
        'appliesTo': 'browser-ui-behaviour',
        'validationTactic': 'Drive the running app via Playwright CLI (default 95%), MCP only as the exception',
        'requirement': 'Critical user flows are exercised against the running app, not only against tests.'
    },
    {
        'tool': 'get-sheet',
        'appliesTo': 'spreadsheet-data-input',
        'validationTactic': 'Fetch the sheet via get-sheet and assert row/column shape before use',
        'requirement': 'Data pulled from a sheet is shape-checked (expected columns present) before it feeds downstream work.'
    },
    {
        'tool': 'getui',
        'appliesTo': 'local-html-ui-component',
        'validationTactic': 'Resolve the component via getui search/get and verify it renders in isolation',
        'requirement': 'A UI component sourced from getui is verified to render standalone before integration.'
    },
    {
        'tool': 'FlowMCP',
        'appliesTo': 'external-data-api',
        'validationTactic': 'flowmcp search -> flowmcp call and assert the response contract',
        'requirement': 'Data sourced through FlowMCP comes from a search->call workflow and the response shape is asserted.'
    }
]


// Selects exactly one entry by tool name. A missing tool is a hard error with
// the list of known tools — never a silent fallback to some default entry.
const selectEntry = ( { tool } ) => {
    const match = TOOL_ENTRIES
        .find( ( entry ) => {
            const isMatch = entry.tool === tool
            return isMatch
        } )

    if( match === undefined ) {
        const known = TOOL_ENTRIES
            .map( ( entry ) => {
                const { tool: entryTool } = entry
                return entryTool
            } )
            .join( ', ' )
        throw new Error( `tool '${tool}' has no deposited entry — known tools: ${known}` )
    }

    return { 'entry': match }
}


export { TOOL_ENTRIES, selectEntry }
