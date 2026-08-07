import type { MetricModule, NodeRecord, PairScore } from './types'

// Cached pipeline — loading the ONNX model is expensive; reuse across calls.
let bgeExtractor: Awaited<ReturnType<typeof import('@huggingface/transformers').pipeline>> | null = null

async function getBGE() {
  if (!bgeExtractor) {
    const { pipeline } = await import('@huggingface/transformers')
    bgeExtractor = await pipeline('feature-extraction', 'Xenova/bge-base-en-v1.5')
  }
  return bgeExtractor
}

const BGE_BATCH_SIZE = 16
const MAX_CHARS = 2000 // rough guard against exceeding BGE's 512-token limit

async function encodeBGE(strings: string[], onProgress?: (pct: number) => void): Promise<number[][]> {
  const extractor = await getBGE()
  const results: number[][] = []
  const truncated = strings.map((s) => s.slice(0, MAX_CHARS))

  for (let i = 0; i < truncated.length; i += BGE_BATCH_SIZE) {
    const batch = truncated.slice(i, i + BGE_BATCH_SIZE)
    const output = await extractor(batch, { pooling: 'mean', normalize: true }) as { data: Float32Array; dims: number[] }
    const dim = output.dims[1]
    for (let j = 0; j < batch.length; j++) {
      results.push(Array.from(output.data.slice(j * dim, (j + 1) * dim)))
    }
    onProgress?.((i + batch.length) / truncated.length)
  }
  return results
}

function dot(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

function allPairScores(ids: string[], vecs: number[][]): PairScore[] {
  const out: PairScore[] = []
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      out.push({ idA: ids[i], idB: ids[j], score: Math.max(0, Math.min(1, dot(vecs[i], vecs[j]))) })
  return out
}

export const semanticCosine: MetricModule = {
  id: 'semantic-cosine',
  displayName: 'Semantic Cosine',
  description: 'Dense embedding cosine similarity. Captures semantic equivalence.',
  applicableTo: ['name', 'text'],
  defaultThreshold: 0.88,
  defaultParams: { backend: 'bge', embeddingProperty: '' },

  async computePairScores(nodes, params, onProgress, signal) {
    // `backend` is the key the Configure screen writes. Earlier sessions may
    // carry `embeddingModel` from a time when the two disagreed and nothing
    // read the UI's value; accept either so those configs keep working.
    const backend = (params.backend as string) ?? (params.embeddingModel as string) ?? 'bge'
    const valid = nodes.filter((n) => typeof n.value === 'string' && n.value.trim()) as (NodeRecord & { value: string })[]
    if (valid.length === 0) return []

    let vecs: number[][]
    if (backend === 'neo4j-property' || backend === 'neo4j-stored') {
      const propName = (params.embeddingProperty as string) || 'embedding'
      vecs = valid.map((n) => {
        const props = n as unknown as { properties?: Record<string, unknown> }
        const emb = props.properties?.[propName]
        return Array.isArray(emb) ? (emb as number[]) : []
      })
    } else {
      // Includes a legacy `openai` value. That backend was never reachable —
      // the engine read a key the UI never wrote — so those sessions were
      // already embedding with BGE. Falling back keeps their scores identical.
      vecs = await encodeBGE(valid.map((n) => n.value), (pct) => onProgress(pct * 0.9))
    }

    if (signal?.aborted) return []
    const results = allPairScores(valid.map((n) => n.id), vecs)
    onProgress(1)
    return results
  },
}
