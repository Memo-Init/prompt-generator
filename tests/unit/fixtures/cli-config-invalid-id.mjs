/**
 * Fixture config — INVALID: unit id violates the file-name-safe pattern
 * ^[A-Za-z0-9][A-Za-z0-9_-]*$ (PRD-005 requirement 4).
 */

export const units = [
    {
        'id': '../escape attempt',
        'payload': {
            'template': { 'type': 'string', 'value': 'x {{A}}' },
            'placeholders': { 'A': { 'type': 'string', 'value': 'a' } }
        }
    }
]
