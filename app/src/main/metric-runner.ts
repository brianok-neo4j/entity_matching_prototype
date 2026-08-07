import { createHash } from 'crypto'
import { getDriver } from './connection-service'
import { getMetric } from './metrics/registry'
import { upsertPairs } from './session-service'
import { estimatePairCount } from './candidate-generator'
import { sanitize } from './neo4j-int'
import type { Session, CandidatePair, MetricScore, ScoreDistributions, ScorePercentiles } from '../shared/types'
import type { NodeRecord } from './metrics/types'

export type ProgressEvent = {
  metricId: string
  fieldName: string
  pct: number
  pairsAbove: number
}

export async function runMetrics(
  session: Session,
  onProgress: (evt: ProgressEvent) => void,
  signal: AbortSignal
): Promise<ScoreDistributions> {
  const driver = getDriver()
  const neo4jSession = driver.session()

  // Map pairId → accumulated scores
  const pairScores = new Map<string, { idA: string; idB: string; scores: MetricScore[] }>()
  // Node snapshots captured during field fetches — no second round-trip needed
  const snapshotMap = new Map<string, { id: string; properties: Record<string, unknown> }>()

  // Per field, the nodes that actually carry the property. Lets surfacing tell
  // "the property is absent" apart from "both have it but they scored poorly" —
  // metrics emit scores sparsely, so a missing score alone means neither.
  const fieldNodeIds = new Map<string, Set<string>>()

  try {
    for (const fieldConfig of session.fields) {
      for (const metricConfig of fieldConfig.metrics) {
        // Signal that this metric has started so the UI shows it at 0% immediately
        onProgress({ metricId: metricConfig.metricId, fieldName: fieldConfig.propertyName, pct: 0, pairsAbove: 0 })
      }

      // Include properties(n) here — we're already paying for the round-trip, and this lets
      // us skip the separate snapshot-fetch query entirely after surfacing.
      console.log(`[compute] Fetching nodes for ${session.label}.${fieldConfig.propertyName}…`)
      const result = await neo4jSession.run(
        `MATCH (n:\`${session.label}\`) WHERE n.\`${fieldConfig.propertyName}\` IS NOT NULL ` +
        `RETURN elementId(n) AS id, n.\`${fieldConfig.propertyName}\` AS val, properties(n) AS props`
      )
      const nodes: NodeRecord[] = result.records.map((r) => {
        const id = r.get('id') as string
        // First time we see this node, capture its full property snapshot.
        // Sanitize each value so neo4j.Integer / BigInt becomes a plain JS number.
        if (!snapshotMap.has(id)) {
          const raw = (r.get('props') ?? {}) as Record<string, unknown>
          const properties: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(raw)) properties[k] = sanitize(v)
          snapshotMap.set(id, { id, properties })
        }
        return { id, value: r.get('val') }
      })
      console.log(`[compute] ${nodes.length} nodes fetched for ${fieldConfig.propertyName}`)
      // The query above already filters to nodes that have the property, so this
      // is the exact set for which the field can be compared at all.
      fieldNodeIds.set(fieldConfig.propertyName, new Set(nodes.map((n) => n.id)))

      for (const metricConfig of fieldConfig.metrics) {
        if (signal.aborted) break
        const metric = getMetric(metricConfig.metricId)
        console.log(`[compute] Running ${metricConfig.metricId} on ${fieldConfig.propertyName}…`)

        const rawScores = await metric.computePairScores(
          nodes,
          metricConfig.params,
          (pct) => onProgress({ metricId: metricConfig.metricId, fieldName: fieldConfig.propertyName, pct, pairsAbove: 0 }),
          signal
        )
        console.log(`[compute] ${metricConfig.metricId} done — ${rawScores.length} pair scores`)

        for (const { idA, idB, score } of rawScores) {
          if (idA === idB) continue
          const pairId = stablePairId(idA, idB)
          if (!pairScores.has(pairId)) pairScores.set(pairId, { idA, idB, scores: [] })
          pairScores.get(pairId)!.scores.push({
            metricId: metricConfig.metricId,
            fieldName: fieldConfig.propertyName,
            score,
            aboveThreshold: score >= metricConfig.threshold,
          })
        }
      }
    }

    // Fill in the scores candidate generation never produced.
    //
    // Every bucketing metric only emits pairs whose values share a token, so a
    // pair can be a candidate on one field and have no score at all on another
    // the two nodes both carry. Surfacing cannot tell that apart from a genuine
    // low score, which made All mode reject pairs on comparisons that were
    // never attempted. Ask the metric for the real number instead.
    let densified = 0
    const tDense = Date.now()
    for (const { idA, idB, scores } of pairScores.values()) {
      const propsA = snapshotMap.get(idA)?.properties
      const propsB = snapshotMap.get(idB)?.properties
      if (!propsA || !propsB) continue
      const have = new Set(scores.map((s) => `${s.fieldName}|${s.metricId}`))

      for (const fieldConfig of session.fields) {
        // properties() omits nulls, so absence here means the node genuinely
        // lacks the property and there is nothing to compare.
        const a = propsA[fieldConfig.propertyName]
        const b = propsB[fieldConfig.propertyName]
        if (a === undefined || b === undefined) continue

        for (const metricConfig of fieldConfig.metrics) {
          if (have.has(`${fieldConfig.propertyName}|${metricConfig.metricId}`)) continue
          const metric = getMetric(metricConfig.metricId)
          if (!metric.scorePair) continue
          const score = metric.scorePair(a, b, metricConfig.params)
          if (score === null) continue
          scores.push({
            metricId: metricConfig.metricId,
            fieldName: fieldConfig.propertyName,
            score,
            aboveThreshold: score >= metricConfig.threshold,
          })
          densified++
        }
      }
    }
    console.log(`[compute] densify: ${densified} scores filled in ${Date.now() - tDense}ms`)

    // Surface pairs using snapshots already in memory — no extra query
    type SurfacedEntry = { pairId: string; idA: string; idB: string; scores: MetricScore[] }
    const surfacedEntries: SurfacedEntry[] = []
    for (const [pairId, { idA, idB, scores }] of pairScores) {
      if (surfaced(scores, session, idA, idB, fieldNodeIds))
        surfacedEntries.push({ pairId, idA, idB, scores })
    }
    console.log(`[compute] ${surfacedEntries.length} pairs surfaced`)

    const surfacedPairs: CandidatePair[] = surfacedEntries.map(({ pairId, idA, idB, scores }) => ({
      id: pairId,
      sessionId: session.id,
      label: session.label,
      nodeA: snapshotMap.get(idA) ?? { id: idA, properties: {} },
      nodeB: snapshotMap.get(idB) ?? { id: idB, properties: {} },
      scores,
      verdict: 'pending',
    }))

    let t = Date.now()
    upsertPairs(surfacedPairs)
    console.log(`[compute] upsertPairs: ${Date.now() - t}ms`)

    t = Date.now()
    const dists = computeDistributions(pairScores)
    console.log(`[compute] computeDistributions: ${Date.now() - t}ms`)

    return dists
  } finally {
    // Fire-and-forget — session.close() involves a network round-trip to Aura;
    // awaiting it would stall the caller after all real work is done.
    neo4jSession.close().catch(() => {})
  }
}

