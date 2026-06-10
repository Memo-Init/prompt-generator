# Trial run notes — step plan per namespace

Measured values from the two trial units of `config.about.mjs`, run from the
FlowMCP project root on 2026-06-10. All numbers below were derived live from the
filesystem and the run manifests — they describe exactly these two measured
units, nothing beyond them.

## Measurements per unit

| Unit | Prompt length (manifest) | Schemas | Tools | Test files referenced | Test payload on disk (sum / max single file) |
|------|--------------------------|---------|-------|-----------------------|----------------------------------------------|
| `about-brightsky` | 7,623 chars | 1 | 4 | 12 | ~680 KB / ~488 KB |
| `about-berlinwfs` | 11,145 chars | 2 | 11 | 33 | ~2.3 MB / ~378 KB |

- Prompt hashes were identical across two independent runs (deterministic
  composition confirmed: `6de7636c4965…` / `13deaa9853e4…`).
- Both prompts reference 100 % of the on-disk `test-N.json` files of their
  namespace, bidirectionally verified (no missing references, no invented paths).
- No `{{…}}` torso sequences in either prompt; the About template is embedded in
  full as the `[[…]]` slot variant.

## Granularity observation

The prompt itself stays small even for the multi-schema namespace: the step plan
grows roughly linearly with the tool count (~5 lines per tool), so the prompt
size is dominated by the fixed frame plus the embedded About template (~5 KB),
not by the namespace size. The real workload variable is what the sub-agent must
READ, not what the prompt contains: 12 files / ~680 KB for the single-schema
candidate versus 33 files / ~2.3 MB for the two-schema candidate.

For these two candidates the namespace level remained workable: both step plans
fit comfortably in one prompt and the read volume stays within what one agent
context can process sequentially (per-tool summaries compress as the agent goes).

For outliers a split suggests itself along the chain that the step plan already
encodes: namespaces with many schemas or a read volume far beyond the ~2-3 MB
measured here would move to the SCHEMA level (one sub-agent per schema producing
the schema description, plus one merge agent for the namespace About). A TOOL
level cut looks unnecessary as long as tools stay within the observed bound of a
few hundred KB per test file; it would only become relevant for single tools
whose tests alone exceed an agent's reading budget.
