// ─── AI Configuration Suggestion ─────────────────────────────────────────────

export interface AISuggestionField {
  propertyName: string
  enabled: boolean
  metrics: { metricId: string; threshold: number }[]
  reason: string
}

export interface AISuggestion {
  explanation: string
  fields: AISuggestionField[]
}

// ─── Schema ──────────────────────────────────────────────────────────────────

export type PropertyKind = 'identifier' | 'name' | 'text' | 'numeric' | 'boolean' | 'date' | 'other'

export interface PropertyMeta {
  name: string
  types: string[]
  mandatory: boolean
  inferredKind: PropertyKind
  sampleValues: unknown[]
}

export interface LabelMeta {
  name: string
  count: number
  properties: PropertyMeta[]
}

export interface RelTypeMeta {
  name: string
  startLabels: string[]
  endLabels: string[]
}

export interface SchemaModel {
  labels: LabelMeta[]
  relationshipTypes: RelTypeMeta[]
  discoveredAt: string // ISO string
  apocAvailable: boolean
}

// ─── Connection ───────────────────────────────────────────────────────────────

export interface ConnectionProfile {
  id: string
  name: string
  uri: string
  username: string
  database: string
}

export interface TestConnectionResult {
  ok: boolean
  latencyMs?: number
  nodeCount?: number
  relCount?: number
  apocAvailable?: boolean
  error?: string
}

// ─── Session ─────────────────────────────────────────────────────────────────

export type SessionStatus = 'configuring' | 'computing' | 'reviewing' | 'merges-applied'
export type Verdict = 'pending' | 'duplicate' | 'distinct'
export type ReviewSort = 'score-desc' | 'score-asc' | 'recently-decided' | 'pending-first'

export interface ReviewFilter {
  verdict: 'all' | Verdict
}

export interface MetricConfig {
  metricId: string
  params: Record<string, unknown>
  threshold: number
}

export interface FieldConfig {
  propertyName: string
  metrics: MetricConfig[]
}

export interface FieldSurfacingConfig {
  propertyName: string
  threshold: number
  weight: number
}

export interface SurfacingRule {
  mode: 'any' | 'all' | 'weighted-average'
  fields: FieldSurfacingConfig[]
  combinedThreshold?: number
}

export interface MergePassSummary {
  id: string
  appliedAt: string // ISO
  groupsApplied: number
  groupsSkipped: number
  groupsFailed: number
}

export interface Session {
  id: string
  connectionId: string
  label: string
  fields: FieldConfig[]
  surfacingRule: SurfacingRule
  status: SessionStatus
  reviewCursor: number
  reviewFilter: ReviewFilter
  reviewSort: ReviewSort
  mergePasses: MergePassSummary[]
  createdAt: string
  updatedAt: string
}

// ─── Pairs ────────────────────────────────────────────────────────────────────

export interface NodeSnapshot {
  id: string
  properties: Record<string, unknown>
}

export interface MetricScore {
  metricId: string
  fieldName: string
  score: number
  aboveThreshold: boolean
}

export interface CandidatePair {
  id: string // sha1(sort([idA,idB]))[:12]
  sessionId: string
  label: string
  nodeA: NodeSnapshot
  nodeB: NodeSnapshot
  scores: MetricScore[]
  verdict: Verdict
  decidedAt?: string
  note?: string
}

// ─── Score distributions ──────────────────────────────────────────────────────

export interface ScorePercentiles {
  metricId: string
  fieldName: string
  p50: number
  p75: number
  p90: number
  p95: number
  max: number
}

export interface ScoreDistributions {
  all: ScorePercentiles[]
  pending: ScorePercentiles[]
}

// ─── Merge ───────────────────────────────────────────────────────────────────

export interface MergeGroup {
  memberIds: string[] // elementIds
  memberTexts: string[]
  survivorId: string
  directlyComparedPairs: [string, string][]
  transitivePairs: [string, string][] // not directly reviewed
}

export interface MergeApplyResult {
  groupsApplied: number
  groupsSkipped: number
  groupsFailed: number
  passId: string
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface AppSettings {
  anthropicApiKey: string
  openaiApiKey: string
  assistantModel: string
  excludedLabels: string[]
  theme: 'light' | 'dark' | 'system'
  useNeo4jStorage: boolean
}

// ─── Audit ───────────────────────────────────────────────────────────────────

export interface AuditRecord {
  id: string
  sessionId: string
  mergePassId: string
  timestamp: string
  label: string
  survivorId: string
  survivorProperties: Record<string, unknown>
  absorbedIds: string[]
  absorbedProperties: Record<string, unknown>[]
  scores: MetricScore[]
  conflictStrategy: 'discard' | 'overwrite' | 'combine'
}
