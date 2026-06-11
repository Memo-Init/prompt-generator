/**
 * Example wiring for the prd-creation use case — run from the
 * prompt-generator repo root:
 *
 *   node src/cli.mjs \
 *       --config=examples/usecase-prd-creation/config.prd-creation.mjs \
 *       --out=.tmp/prompts-prd/
 *
 * It composes the PRD-generation prompt referenced by the core skill
 * `prd-generate`: a fixed template (file source) plus typed placeholder
 * sources. The MEMO_CHAPTER source is a function source so the chapter is
 * read live from disk and embedded with the strict { status: true, text }
 * contract — the natural docking point for "pull the chapter in, then
 * compose deterministically".
 *
 * Real batches derive their units from the actual memo phase plan — one
 * unit per PRD — and never hardcode quantities. The two units below are the
 * deliberate trial candidates of this example, not a catalog. The sample
 * memo chapter under assets/ keeps the example self-contained; a real run
 * points memoChapterPath at the actual memo chapter file.
 */

import { fileURLToPath } from 'node:url'

import { embedMemoChapter } from './prdPromptInputs.mjs'


// Template and the sample chapter ship next to this config — resolved
// module-relative so the example runs from any working directory.
const promptTemplatePath = fileURLToPath( new URL( './templates/prd-prompt.md', import.meta.url ) )
const memoChapterPath = fileURLToPath( new URL( './assets/memo-chapter-sample.md', import.meta.url ) )


const buildPrdUnit = ( { prdNumber, slug, phase, categoryTag } ) => {
    const unit = {
        'id': `prd-${prdNumber}-${slug}`,
        'payload': {
            'template': { 'type': 'file', 'filePath': promptTemplatePath },
            'placeholders': {
                'PRD_NUMBER': { 'type': 'string', 'value': prdNumber },
                'SLUG': { 'type': 'string', 'value': slug },
                'PHASE': { 'type': 'string', 'value': phase },
                'CATEGORY_TAG': { 'type': 'string', 'value': categoryTag },
                'MEMO_CHAPTER': { 'type': 'function', 'fn': embedMemoChapter, 'args': { memoChapterPath } }
            }
        }
    }

    return unit
}


export const units = [
    buildPrdUnit( { 'prdNumber': '008', 'slug': 'prompt-generator-prd-integration', 'phase': '3', 'categoryTag': '[CORE]' } ),
    buildPrdUnit( { 'prdNumber': '009', 'slug': 'tool-requirement-template', 'phase': '3', 'categoryTag': '[CORE]' } )
]
