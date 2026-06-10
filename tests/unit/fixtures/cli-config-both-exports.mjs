/**
 * Fixture config — INVALID: exports both 'units' and 'buildUnits'
 * (exactly one export form is required, PRD-005 requirement 3).
 */

export const units = [
    {
        'id': 'unit-x',
        'payload': {
            'template': { 'type': 'string', 'value': 'x {{A}}' },
            'placeholders': { 'A': { 'type': 'string', 'value': 'a' } }
        }
    }
]

export async function buildUnits() {
    return { 'units': units }
}
