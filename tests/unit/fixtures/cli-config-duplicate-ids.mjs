/**
 * Fixture config — INVALID: two units share the same id
 * (PRD-005 requirement 4: duplicate ids are a hard error).
 */

export const units = [
    {
        'id': 'dup-unit',
        'payload': {
            'template': { 'type': 'string', 'value': 'first {{A}}' },
            'placeholders': { 'A': { 'type': 'string', 'value': 'one' } }
        }
    },
    {
        'id': 'dup-unit',
        'payload': {
            'template': { 'type': 'string', 'value': 'second {{A}}' },
            'placeholders': { 'A': { 'type': 'string', 'value': 'two' } }
        }
    }
]
