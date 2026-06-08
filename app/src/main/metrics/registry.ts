import type { MetricModule } from './types'
import { exactMatch } from './exact-match'
import { editDistance } from './edit-distance'
import { jaroWinklerMetric } from './jaro-winkler'
import { tokenJaccard } from './token-jaccard'
import { tokenSortRatio } from './token-sort-ratio'
import { semanticCosine } from './semantic-cosine'
import { phoneticMetric } from './phonetic'
import { numericProximity } from './numeric-proximity'

const registry = new Map<string, MetricModule>()

function register(m: MetricModule) {
  registry.set(m.id, m)
}

register(exactMatch)
register(editDistance)
register(jaroWinklerMetric)
register(tokenJaccard)
register(tokenSortRatio)
register(semanticCosine)
register(phoneticMetric)
register(numericProximity)

export function getMetric(id: string): MetricModule {
  const m = registry.get(id)
  if (!m) throw new Error(`Unknown metric: ${id}`)
  return m
}

export function allMetrics(): MetricModule[] {
  return Array.from(registry.values())
}
