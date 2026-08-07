// Every metric parameter must be declared in the renderer and read by the
// metric. Four params had drifted apart before this existed: two under
// different names on each side (token-jaccard's tokenizer/tokenMode,
// semantic-cosine's embeddingModel/backend), one declared with no control
// (exact-match's normalization), one with a control the metric ignored
// (token-sort-ratio's tokenMode). None failed loudly — the engine ends every
// param read in a `?? default`, so a mismatch just silently uses the default.
//
// This is source analysis, not type checking: it greps for `params.x`, so
// destructuring would defeat it. It is a smoke alarm, not a guarantee.
import { readFileSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const metricsDir = join(root, 'src/main/metrics')
const uiFile = join(root, 'src/renderer/src/lib/metrics.ts')

const SKIP = new Set(['types.ts', 'registry.ts'])

// Renderer: metric id → declared paramSchema keys
function uiParamKeys() {
  const src = readFileSync(uiFile, 'utf8')
  const out = new Map()
  for (const block of src.split(/\n {2}\{\n/)) {
    const id = block.match(/id: '([\w-]+)'/)?.[1]
    if (!id) continue
    const schema = block.match(/paramSchema: \{(.*?)\n {4}\}/s)?.[1] ?? ''
    out.set(id, new Set([...schema.matchAll(/^ {6}(\w+):/gm)].map((m) => m[1])))
  }
  return out
}

// Metric source: keys actually read off the params object
function engineParamKeys(src) {
  return new Set([
    ...[...src.matchAll(/params\.(\w+)/g)].map((m) => m[1]),
    ...[...src.matchAll(/params\[['"](\w+)['"]\]/g)].map((m) => m[1])
  ])
}

const ui = uiParamKeys()
const problems = []

for (const file of readdirSync(metricsDir).sort()) {
  if (!file.endsWith('.ts') || SKIP.has(file)) continue
  const src = readFileSync(join(metricsDir, file), 'utf8')
  const id = src.match(/id: '([\w-]+)'/)?.[1]
  if (!id) continue

  if (!ui.has(id)) {
    problems.push(`${file}: metric '${id}' has no entry in lib/metrics.ts`)
    continue
  }
  const declared = ui.get(id)
  const read = engineParamKeys(src)

  for (const k of read) {
    if (!declared.has(k)) {
      problems.push(
        `${file}: reads params.${k}, but '${id}' declares no control for it — the value is unreachable from the UI`
      )
    }
  }
  for (const k of declared) {
    if (!read.has(k)) {
      problems.push(
        `${file}: '${id}' declares a '${k}' control, but the metric never reads params.${k} — the control does nothing`
      )
    }
  }
}

if (problems.length > 0) {
  console.error('Metric parameter check failed:\n')
  for (const p of problems) console.error(`  ${p}`)
  console.error(
    `\n${problems.length} problem(s). Every declared param must be read, and every param read must be declared.`
  )
  process.exit(1)
}

console.log(`Metric parameter check passed (${ui.size} metrics).`)
