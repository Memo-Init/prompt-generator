/**
 * Fixture config — factory form: buildUnits() returns { units },
 * never the naked array (PRD-005 requirement 3).
 */

export async function buildUnits() {
    const units = [
        {
            'id': 'factory-unit',
            'payload': {
                'template': { 'type': 'string', 'value': 'factory says {{NAME}}' },
                'placeholders': { 'NAME': { 'type': 'string', 'value': 'from-factory' } }
            }
        }
    ]

    return { units }
}
