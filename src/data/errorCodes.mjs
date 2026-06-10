/**
 * PGEN error-code registry — the single source of truth for the
 * PromptGenerator class AND its tests.
 *
 * Format per entry: code -> { category, description, severity }
 *   - code matches ^PGEN-\d{3}$ (PREFIX-NUMBER, three digits, zero-padded)
 *   - one number range per category:
 *       001-009 parameter        (payload structure, types, emptiness)
 *       005     composition      (type anomaly caught before composition)
 *       010-019 template         (token grammar + bidirectional coverage)
 *       020-029 source-file      (file sources: missing, empty)
 *       030-039 source-function  (function contract, double-checked)
 *       040-049 torso            (unresolved tokens after substitution)
 *       050-059 limits           (length guards, encoding)
 *
 * All codes carry severity ERROR in v1: every finding triggers a hard
 * throw — no prompt ever leaves the generator with findings. The severity
 * column is kept for registry conformity and future extensibility.
 *
 * Reserved, unassigned numbers inside the ranges (006-009, 014-019,
 * 022-029, 034-039, 041-049, 053-059) stay free for extensions. Assigned
 * numbers are NEVER reused with a different meaning.
 */

const ERROR_CODES = Object.freeze( {
    'PGEN-001': Object.freeze( {
        'category': 'parameter',
        'description': 'Required parameter missing — undefined or null at a mandatory position (payload, template, placeholders, entry fields)',
        'severity': 'ERROR'
    } ),
    'PGEN-002': Object.freeze( {
        'category': 'parameter',
        'description': 'Type mismatch for parameter — value does not have the required type or structure',
        'severity': 'ERROR'
    } ),
    'PGEN-003': Object.freeze( {
        'category': 'parameter',
        'description': 'Parameter or value must not be empty — empty strings and empty placeholder sets are forbidden',
        'severity': 'ERROR'
    } ),
    'PGEN-004': Object.freeze( {
        'category': 'parameter',
        'description': "Invalid source type — not one of 'string', 'file', 'function' (no shorthand, no implicit types)",
        'severity': 'ERROR'
    } ),
    'PGEN-005': Object.freeze( {
        'category': 'composition',
        'description': 'Substitution value is not a string at composition time — null, undefined, object or number is a type anomaly caught before composition',
        'severity': 'ERROR'
    } ),
    'PGEN-010': Object.freeze( {
        'category': 'template',
        'description': 'Template contains no placeholders — at least one {{KEY}} token is required',
        'severity': 'ERROR'
    } ),
    'PGEN-011': Object.freeze( {
        'category': 'template',
        'description': 'Template placeholder not covered by payload — every template token needs a matching placeholders key',
        'severity': 'ERROR'
    } ),
    'PGEN-012': Object.freeze( {
        'category': 'template',
        'description': 'Payload key not used in template — every placeholders key must occur in the template',
        'severity': 'ERROR'
    } ),
    'PGEN-013': Object.freeze( {
        'category': 'template',
        'description': 'Malformed placeholder token in template — token matches {{...}} but violates the placeholder grammar',
        'severity': 'ERROR'
    } ),
    'PGEN-020': Object.freeze( {
        'category': 'source-file',
        'description': 'Source file is missing or not readable',
        'severity': 'ERROR'
    } ),
    'PGEN-021': Object.freeze( {
        'category': 'source-file',
        'description': 'Source file is empty — whitespace-only content counts as empty',
        'severity': 'ERROR'
    } ),
    'PGEN-030': Object.freeze( {
        'category': 'source-function',
        'description': 'Function threw an exception or returned a rejected promise — caught and rethrown as a coded error with function context',
        'severity': 'ERROR'
    } ),
    'PGEN-031': Object.freeze( {
        'category': 'source-function',
        'description': 'Function returned wrong shape — must be a plain object with exactly the keys { status, text }',
        'severity': 'ERROR'
    } ),
    'PGEN-032': Object.freeze( {
        'category': 'source-function',
        'description': "Function status is not explicitly true — false, 'true', 1 or a missing status is a hard error",
        'severity': 'ERROR'
    } ),
    'PGEN-033': Object.freeze( {
        'category': 'source-function',
        'description': 'Function text is not a non-empty string',
        'severity': 'ERROR'
    } ),
    'PGEN-040': Object.freeze( {
        'category': 'torso',
        'description': 'Unresolved {{...}} token survived substitution — no half-filled prompt ever leaves the generator',
        'severity': 'ERROR'
    } ),
    'PGEN-050': Object.freeze( {
        'category': 'limits',
        'description': 'Composed prompt exceeds maximum length',
        'severity': 'ERROR'
    } ),
    'PGEN-051': Object.freeze( {
        'category': 'limits',
        'description': 'Resolved placeholder value exceeds maximum length',
        'severity': 'ERROR'
    } ),
    'PGEN-052': Object.freeze( {
        'category': 'limits',
        'description': 'Invalid encoding in source content — U+FFFD replacement character or null byte detected',
        'severity': 'ERROR'
    } )
} )


export { ERROR_CODES }
