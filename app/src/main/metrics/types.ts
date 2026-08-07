import type { PropertyKind } from '../../shared/types'

export interface NodeRecord {
  id: string
  value: unknown
}

export interface PairScore {
  idA: string
  idB: string
  score: number
}

export interface MetricModule {
  id: string
  displayName: string
  description: string
  applicableTo: PropertyKind[]
  defaultThreshold: number
  defaultParams: Record<string, unknown>
  // Scores one pair directly, bypassing candidate generation. Bucketing metrics
  // only emit pairs that share a token, so an absent score cannot be read as a
  // low score — surfacing needs a way to ask for the real number. Return null
  // when the values aren't of a type this metric can compare.
  scorePair?(a: unknown, b: unknown, params: Record<string, unknown>): number | null

  computePairScores(
    nodes: NodeRecord[],
    params: Record<string, unknown>,
    onProgress: (pct: number) => void,
    signal?: AbortSignal
  ): Promise<PairScore[]>
}