function stablePairId(idA: string, idB: string): string {
  const sorted = [idA, idB].sort()
  return createHash('sha1').update(sorted.join('|')).digest('hex').slice(0, 12)
}

function surfaced(
  scores: MetricScore[],
  session: Session,
  idA: string,
  idB: string,
  fieldNodeIds: Map<string, Set<string>>
): boolean {
  const { mode, fields } = session.surfacingRule

  // Field score = max across metrics for that field
  const fieldScores = new Map<string, number>()
  for (const score of scores) {
    const current = fieldScores.get(score.fieldName) ?? 0
    fieldScores.set(score.fieldName, Math.max(current, score.score))
  }

  // A field can only be judged when both nodes carry the property. Absent is
  // not the same as scoring zero: a pair should not fail a comparison that was
  // never possible.
  const comparable = (propertyName: string): boolean => {
    const ids = fieldNodeIds.get(propertyName)
    return ids !== undefined && ids.has(idA) && ids.has(idB)
  }

  if (mode === 'any') {
    for (const fc of fields) {
      const fs = fieldScores.get(fc.propertyName) ?? 0
      if (fs >= fc.threshold) return true
    }
    return false
  }

  if (mode === 'all') {
    // Every field the pair can actually be compared on must meet its threshold.
    // Fields one or both nodes lack are skipped rather than counted as a
    // failure — otherwise sparse data excludes pairs that match on everything
    // they share. A field both nodes have but that produced no score is still a
    // failure: that is a real comparison the pair lost.
    let compared = 0
    for (const fc of fields) {
      if (!comparable(fc.propertyName)) continue
      compared++
      if ((fieldScores.get(fc.propertyName) ?? 0) < fc.threshold) return false
    }
    return compared > 0
  }

  // weighted-average
  const combined = fields.reduce((sum, fc) => {
    return sum + fc.weight * (fieldScores.get(fc.propertyName) ?? 0)
  }, 0)
  return combined >= (session.surfacingRule.combinedThreshold ?? 0.85)
}


function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil(p * sorted.length) - 1
  return sorted[Math.max(0, idx)] ?? 0
}

function computeDistributions(
  pairScores: Map<string, { idA: string; idB: string; scores: MetricScore[] }>
): ScoreDistributions {
  // Collect scores per (metricId, fieldName) for all pairs and pending-only
  const allScores = new Map<string, number[]>()
  const pendingScores = new Map<string, number[]>()

  for (const { scores } of pairScores.values()) {
    for (const s of scores) {
      const key = `${s.metricId}|${s.fieldName}`
      if (!allScores.has(key)) allScores.set(key, [])
      allScores.get(key)!.push(s.score)
      // All pairs start as pending after recompute
      if (!pendingScores.has(key)) pendingScores.set(key, [])
      pendingScores.get(key)!.push(s.score)
    }
  }

  const toPercentiles = (map: Map<string, number[]>): ScorePercentiles[] =>
    Array.from(map.entries()).map(([key, vals]) => {
      const [metricId, fieldName] = key.split('|')
      const sorted = [...vals].sort((a, b) => a - b)
      return {
        metricId,
        fieldName,
        p50: percentile(sorted, 0.5),
        p75: percentile(sorted, 0.75),
        p90: percentile(sorted, 0.9),
        p95: percentile(sorted, 0.95),
        max: sorted[sorted.length - 1] ?? 0,
      }
    })

  return { all: toPercentiles(allScores), pending: toPercentiles(pendingScores) }
}

export function estimatePairs(_session: Session, nodes: { id: string; value: string }[]): number {
  return estimatePairCount(nodes)
}
