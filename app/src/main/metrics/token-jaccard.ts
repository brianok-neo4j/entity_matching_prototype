import type { MetricModule, PairScore } from './types'
import { tokenize, tokenBucketPairs } from '../candidate-generator'

export const tokenJaccard: MetricModule = {
  id: 'token-jaccard',
  displayName: 'Token Jaccard',
  description: '|intersection| / |union| of token sets. Order-insensitive.',
  applicableTo: ['name', 'text'],
  defaultThreshold: 0.70,
  defaultParams: { tokenizer: 'whitespace-lowercase' },

  async computePairScores(nodes, params, onProgress, signal) {
    const mode = (params.tokenizer as string) ?? 'whitespace-lowercase'
    const tokenized = nodes
      .map((n) => ({
        id: n.id,
        tokens: typeof n.value === 'string' ? new Set(tokenize(n.value, mode)) : null,
      }))
      .filter((n): n is { id: string; tokens: Set<string> } => n.tokens !== null && n.tokens.size > 0)

    const candidates = tokenBucketPairs(
      tokenized.map((t) => ({ id: t.id, value: Array.from(t.tokens).join(' ') }))
    )
    const byId = new Map(tokenized.map((t) => [t.id, t.tokens]))
    const results: PairScore[] = []
    let done = 0

    for (const [idA, idB] of candidates) {
      if (signal?.aborted) break
      const a = byId.get(idA)!
      const b = byId.get(idB)!
      let inter = 0
      for (const tok of a) if (b.has(tok)) inter++
      const union = a.size + b.size - inter
      results.push({ idA, idB, score: union === 0 ? 0 : inter / union })
      onProgress(++done / candidates.length)
    }
    return results
  },
}
