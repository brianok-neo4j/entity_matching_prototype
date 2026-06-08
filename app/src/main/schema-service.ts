import { getDriver } from './connection-service'
import { getSettings } from './settings-service'
import { toJsNumber, sanitize } from './neo4j-int'
import type { SchemaModel, LabelMeta, PropertyMeta, PropertyKind, RelTypeMeta } from '../shared/types'

let _cached: SchemaModel | null = null

export async function discoverSchema(): Promise<SchemaModel> {
  const driver = getDriver()
  const { excludedLabels } = getSettings()

  const session = driver.session()
  try {
    // Node type properties
    const propResult = await session.run(`
      CALL db.schema.nodeTypeProperties()
      YIELD nodeLabels, propertyName, propertyTypes, mandatory
      RETURN nodeLabels, propertyName, propertyTypes, mandatory
      ORDER BY nodeLabels, propertyName
    `)

    // Relationship types
    const relResult = await session.run(`
      CALL db.schema.relTypeProperties()
      YIELD relType, propertyName, propertyTypes
      RETURN relType, propertyName, propertyTypes
      ORDER BY relType
    `)

    // Node counts
    let countsMap: Record<string, number> = {}
    try {
      const statsResult = await session.run('CALL apoc.meta.stats() YIELD labels RETURN labels')
      const raw = statsResult.records[0].get('labels') as Record<string, unknown>
      for (const [k, v] of Object.entries(raw)) countsMap[k] = toJsNumber(v)
    } catch {
      const fallback = await session.run(`
        MATCH (n) UNWIND labels(n) AS lab
        RETURN lab AS label, count(n) AS total ORDER BY total DESC
      `)
      for (const r of fallback.records) {
        countsMap[r.get('label') as string] = toJsNumber(r.get('total'))
      }
    }

    // APOC availability
    let apocAvailable = false
    try {
      await session.run('RETURN apoc.version() AS v')
      apocAvailable = true
    } catch { /* not available */ }

    // Build label map
    const labelMap = new Map<string, { properties: Map<string, PropertyMeta> }>()

    for (const record of propResult.records) {
      const nodeLabels: string[] = record.get('nodeLabels')
      const propertyName: string | null = record.get('propertyName')
      const propertyTypes: string[] = record.get('propertyTypes') ?? []
      const mandatory: boolean = record.get('mandatory') ?? false

      for (const label of nodeLabels) {
        if (excludedLabels.includes(label)) continue
        if (!labelMap.has(label)) labelMap.set(label, { properties: new Map() })
        if (!propertyName) continue
        const entry = labelMap.get(label)!
        if (!entry.properties.has(propertyName)) {
          entry.properties.set(propertyName, {
            name: propertyName,
            types: propertyTypes,
            mandatory,
            inferredKind: 'other',
            sampleValues: [],
          })
        }
      }
    }

    // Also ensure every label that appears in countsMap has an entry
    for (const label of Object.keys(countsMap)) {
      if (!excludedLabels.includes(label) && !labelMap.has(label)) {
        labelMap.set(label, { properties: new Map() })
      }
    }

    // Fetch sample values and infer kind.
    // If the schema procedure returned no properties for a label (common on Aura when
    // there are no schema constraints), fall back to sampling actual nodes.
    const labels: LabelMeta[] = []
    for (const [label, { properties }] of labelMap) {
      if (properties.size === 0) {
        try {
          const sampleResult = await session.run(
            `MATCH (n:\`${label}\`) RETURN properties(n) AS props LIMIT 3`
          )
          for (const r of sampleResult.records) {
            const props = r.get('props') as Record<string, unknown> | null
            if (!props) continue
            for (const key of Object.keys(props)) {
              if (!properties.has(key)) {
                properties.set(key, {
                  name: key,
                  types: [],
                  mandatory: false,
                  inferredKind: 'other',
                  sampleValues: [],
                })
              }
            }
          }
        } catch { /* ignore */ }
      }

      const propMetas: PropertyMeta[] = []
      for (const [propName, meta] of properties) {
        const sampleResult = await session.run(
          `MATCH (n:\`${label}\`) WHERE n.\`${propName}\` IS NOT NULL RETURN DISTINCT n.\`${propName}\` AS val LIMIT 10`
        )
        meta.sampleValues = sampleResult.records.map((r) => sanitize(r.get('val')))
        meta.inferredKind = inferKind(meta)
        propMetas.push(meta)
      }
      labels.push({ name: label, count: countsMap[label] ?? 0, properties: propMetas })
    }

    // Sort by count desc
    labels.sort((a, b) => Number(b.count) - Number(a.count))

    // Relationship types
    const relMap = new Map<string, RelTypeMeta>()
    for (const record of relResult.records) {
      const relType: string = record.get('relType').replace(/^:`|`$/g, '')
      if (!relMap.has(relType)) {
        relMap.set(relType, { name: relType, startLabels: [], endLabels: [] })
      }
    }
    const relationshipTypes = Array.from(relMap.values())

    _cached = { labels, relationshipTypes, discoveredAt: new Date().toISOString(), apocAvailable }
    return _cached
  } finally {
    await session.close()
  }
}

export function getCachedSchema(): SchemaModel | null {
  return _cached
}

function inferKind(meta: PropertyMeta): PropertyKind {
  const types = meta.types.map((t) => t.toLowerCase())
  if (types.includes('long') || types.includes('double') || types.includes('float') || types.includes('integer')) {
    return 'numeric'
  }
  if (types.includes('boolean')) return 'boolean'
  if (types.includes('date') || types.includes('datetime') || types.includes('localdatetime')) return 'date'
  // Only hard-return 'other' when we have explicit non-string type info.
  // Empty types (no schema constraints) falls through to sample-value heuristics.
  if (types.length > 0 && !types.includes('string')) return 'other'

  const samples = meta.sampleValues.filter((v) => typeof v === 'string') as string[]
  if (samples.length === 0) return 'name'

  const avgLen = samples.reduce((s, v) => s + v.length, 0) / samples.length
  const identifierPattern = /[\d.()/\\-]/
  const identifierLike = samples.filter((s) => identifierPattern.test(s)).length / samples.length

  if (avgLen < 20 && identifierLike > 0.5) return 'identifier'
  if (avgLen > 100) return 'text'
  return 'name'
}
