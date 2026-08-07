import { createHash } from 'crypto'

const hash = (parts: string[]): string =>
  createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12)

/**
 * A pair's row id, scoped to its session.
 *
 * `pairs.id` is the primary key, so an id derived from the node ids alone is
 * shared by every session comparing those two nodes against the same database.
 * The upsert then hits ON CONFLICT and refreshes the snapshot without touching
 * session_id, so the row stays owned by whichever session inserted it first and
 * every later session's copy disappears — it computes the pair, writes nothing
 * that listPairs can find, and shows a short queue with no error.
 */
export function pairIdFor(sessionId: string, idA: string, idB: string): string {
  return hash([sessionId, ...[idA, idB].sort()])
}

/**
 * The unscoped id used before sessions owned their rows. Only for recognising
 * rows a session already has, so re-running it updates them in place instead of
 * inserting a second copy of every pair beside the ones holding its verdicts.
 *
 * Delete this, and its use in upsertPairs, once no session predating the scoped
 * ids is still in use.
 */
export function legacyPairId(idA: string, idB: string): string {
  return hash([idA, idB].sort())
}
