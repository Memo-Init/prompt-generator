/**
 * Example wiring for the tool-requirement use case — run from the
 * prompt-generator repo root:
 *
 *   node src/cli.mjs \
 *       --config=examples/usecase-tool-requirement/config.tool-requirement.mjs \
 *       --out=.tmp/prompts-tool-requirement/
 *
 * It shows how a deposited Tool/Requirement entry (schema in
 * tool-requirement.schema.md) reaches a work prompt as a typed placeholder.
 * The entry is rendered via a `function` source so the strict contract
 * { status: true, text } is exercised — the natural docking point for
 * "select the tool/requirement, render it, then compose".
 *
 * This config uses the `buildUnits` export form (PRD-009): buildUnits is the
 * natural place to assemble Tools/Requirements dynamically before
 * composition. The two trial units below select two different deposited
 * tools (Pencil, FlowMCP) — they are the deliberate candidates of this
 * example, not a catalog. A real batch derives its units and tool selection
 * from the calibration layer (own phase) and never hardcodes quantities.
 */

import { fileURLToPath } from 'node:url'

import { renderToolRequirement } from './toolRequirementInputs.mjs'


// The work prompt template ships next to this config — resolved
// module-relative so the example runs from any working directory.
const promptTemplatePath = fileURLToPath( new URL( './templates/tool-requirement-prompt.md', import.meta.url ) )


const buildWorkUnit = ( { id, workTitle, workDescription, tool } ) => {
    const unit = {
        id,
        'payload': {
            'template': { 'type': 'file', 'filePath': promptTemplatePath },
            'placeholders': {
                'WORK_TITLE': { 'type': 'string', 'value': workTitle },
                'WORK_DESCRIPTION': { 'type': 'string', 'value': workDescription },
                'TOOL_REQUIREMENT': { 'type': 'function', 'fn': renderToolRequirement, 'args': { tool } }
            }
        }
    }

    return unit
}


async function buildUnits() {
    const units = [
        buildWorkUnit( {
            'id': 'work-design-pass',
            'workTitle': 'Implement the settings view',
            'workDescription': 'Build the settings view from its Pencil mockup so the result matches the design.',
            'tool': 'Pencil'
        } ),
        buildWorkUnit( {
            'id': 'work-data-pull',
            'workTitle': 'Show live token prices',
            'workDescription': 'Add a panel that displays live token prices sourced from an external data API.',
            'tool': 'FlowMCP'
        } )
    ]

    return { units }
}


export { buildUnits }
