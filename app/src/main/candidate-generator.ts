export interface StringNode {
  id: string
  value: string
}

export function tokenize(s: string, mode: string): string[] {
  let out = s
  if (mode === 'whitespace-lowercase' || mode === 'alphanumeric') out = out.toLowerCase()
  if (mode === 'alphanumeric') out = out.replace(/[^a-z0-9\s]/g, ' ')
  return out.split(/\s+/).filter(Boolean)
}

/**
 * Returns all candidate (idA, idB) pairs that share at least one token.
 * Provides an upper bound on pairs that any string metric might score above threshold.
 * Pairs are returned as sorted tuples to avoid duplicates.
 */
export function tokenBucketPairs(nodes: StringNode[], maxBucketSize = 500): [string, string][] {
  const buckets = new Map<string, string[]>()
  for (const { id, value } of nodes) {
    for (const tok of tokenize(value, 'whitespace-lowercase')) {
      if (!buckets.has(tok)) buckets.set(tok, [])
      buckets.get(tok)!.push(id)
    }
  }

  const seen = new Set<string>()
  const pairs: [string, string][] = []

  for (const ids of buckets.values()) {
    if (ids.length < 2 || ids.length > maxBucketSize) continue
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`
        if (!seen.has(key)) {
          seen.add(key)
          pairs.push(ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]])
        }
      }
    }
  }
  return pairs
}

/**
 * Estimates the number of candidate pairs without scoring.
 * Used by the Recalculate button — this is an upper bound.
 */
export function estimatePairCount(nodes: StringNode[], maxBucketSize = 500): number {
  return tokenBucketPairs(nodes, maxBucketSize).length
}
