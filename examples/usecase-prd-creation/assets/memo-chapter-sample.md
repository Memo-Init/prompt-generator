# Chapter 5 — Prompt-Generator: Verdrahtung & Skill-Integration (sample)

This is a self-contained SAMPLE memo chapter used only to exercise the
prd-creation example end-to-end without depending on a live memo workspace.
A real run replaces this file path with the actual memo chapter.

## What the chapter asks for

Wire the (globally executable) `prompt-generator` into PRD creation so that the
PRD-generation prompt is composed from a fixed template plus typed placeholder
sources instead of being phrased freely each time. The integration lives in the
`prd-generate` and `memo-phase-generate` skills and is additionally stated as a
standing rule in the matching `AGENTS.md`.

## Constraints

- The library (`PromptGenerator.mjs`, `PromptGeneratorCli.mjs`) stays stable.
- The self-containment guarantee for each PRD must be preserved.
- The composed PRD prompt must carry the mandatory closing section verbatim.
