import { randomUUID } from 'crypto'
import { getDb } from './db'
import type { Session, CandidatePair, MetricScore, Verdict } from '../shared/types'

// ── Sessions ──────────────────────────────────────────────────────────────────

function rowToSession(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    connectionId: row.connection_id as string,
    label: row.label as string,
    ...(JSON.parse(row.config_json as string) as Pick<Session, 'fields' | 'surfacingRule'>),
    status: row.status as Session['status'],
    reviewCursor: row.review_cursor as number,
    reviewFilter: JSON.parse(row.review_filter as string),
    reviewSort: row.review_sort as Session['reviewSort'],
    mergePasses: JSON.parse(row.merge_passes as string),
    createdAt: new Date(row.created_at as number).toISOString(),
    updatedAt: new Date(row.updated_at as number).toISOString(),
  }
}

export function listSessions(): Session[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as Record<string, unknown>[]
  return rows.map(rowToSession)
}

export function createSession(partial: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>): Session {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()
  const { fields, surfacingRule, ...rest } = partial
  db.prepare(`
    INSERT INTO sessions(id, connection_id, label, config_json, status, review_cursor, review_filter, review_sort, merge_passes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, rest.connectionId, rest.label,
    JSON.stringify({ fields, surfacingRule }),
    rest.status,
    rest.reviewCursor,
    JSON.stringify(rest.reviewFilter),
    rest.reviewSort,
    JSON.stringify(rest.mergePasses),
    now, now
  )
  return loadSession(id)!
}

export function loadSession(id: string): Session | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToSession(row) : null
}

export function saveSession(session: Session): void {
  const db = getDb()
  const { fields, surfacingRule } = session
  db.prepare(`
    UPDATE sessions SET
      config_json   = ?,
      status        = ?,
      review_cursor = ?,
      review_filter = ?,
      review_sort   = ?,
      merge_passes  = ?,
      updated_at    = ?
    WHERE id = ?
  `).run(
    JSON.stringify({ fields, surfacingRule }),
    session.status,
    session.reviewCursor,
    JSON.stringify(session.reviewFilter),
    session.reviewSort,
    JSON.stringify(session.mergePasses),
    Date.now(),
    session.id
  )
}

export function deleteSession(id: string): void {
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

// ── Pairs ─────────────────────────────────────────────────────────────────────

function rowToPair(row: Record<string, unknown>, scores: MetricScore[]): CandidatePair {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    label: JSON.parse((row.node_a_json as string))?.label ?? '',
    nodeA: JSON.parse(row.node_a_json as string),
    nodeB: JSON.parse(row.node_b_json as string),
    scores,
    verdict: row.verdict as Verdict,
    decidedAt: row.decided_at ? new Date(row.decided_at as number).toISOString() : undefined,
    note: (row.note as string | null) ?? undefined,
  }
}

export function listPairs(sessionId: string): CandidatePair[] {
  const db = getDb()
  const pairs = db.prepare('SELECT * FROM pairs WHERE session_id = ?').all(sessionId) as Record<string, unknown>[]
  const scoreRows = db
    .prepare('SELECT ps.* FROM pair_scores ps JOIN pairs p ON p.id = ps.pair_id WHERE p.session_id = ?')
    .all(sessionId) as Record<string, unknown>[]

  const scoresByPair = new Map<string, MetricScore[]>()
  for (const sr of scoreRows) {
    const pid = sr.pair_id as string
    if (!scoresByPair.has(pid)) scoresByPair.set(pid, [])
    scoresByPair.get(pid)!.push({
      metricId: sr.metric_id as string,
      fieldName: sr.field_name as string,
      score: sr.score as number,
      aboveThreshold: (sr.above_threshold as number) === 1,
    })
  }

  return pairs.map((row) => rowToPair(row, scoresByPair.get(row.id as string) ?? []))
}

export function getPair(pairId: string): CandidatePair | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM pairs WHERE id = ?').get(pairId) as Record<string, unknown> | undefined
  if (!row) return null
  const scores = db.prepare('SELECT * FROM pair_scores WHERE pair_id = ?').all(pairId) as Record<string, unknown>[]
  return rowToPair(row, scores.map((sr) => ({
    metricId: sr.metric_id as string,
    fieldName: sr.field_name as string,
    score: sr.score as number,
    aboveThreshold: (sr.above_threshold as number) === 1,
  })))
}

export function upsertPairs(pairs: CandidatePair[]): void {
  const db = getDb()
  const insertPair = db.prepare(`
    INSERT INTO pairs(id, session_id, node_a_json, node_b_json, verdict, decided_at, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      node_a_json = excluded.node_a_json,
      node_b_json = excluded.node_b_json
      -- verdict, decided_at, note intentionally NOT overwritten
  `)
  const upsertScore = db.prepare(`
    INSERT OR REPLACE INTO pair_scores(pair_id, metric_id, field_name, score, above_threshold)
    VALUES (?, ?, ?, ?, ?)
  `)
  const tx = db.transaction(() => {
    for (const pair of pairs) {
      insertPair.run(
        pair.id, pair.sessionId,
        JSON.stringify(pair.nodeA), JSON.stringify(pair.nodeB),
        pair.verdict,
        pair.decidedAt ? new Date(pair.decidedAt).getTime() : null,
        pair.note ?? null
      )
      for (const score of pair.scores) {
        upsertScore.run(pair.id, score.metricId, score.fieldName, score.score, score.aboveThreshold ? 1 : 0)
      }
    }
  })
  tx()
}

export function setVerdict(pairId: string, verdict: Verdict): void {
  getDb().prepare('UPDATE pairs SET verdict = ?, decided_at = ? WHERE id = ?')
    .run(verdict, verdict !== 'pending' ? Date.now() : null, pairId)
}

export function setNote(pairId: string, note: string): void {
  getDb().prepare('UPDATE pairs SET note = ? WHERE id = ?').run(note, pairId)
}
