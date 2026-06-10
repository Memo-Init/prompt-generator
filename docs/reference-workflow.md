# Reference Workflow — Batch Prompt Generation

This document describes the recommended operating model for using
`memo-init-prompt-generator` in homogeneous mass batches: many sub-agents, one
identical mission shape, only the unit-specific values differ.

> **Orchestration is a consumer, not part of this repository.**
> The library never starts agents and never makes LLM calls. Batching,
> `agent()` calls and completeness checks live in the consumer's workflow
> layer (e.g. workflow scripts, agent runners, CI jobs). This repository
> contributes exactly one thing to a batch: deterministic, validated prompt
> strings and prompt files. Everything below the line "start a sub-agent"
> is consumer responsibility — the example script at the end of this
> document is illustrative material only, not library code and not a
> package export.

## The Operating Model

A batch run follows this fixed sequence:

```
worklist  →  batch of N units  →  per unit: generator → prompt file
          →  per unit: sub-agent with empty context
          →  batch complete → next batch
          →  completeness check → straggler run
```

### Step 1 — Obtain the worklist

The list of units (the things to process — names, identifiers, paths) comes
from a **worklist or scan file supplied by the consumer**. Unit lists are
**never hardcoded**: a hardcoded list silently drifts away from reality,
and in a run over hundreds of units nobody notices the three entries that
were added since the list was written. Derive the worklist from the actual
data source (a scan, an index file, a directory listing) immediately before
the run.

### Step 2 — Form a batch

Split the worklist into batches — for example **8 units per batch**. The
batch size must respect the limits of the target runtime: a typical workflow
environment caps concurrency at **16** parallel agents and caps a single run
at **1,000 agents** in total. A batch size of 8 stays safely inside the
concurrency cap and keeps failure domains small: if something is wrong, it
is wrong for 8 units, not for the whole worklist.

### Step 3 — Per unit: call the generator, write a prompt file

For every unit in the batch, call the generator — either through the library
API (`PromptGenerator.generate()`) or through the CLI entry
(`node src/cli.mjs --config=<config.mjs> --out=<dir>`) — and persist the
result as a **prompt file**.

This is the step that makes the whole model work: prompt files are
**deterministic, versionable, diffable and inspectable before any sub-agent
starts**. Generate first, inspect, then dispatch. A defective prompt that is
only discovered after dispatch has already multiplied across the whole
batch; a defective prompt file caught in review costs nothing. The generator
guarantees that no prompt leaves it with findings — unresolved tokens, empty
sources or broken function contracts fail hard with a `PGEN-` error code
instead of producing a torso prompt.

### Step 4 — Per unit: start a sub-agent with an empty context

Each prompt file is handed to **one sub-agent started with an empty
context**. The prompt file is the complete mission: the sub-agent receives
no conversation history, no accumulated state and no sibling results. This
keeps every unit independent and reproducible — re-running a single unit
later produces the same starting point, because the starting point is a
file, not a conversation.

### Step 5 — Complete the batch, then check completeness

When all sub-agents of a batch have finished, start the next batch. After
the **last** batch, run a **completeness check**: compare the worklist
against the actually produced results — which units are missing or failed?
Collect the missing units and run them again as a **straggler run** (a
smaller batch built from the leftovers). Repeat until the worklist is fully
covered or the remaining failures are understood and documented.

## Path Hygiene for Configs and Manifests

The generator records every file source verbatim: `metadata.…filePath`
carries the `filePath` **exactly as supplied in the payload**, and the CLI
writes this metadata into `manifest.json`. Two practical rules follow:

- **Prefer paths relative to the invocation CWD** in config files. Relative
  paths keep prompt files and manifests portable across machines.
- If a config resolves paths module-relative (robust against CWD changes,
  but the resolved path is absolute), treat the resulting `manifest.json`
  as a **local artifact**: do not commit manifests that contain
  machine-specific absolute paths.

## Long-Term Direction

Generator output can also seed **standalone agent definitions**: agent
markdown files whose initial prompt is produced by the generator instead of
being hand-written. The workflow and agent layer around the generator is
replaceable plumbing — runners, schedulers and agent formats may change,
while the generator remains the core that guarantees a validated,
reproducible starting point.

