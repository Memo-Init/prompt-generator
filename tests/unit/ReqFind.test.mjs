/**
 * Tests for ReqFind (PRD-009 B6).
 *
 * Covers:
 *   - renderBlock determinism: same eval set in -> identical text out, sorted by id
 *   - renderBlock empty case
 *   - find() end-to-end against a deterministic stub match-engine (no live store),
 *     proving the cross-repo subprocess path + render produce a stable block.
 */

import { describe, test, expect } from '@jest/globals'
import { fileURLToPath } from 'node:url'

import { ReqFind } from '../../src/ReqFind.mjs'


const stubEnginePath = fileURLToPath( new URL( '../fixtures/stub-match-engine.mjs', import.meta.url ) )


describe( 'ReqFind.renderBlock', () => {
    test( 'renders a deterministic, id-sorted block', () => {
        const evalSet = [
            { id: 'REQ-020', title: 'B', severity: 'blocker', checkKind: 'assertion' },
            { id: 'REQ-001', title: 'A', severity: 'blocker', checkKind: 'tool' }
        ]

        const first = ReqFind.renderBlock( { evalSet } )
        const second = ReqFind.renderBlock( { evalSet } )

        expect( first.block ).toBe( second.block )
        expect( first.block ).toBe(
            '## Requirements (2)\n\n- REQ-001 [blocker] (tool) A\n- REQ-020 [blocker] (assertion) B\n'
        )
    } )

    test( 'empty eval set renders a (0) block', () => {
        const { block } = ReqFind.renderBlock( { evalSet: [] } )

        expect( block ).toBe( '## Requirements (0)\n\n(no matching requirements)\n' )
    } )
} )


describe( 'ReqFind.find (subprocess against a stub engine)', () => {
    test( 'maps a fixed match result onto a fixed block', () => {
        const { block, evalSet } = ReqFind.find( { repos: [ 'spec' ], keywords: [ 'secrets', 'docs' ], enginePath: stubEnginePath } )

        expect( evalSet ).toHaveLength( 2 )
        expect( block ).toBe(
            '## Requirements (2)\n\n- REQ-001 [blocker] (tool) Keine hardcoded Secrets in jedem Repo\n- REQ-002 [warning] (assertion) Docs-Metadaten stehen nur unten\n'
        )
    } )
} )
