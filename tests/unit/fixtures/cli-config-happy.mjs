/**
 * Fixture config — happy path (PRD-005 requirement 11).
 * Two units, all three placeholder source types represented.
 */

import { fileURLToPath } from 'node:url'


const personaPath = fileURLToPath( new URL( '../../fixtures/persona-block.md', import.meta.url ) )

const buildStepPlan = async ( { namespace } ) => {
    return { 'status': true, 'text': `1. inspect ${namespace}\n2. write report` }
}


export const units = [
    {
        'id': 'unit-a',
        'payload': {
            'template': { 'type': 'string', 'value': 'NS {{NAMESPACE}}\n{{PERSONA}}\n{{STEP_PLAN}}' },
            'placeholders': {
                'NAMESPACE': { 'type': 'string', 'value': 'alpha' },
                'PERSONA': { 'type': 'file', 'filePath': personaPath },
                'STEP_PLAN': { 'type': 'function', 'fn': buildStepPlan, 'args': { 'namespace': 'alpha' } }
            }
        }
    },
    {
        'id': 'unit-b',
        'payload': {
            'template': { 'type': 'string', 'value': 'only {{NAME}}' },
            'placeholders': { 'NAME': { 'type': 'string', 'value': 'beta' } }
        }
    }
]
