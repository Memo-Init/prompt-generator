# Tool-/Requirement entry schema

This document defines how a Tool or a Requirement is deposited declaratively so
the prompt-generator can feed it into a prompt as a typed placeholder source. It
is the template + the flow — not the full requirements/eval engine (that is the
calibration layer, its own phase). The format and the docking mechanism live
here; the matching engine docks on later.

## Entry fields

Each entry is a plain object with these fields:

| Field | Type | Meaning |
|-------|------|---------|
| `tool` | string | Tool name (Pencil, Playwright, get-sheet, getui, FlowMCP, …). |
| `appliesTo` | string | Which work this entry covers — a category/tag/work description. Later extended with explicit scope axes (repo / category / tag); see "Docking point" below. |
| `validationTactic` | string | One short, selectable validation tactic (e.g. "Pencil→Playwright Soll/Ist screenshot diff"). Several entries may share a `tool` with different tactics — the AI selects one per piece of work. |
| `requirement` | string | The mandatory condition as plain text — what must hold for the work to count as done. |

The format is deliberately readable and selectable: multiple tactics can be
deposited for the same tool, and exactly one is chosen for a given piece of work.

## Example entries (the 5 tools)

| `tool` | `appliesTo` | `validationTactic` | `requirement` |
|--------|-------------|--------------------|---------------|
| Pencil | Frontend design conformance | Pencil→Playwright Soll/Ist screenshot diff (cf. `image-pencil-playwright-diff`) | A built view must match its Pencil (.pen) design: extract a Soll-spec of named components, assert computed styles, screenshot both sides. |
| Playwright | Browser/UI behaviour | Drive the running app via Playwright CLI (default 95%), MCP only as the exception | Critical user flows are exercised against the running app, not only against tests. |
| get-sheet | Spreadsheet data input | Fetch the sheet via `get-sheet` and assert row/column shape before use | Data pulled from a sheet is shape-checked (expected columns present) before it feeds downstream work. |
| getui | Local HTML / UI component lookup | Resolve the component via `getui search`/`get` and verify it renders in isolation | A UI component sourced from getui is verified to render standalone before integration. |
| FlowMCP | External data / API access | `flowmcp search` → `flowmcp call` and assert the response contract | Data sourced through FlowMCP comes from a search→call workflow and the response shape is asserted. |

## Flow — how an entry reaches a prompt

1. Read the entry/entries (this schema's table, or a per-work entries file).
2. Select the matching entry and one `validationTactic` for the work at hand.
3. Provide it to the prompt-generator as a placeholder source:
   - `{ type: 'file' }` for static, file-backed entries, or
   - `{ type: 'function' }` for dynamically assembled entries (the function
     holds the strict contract `{ status: true, text }`; a wrong shape, a
     non-true status or an empty text fires PGEN-031 / PGEN-032 / PGEN-033).
4. Compose: `prompt-generator --config=<config.mjs> --out=<dir>`.

The `buildUnits()` config form is the natural place to assemble Tools/Requirements
dynamically before composition (see `config.tool-requirement.mjs`).

## Docking point — calibration layer (own phase)

This template is the docking point for the later requirements/eval layer. Two
explicit notes:

- The `appliesTo` field is later extended with scope axes (repo / category /
  tag). The matching engine that resolves those axes is NOT part of this
  template — it is the calibration layer's own phase.
- The existing eval surfaces this layer will dock onto:
  - the 3-level eval hierarchy in `cli/memo-toolkit/docs/eval-pipeline.md`,
  - the skill-level `evals.json` files at `skills/{cat}/{skill}/evals/evals.json`.

No duplicate or diverging structure should be introduced for those axes — the
calibration layer extends this entry format, it does not replace it.
