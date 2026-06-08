import type { MetricModule, PairScore } from './types'
import { tokenBucketPairs } from '../candidate-generator'

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const temp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = temp
    }
  }
  return dp[n]
}

export const editDistance: MetricModule = {
  id: 'edit-distance',
  displayName: 'Edit Distance (Levenshtein ratio)',
  description: '1 − edit_distance / max(len(a), len(b)). Good for short identifiers.',
  applicableTo: ['identifier', 'name'],
  defaultThreshold: 0.85,
  defaultParams: {},

  async computePairScores(nodes, _params, onProgress, signal) {
    const strings = nodes
      .map((n) => ({ id: n.id, val: typeof n.value === 'string' ? n.value : null }))
      .filter((n): n is { id: string; val: string } => n.val !== null)

    const candidates = tokenBucketPairs(strings.map((s) => ({ id: s.id, value: s.val })))
    const results: PairScore[] = []
    let done = 0
    for (const [idA, idB] of candidates) {
      if (signal?.aborted) break
      const a = strings.find((s) => s.id === idA)!.val
      const b = strings.find((s) => s.id === idB)!.val
      const dist = levenshtein(a, b)
      const score = 1 - dist / Math.max(a.length, b.length, 1)
      results.push({ idA, idB, score })
      onProgress(++done / candidates.length)
    }
    return results
  },
}
