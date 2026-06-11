# prd-creation example — notes

Composes the PRD-generation prompt referenced by the core skill `prd-generate`
(PRD-008). One unit per PRD; the source memo chapter is read live via a
`function` source and embedded with the strict `{ status: true, text }` contract.

## What this example demonstrates

- A fixed PRD prompt template (`templates/prd-prompt.md`) with named `{{…}}`
  tokens for the variable PRD parts (`PRD_NUMBER`, `SLUG`, `PHASE`,
  `CATEGORY_TAG`, `MEMO_CHAPTER`).
- The mandatory closing section (Friction Test → `/git-security` → `/git-commit`)
  shipped verbatim in the template, so every composed PRD prompt carries it.
- The self-containment guarantee restated inside the template — the
  prompt-generator replaces free prompting, not the self-containment rule.

## Run

From the repo root:

    node src/cli.mjs \
        --config=examples/usecase-prd-creation/config.prd-creation.mjs \
        --out=.tmp/prompts-prd/

Measured on 2026-06-11: 2 units composed (`prd-008-…` 2,750 chars,
`prd-009-…` 2,743 chars), no torso tokens, no coverage errors, `manifest.json`
records the template + placeholder sha256s for reproducibility.

## Placement decision

This example follows the established `examples/usecase-*` convention (config +
`*Inputs.mjs` consumer + `templates/` + NOTES.md), the same shape as
`examples/usecase-about/`. PRD-008 loosely suggested `examples/prd-prompt/`; the
real repo convention was chosen instead so all examples stay consistent.

## Fixture note

`assets/memo-chapter-sample.md` is a self-contained SAMPLE so the example runs
without a live memo workspace. A real run points `memoChapterPath` (in
`config.prd-creation.mjs`) at the actual memo chapter file.
