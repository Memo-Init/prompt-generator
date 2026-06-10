/**
 * Example wiring for this workspace — run from the FlowMCP project root
 * (the directory that contains _grading/ and .memo/):
 *
 *   node repos/flowmcp-prompt-generator/src/cli.mjs \
 *       --config=repos/flowmcp-prompt-generator/examples/usecase-about/config.about.mjs \
 *       --out=.tmp/prompts-about/
 *
 * Real batches derive their units from a worklist/scan file — never
 * hardcode quantities. The two namespaces below are the deliberate trial
 * candidates of this example, not a catalog.
 *
 * NOTE: the workspace paths below (.memo/…, _grading/…, .tmp/…) belong to
 * this specific workspace and must be replaced before any publication of
 * this repository.
 */

import { fileURLToPath } from 'node:url'

import { buildStepPlan, embedAboutTemplate } from './aboutPromptInputs.mjs'


// The prompt template ships next to this config — resolved module-relative.
const promptTemplatePath = fileURLToPath( new URL( './templates/about-prompt.md', import.meta.url ) )

// Workspace inputs — relative to the FlowMCP project root (= CWD of the run).
const gradingProvidersDir = '_grading/providers'
const aboutTemplatePath = '.memo/129-schema-qualitaetsstufe-output-lizenz-about/assets/about-template.md'


const buildAboutUnit = ( { namespace } ) => {
    const unit = {
        'id': `about-${namespace}`,
        'payload': {
            'template': { 'type': 'file', 'filePath': promptTemplatePath },
            'placeholders': {
                'NAMESPACE': { 'type': 'string', 'value': namespace },
                'STEP_PLAN': { 'type': 'function', 'fn': buildStepPlan, 'args': { namespace, gradingProvidersDir } },
                'ABOUT_TEMPLATE': { 'type': 'function', 'fn': embedAboutTemplate, 'args': { aboutTemplatePath } },
                'OUTPUT_PATH': { 'type': 'string', 'value': `.tmp/about-erprobung/${namespace}-about.md` }
            }
        }
    }

    return unit
}


export const units = [
    buildAboutUnit( { 'namespace': 'brightsky' } ),
    buildAboutUnit( { 'namespace': 'berlinwfs' } )
]
