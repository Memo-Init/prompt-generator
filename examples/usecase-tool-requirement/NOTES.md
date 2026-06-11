# tool-requirement example — notes

Shows how a deposited Tool/Requirement entry reaches a work prompt as a typed
placeholder (PRD-009). The entry schema is documented in
`tool-requirement.schema.md`; this example renders a selected entry via a
`function` source, exercising the strict `{ status: true, text }` contract.

## What this example demonstrates

- A declarative entry format (`tool`, `appliesTo`, `validationTactic`,
  `requirement`) covering the 5 named tools (Pencil, Playwright, get-sheet,
  getui, FlowMCP) — see `tool-requirement.schema.md` and `entries/tool-entries.mjs`.
- The `buildUnits()` config form (PRD-009): the natural place to assemble
  Tools/Requirements dynamically before composition.
- A `function` placeholder (`renderToolRequirement`) that selects one entry and
  renders it; an unknown tool fires PGEN-030 (verified) rather than emitting a
  torso — the contract is real, not bypassed.
- The "Docking point" section marks where the calibration layer (own phase)
  extends `appliesTo` with repo/category/tag scope axes, referencing
  `cli/memo-toolkit/docs/eval-pipeline.md` and the skill-level `evals.json`.

## Run

From the repo root:

    node src/cli.mjs \
        --config=examples/usecase-tool-requirement/config.tool-requirement.mjs \
        --out=.tmp/prompts-tool-requirement/

Measured on 2026-06-11: 2 units composed (`work-design-pass` selecting Pencil,
`work-data-pull` selecting FlowMCP), no torso tokens, the rendered
Tool/Requirement block appears verbatim in each prompt.

Negative path (verified): selecting an undeposited tool produces
`PGEN-030 TOOL_REQUIREMENT: function 'renderToolRequirement' threw …` — the
strict function contract is enforced.

## Placement decision

Follows the established `examples/usecase-*` convention, same shape as
`examples/usecase-about/`. PRD-009 loosely suggested
`examples/tool-requirement/`; the real repo convention was chosen for
consistency across examples.
