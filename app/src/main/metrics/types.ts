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
  computePairScores(
    nodes: NodeRecord[],
    params: Record<string, unknown>,
    onProgress: (pct: number) => void,
    signal?: AbortSignal
  ): Promise<PairScore[]>
}