## Example Workflow Script

The following sketch shows the full sequence in code. It is
**example only — orchestration is consumer responsibility**: this code is
not part of the library, is not exported by the package and the
`startSubAgent` function is a placeholder for whatever agent runner the
consumer uses.

```javascript
// example only — orchestration is consumer responsibility.
// Not a library module, not a package export. The generator composes and
// validates prompts; starting agents is entirely the consumer's concern.

import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { PromptGenerator } from '../src/index.mjs'


const BATCH_SIZE = 8
const CONCURRENCY_CAP = 16
const TOTAL_AGENT_CAP = 1000


// Step 1 — worklist from a scan file, NEVER hardcoded.
const loadWorklist = async ( { worklistPath } ) => {
    const text = await readFile( worklistPath, 'utf-8' )
    const { units } = JSON.parse( text )
    if( units.length > TOTAL_AGENT_CAP ) {
        throw new Error( `worklist has ${units.length} units — exceeds the ${TOTAL_AGENT_CAP}-agents cap per run, split into multiple runs` )
    }

    return { units }
}


// Step 2 — fixed-size batches inside the runtime caps.
const chunkIntoBatches = ( { units, batchSize } ) => {
    if( batchSize > CONCURRENCY_CAP ) {
        throw new Error( `batchSize ${batchSize} exceeds the concurrency cap of ${CONCURRENCY_CAP}` )
    }
    const batchCount = Math.ceil( units.length / batchSize )
    const batches = Array.from( { 'length': batchCount } )
        .map( ( _, batchIndex ) => {
            const start = batchIndex * batchSize
            const batch = units.slice( start, start + batchSize )

            return batch
        } )

    return { batches }
}


// Step 3 — one validated prompt file per unit; inspect/diff BEFORE dispatch.
const composePromptFile = async ( { unit, outDir } ) => {
    const { id, payload } = unit
    const { prompt, metadata } = await PromptGenerator.generate( payload )
    const promptFilePath = `${outDir}/${id}.md`
    await writeFile( promptFilePath, prompt, { 'encoding': 'utf-8', 'flag': 'wx' } )

    return { id, promptFilePath, 'hash': metadata.prompt.hash }
}


// Step 4 — placeholder: hand the finished prompt file to YOUR agent runner.
// The sub-agent starts with an EMPTY context; the prompt file is the
// complete mission.
const startSubAgent = async ( { promptFilePath } ) => {
    // e.g. await agent( { 'promptFile': promptFilePath } )
    throw new Error( `no agent runner wired up for '${promptFilePath}' — replace startSubAgent with your runner` )
}


// Steps 2-5 — batch loop with completeness check and straggler run.
const runBatches = async ( { units, outDir } ) => {
    const { batches } = chunkIntoBatches( { units, 'batchSize': BATCH_SIZE } )
    await mkdir( outDir, { 'recursive': true } )

    const finishedIds = await batches
        .reduce( async ( accumulatorPromise, batch ) => {
            const accumulator = await accumulatorPromise
            const composed = await Promise.all( batch
                .map( ( unit ) => {
                    const composition = composePromptFile( { unit, outDir } )
                    return composition
                } )
            )
            await Promise.all( composed
                .map( ( { promptFilePath } ) => {
                    const dispatch = startSubAgent( { promptFilePath } )
                    return dispatch
                } )
            )
            composed
                .forEach( ( { id } ) => { accumulator.push( id ) } )

            return accumulator
        }, Promise.resolve( [] ) )

    // Step 5 — completeness check: which units are missing? -> straggler run
    const stragglers = units
        .filter( ( unit ) => {
            const isFinished = finishedIds.includes( unit.id )
            return isFinished === false
        } )

    return { finishedIds, stragglers }
}


const { units } = await loadWorklist( { 'worklistPath': 'worklist.json' } )
const { stragglers } = await runBatches( { units, 'outDir': 'out/prompts' } )
// re-run stragglers as a smaller batch until the worklist is fully covered
```

For the generator API itself (payload shape, placeholder sources, error
codes), see the [README](../README.md).
