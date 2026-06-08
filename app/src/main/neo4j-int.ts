/**
 * Safely converts any Neo4j integer representation to a plain JS number.
 * Handles: native BigInt (driver v6), neo4j.Integer custom type (driver v4/v5),
 * and plain JS numbers (passthrough).
 */
export function toJsNumber(val: unknown): number {
  if (typeof val === 'number') return val
  if (typeof val === 'bigint') return Number(val)
  if (val !== null && typeof val === 'object') {
    const v = val as Record<string, unknown>
    if (typeof v['toNumber'] === 'function') {
      return (v['toNumber'] as () => number)()
    }
  }
  return Number(val)
}

/**
 * Recursively sanitizes a value returned from Neo4j so it is safe to send
 * over IPC (structured clone) or use in arithmetic.  Converts any
 * neo4j.Integer / BigInt leaves to plain JS numbers.
 */
export function sanitize(val: unknown): unknown {
  if (typeof val === 'bigint') return Number(val)
  if (val === null || val === undefined) return val
  if (typeof val === 'object') {
    const v = val as Record<string, unknown>
    if (typeof v['toNumber'] === 'function') {
      return (v['toNumber'] as () => number)()
    }
    if (Array.isArray(val)) return (val as unknown[]).map(sanitize)
  }
  return val
}
