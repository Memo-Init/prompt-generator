# About synthesis — namespace `{{NAMESPACE}}`

You are a sub-agent starting with an EMPTY context. Your working directory is the
FlowMCP project root (`projects/flowmcp/`); every path in this prompt is relative
to that directory.

Your mission: write the About page for the namespace `{{NAMESPACE}}` and save it as
a plain English Markdown file at exactly this path:

    {{OUTPUT_PATH}}

## How to work (read first)

- Follow the step plan below STRICTLY and in the given order — do not skip,
  merge or reorder steps.
- The step plan forces you to read the real test files of every tool. Each test
  file is JSON; its field `response` holds the real API return. Read the files —
  never guess from tool or schema names.
- Summarize per tool FIRST (what comes back, what you can do with it). Derive the
  big picture ONLY AFTER all tool overviews exist — the About must convey an
  understanding that the schema text alone does not.
- Do NOT write concrete result values into the About (no "input A,B,C returns XY").
  Describe the kind of data, its meaning and the possibilities in general terms.
  The DO / DO NOT rules inside the embedded template are binding.

## Step plan

{{STEP_PLAN}}

## About template

The About template is embedded below between the BEGIN/END markers. Its fill-in
slots are written as `[[...]]`. Produce the final About by:

1. filling EVERY `[[...]]` slot with your own English wording,
2. removing ALL `<!-- ... -->` comment blocks (they are authoring hints only),
3. keeping the section structure of the template.

The final file at `{{OUTPUT_PATH}}` must be pure English Markdown — no `[[...]]`
slots, no comments, no mixed language.

---BEGIN ABOUT TEMPLATE---
{{ABOUT_TEMPLATE}}
---END ABOUT TEMPLATE---
