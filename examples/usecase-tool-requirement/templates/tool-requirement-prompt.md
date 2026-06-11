# Work prompt with deposited Tool/Requirement — {{WORK_TITLE}}

You are a sub-agent starting with an EMPTY context. Carry out the work described
below. A Tool and its mandatory Requirement have been selected and deposited for
this work; honour the Requirement and use the named validation tactic.

## Work

{{WORK_DESCRIPTION}}

## Deposited Tool / Requirement (selected for this work)

The block below was selected from the deposited entries and embedded
deterministically by the prompt-generator. Treat the Requirement as binding and
use the stated validation tactic to prove the work is done.

---BEGIN TOOL REQUIREMENT---
{{TOOL_REQUIREMENT}}
---END TOOL REQUIREMENT---

## Done means

The work counts as done only when the Requirement above holds and you have
applied the validation tactic — not merely when the code is written.
