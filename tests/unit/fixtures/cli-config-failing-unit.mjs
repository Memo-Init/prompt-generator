/**
 * Fixture config — fail-fast case: the first unit composes fine, the
 * second unit fails inside PromptGenerator.generate() (PGEN-032: function
 * status is not strictly true). The whole run must abort and write
 * NOTHING (PRD-005 requirements 5 + 6).
 */

const failing = () => {
    return { 'status': false, 'text': '' }
}


export const units = [
    {
        'id': 'unit-ok',
        'payload': {
            'template': { 'type': 'string', 'value': 'fine {{A}}' },
            'placeholders': { 'A': { 'type': 'string', 'value': 'value' } }
        }
    },
    {
        'id': 'unit-bad',
        'payload': {
            'template': { 'type': 'string', 'value': 'x {{P}}' },
            'placeholders': { 'P': { 'type': 'function', 'fn': failing, 'args': {} } }
        }
    }
]
