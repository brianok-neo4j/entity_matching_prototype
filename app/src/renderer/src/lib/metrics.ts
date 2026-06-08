import type { PropertyKind } from '../../../shared/types'

export interface ParamField {
  type: 'number' | 'string' | 'select'
  label: string
  options?: string[]
  min?: number
  max?: number
  step?: number
}

export interface MetricDef {
  id: string
  displayName: string
  description: string
  applicableTo: PropertyKind[]
  defaultThreshold: number
  defaultParams: Record<string, unknown>
  paramSchema?: Record<string, ParamField>
}

export const METRICS: MetricDef[] = [
  {
    id: 'exact-match',
    displayName: 'Exact Match',
    description: 'Normalized exact string equality (case-insensitive)',
    applicableTo: ['name', 'identifier', 'text'],
    defaultThreshold: 1.0,
    defaultParams: {},
  },
  {
    id: 'edit-distance',
    displayName: 'Edit Distance',
    description: 'Levenshtein ratio: 1 − edit_distance / max_length',
    applicableTo: ['name', 'identifier', 'text'],
    defaultThreshold: 0.85,
    defaultParams: { minLen: 3 },
    paramSchema: {
      minLen: { type: 'number', label: 'Min string length', min: 1, max: 20, step: 1 },
    },
  },
  {
    id: 'jaro-winkler',
    displayName: 'Jaro-Winkler',
    description: 'Jaro-Winkler similarity, boosts shared prefix',
    applicableTo: ['name', 'identifier'],
    defaultThreshold: 0.88,
    defaultParams: { prefixWeight: 0.1 },
    paramSchema: {
      prefixWeight: { type: 'number', label: 'Prefix weight', min: 0, max: 0.25, step: 0.01 },
    },
  },
  {
    id: 'token-jaccard',
    displayName: 'Token Jaccard',
    description: 'Set Jaccard on whitespace-split tokens, order-insensitive',
    applicableTo: ['name', 'text'],
    defaultThreshold: 0.5,
    defaultParams: { tokenMode: 'whitespace-lowercase' },
    paramSchema: {
      tokenMode: { type: 'select', label: 'Tokenization', options: ['whitespace-lowercase', 'alphanumeric'] },
    },
  },
  {
    id: 'token-sort-ratio',
    displayName: 'Token Sort Ratio',
    description: 'Tokens sorted alphabetically then LCS ratio applied',
    applicableTo: ['name', 'text'],
    defaultThreshold: 0.85,
    defaultParams: { tokenMode: 'whitespace-lowercase' },
    paramSchema: {
      tokenMode: { type: 'select', label: 'Tokenization', options: ['whitespace-lowercase', 'alphanumeric'] },
    },
  },
  {
    id: 'phonetic',
    displayName: 'Phonetic',
    description: 'Double Metaphone grouping (score 1.0 if same phonetic code)',
    applicableTo: ['name'],
    defaultThreshold: 1.0,
    defaultParams: {},
  },
  {
    id: 'numeric-proximity',
    displayName: 'Numeric Proximity',
    description: '1 − |a−b| / max(|a|, |b|, 1)',
    applicableTo: ['numeric'],
    defaultThreshold: 0.95,
    defaultParams: {},
  },
  {
    id: 'semantic-cosine',
    displayName: 'Semantic Cosine',
    description: 'Cosine similarity of sentence embeddings (BGE, OpenAI, or stored property)',
    applicableTo: ['name', 'text'],
    defaultThreshold: 0.92,
    defaultParams: { backend: 'bge', embeddingProperty: '' },
    paramSchema: {
      backend: { type: 'select', label: 'Backend', options: ['bge', 'openai', 'neo4j-property'] },
      embeddingProperty: { type: 'string', label: 'Embedding property (neo4j-property only)' },
    },
  },
]

export function getMetricDef(id: string): MetricDef | undefined {
  return METRICS.find((m) => m.id === id)
}

export function suggestMetrics(kind: PropertyKind): MetricDef[] {
  // Default suggestions per kind (most useful first)
  const preferred: Record<string, string[]> = {
    name: ['edit-distance', 'jaro-winkler', 'token-jaccard'],
    text: ['token-jaccard', 'semantic-cosine'],
    identifier: ['exact-match', 'edit-distance'],
    numeric: ['numeric-proximity'],
    boolean: [],
    date: [],
    other: [],
  }
  const ids = preferred[kind] ?? []
  return ids.map((id) => METRICS.find((m) => m.id === id)!).filter(Boolean)
}
