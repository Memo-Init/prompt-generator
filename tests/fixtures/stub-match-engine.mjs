#!/usr/bin/env node
// stub-match-engine.mjs — deterministic test double for the core match-engine CLI.
// Emits a fixed evalSet JSON regardless of args, so ReqFind.find can be tested
// end-to-end without depending on the live store. Mirrors the --json shape of
// repos/core/skills/evals/memo-req-store/scripts/match-engine.mjs.

const payload = {
    context: { repos: [ 'spec' ], categories: [ 'docs' ], tags: [ 'security' ] },
    count: 2,
    evalSet: [
        { id: 'REQ-002', title: 'Docs-Metadaten stehen nur unten', severity: 'warning', origin: 'predefined', checkKind: 'assertion' },
        { id: 'REQ-001', title: 'Keine hardcoded Secrets in jedem Repo', severity: 'blocker', origin: 'predefined', checkKind: 'tool' }
    ]
}

console.log( JSON.stringify( payload, null, 2 ) )
