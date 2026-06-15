<!--
  EXAMPLE ONLY — not the canonical PRD-prompt template.
  The Single Source lives in core: repos/core/templates/prd-prompt.md
  (Memo 014, Kap 11). This file is a minimal illustration of the wiring; edit the
  canonical structure in the core asset, not here, to avoid drift.
-->
# Create PRD-{{PRD_NUMBER}} — {{SLUG}}

You are a sub-agent starting with an EMPTY context. Produce exactly one PRD
(Product Requirement Document) and nothing else. Everything you need is in this
prompt — do not assume access to prior conversation, other PRDs or the running
memo session.

Category tag: {{CATEGORY_TAG}}
Phase: {{PHASE}}

## Self-containment (binding)

This PRD must be self-contained: a different agent with an empty context must be
able to implement it from the PRD text alone. Do not reference "the previous
step", "as discussed" or any state that is not written down here. The
prompt-generator composed this prompt deterministically; the self-containment
rule is unchanged by that composition.

## Source memo chapter

The PRD must cover EXACTLY what the memo chapter below specifies — no more
(no invented scope), no less (no dropped requirement). Read it first.

---BEGIN MEMO CHAPTER---
{{MEMO_CHAPTER}}
---END MEMO CHAPTER---

## Structure to produce

Write the PRD with these sections, in this order:

1. A header table (Revision, Datum, Status, Memo-Referenz, Kategorie {{CATEGORY_TAG}}).
2. `## Ziel` — one paragraph, what this PRD achieves.
3. `## User Stories` — at least one story with explicit Acceptance Criteria checkboxes.
4. `## Scope` — `### In Scope` and `### Out of Scope`.
5. `## Changes by File` — concrete files touched, one bullet list per file.
6. `## Dependencies` — table of other PRDs this one requires or enables.
7. `## Validation` — how each acceptance criterion is verified (commands, checks).
8. The mandatory closing section, verbatim, exactly as written below.

## Mandatory closing section (verbatim — every PRD carries it)

## Abschluss

1. Friction Test ausfuehren
2. `/git-security` — Sicherheitspruefung (Code + Issue-Text)
3. `/git-commit` — Issue erstellen, Commit vorbereiten, User-Freigabe (kein Push)
