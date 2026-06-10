/**
 * Fixture config — INVALID on purpose: throws during module evaluation.
 * Loading this module must surface as a clean 'config module could not
 * be loaded' error. A parse-time SyntaxError fixture is intentionally
 * avoided here: Jest's experimental VM-modules runtime leaks link-time
 * errors as a second, unhandled rejection into later tests (the real
 * syntax-error path is covered by the CLI smoke verification instead).
 */

throw new Error( 'broken config module — evaluation failed on purpose' )
