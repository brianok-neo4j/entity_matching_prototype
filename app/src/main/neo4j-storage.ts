import { getDriver } from './connection-service'
import { getSettings } from './settings-service'
import type { CandidatePair, AuditRecord } from '../shared/types'

function isEnabled(): boolean {
  try {
    return getSettings().useNeo4jStorage
  } catch {
    return false
  }
}

export async function writePairVerdict(pair: CandidatePair): Promise<void> {
  if (!isEnabled()) return
  const driver = getDriver()
  const session = driver.session()
  try {
    await session.run(
      `MERGE (p:ERPair {pairId: $pairId})
       SET p.verdict = $verdict,
           p.decidedAt = $decidedAt,
           p.sessionId = $sessionId,
           p.note = $note
       WITH p
       MATCH (a) WHERE elementId(a) = $nodeAId
       MATCH (b) WHERE elementId(b) = $nodeBId
       MERGE (p)-[:INVOLVES {role: 'nodeA'}]->(a)
       MERGE (p)-[:INVOLVES {role: 'nodeB'}]->(b)`,
      {
        pairId: pair.id,
        verdict: pair.verdict,
        decidedAt: pair.decidedAt ?? null,
        sessionId: pair.sessionId,
        note: pair.note ?? null,
        nodeAId: pair.nodeA.id,
        nodeBId: pair.nodeB.id,
      }
    )
  } finally {
    await session.close()
  }
}

export async function writeAuditRecord(record: AuditRecord): Promise<void> {
  if (!isEnabled()) return
  const driver = getDriver()
  const session = driver.session()
  try {
    await session.run(
      `CREATE (r:ERAuditRecord {
         id: $id, sessionId: $sessionId, mergePassId: $mergePassId,
         timestamp: $timestamp, label: $label, conflictStrategy: $conflictStrategy
       })
       WITH r
       MATCH (survivor) WHERE elementId(survivor) = $survivorId
       MERGE (r)-[:MERGED_INTO]->(survivor)`,
      {
        id: record.id,
        sessionId: record.sessionId,
        mergePassId: record.mergePassId,
        timestamp: record.timestamp,
        label: record.label,
        conflictStrategy: record.conflictStrategy,
        survivorId: record.survivorId,
      }
    )
    // Link absorbed nodes
    if (record.absorbedIds.length > 0) {
      await session.run(
        `MATCH (r:ERAuditRecord {id: $id})
         MATCH (n) WHERE elementId(n) IN $ids
         MERGE (r)-[:ABSORBED]->(n)`,
        { id: record.id, ids: record.absorbedIds }
      )
    }
  } finally {
    await session.close()
  }
}
