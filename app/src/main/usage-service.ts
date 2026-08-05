import { randomUUID } from 'crypto'
import { getDb } from './db'
import { getSettings } from './settings-service'
import { computeCost, normalizeModelId, getPricing } from './pricing'
import type {
  JobEstimate,
  LlmCallRecord,
  LlmJobKind,
  TokenCounts,
  UsageSummary,
  UsageTotals,
} from '../shared/types'

// Cold-start divisor for turning prompt characters into an input-token guess.
// Deliberately conservative: over-estimating a cost preview is the safer error.
const CHARS_PER_TOKEN = 3.6

// Only the most recent runs inform an estimate — prompt shapes drift as the
// app changes, and stale runs would anchor the mean.
const ESTIMATE_WINDOW = 20
const MIN_SAMPLES = 2

const ZERO_TOTALS: UsageTotals = {
  callCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  totalTokens: 0,
  costUsd: 0,
  unpricedCallCount: 0,
}

export function emptyTokens(): TokenCounts {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  }
}

// The SDK's Usage shape varies by model and API version; read defensively so a
// missing field costs us a token count rather than throwing mid-job.
export function tokensFromUsage(usage: unknown): TokenCounts {
  const u = (usage ?? {}) as Record<string, unknown>
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const creation = (u.cache_creation ?? {}) as Record<string, unknown>

  const t: TokenCounts = {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheReadInputTokens: num(u.cache_read_input_tokens),
    cacheCreationInputTokens: num(u.cache_creation_input_tokens),
  }
  if (creation.ephemeral_5m_input_tokens !== undefined) {
    t.cacheCreation5mTokens = num(creation.ephemeral_5m_input_tokens)
  }
  if (creation.ephemeral_1h_input_tokens !== undefined) {
    t.cacheCreation1hTokens = num(creation.ephemeral_1h_input_tokens)
  }
  return t
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export function startJob(input: {
  kind: LlmJobKind
  model: string
  sessionId: string | null
  unitCount: number
  // Discriminates prompt shapes whose per-unit token profile differs (batch
  // size, cached prefix). Estimates only draw on samples from a matching
  // variant, so changing the shape doesn't poison history.
  variant?: string
  features?: Record<string, number | string>
}): string {
  const id = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO llm_jobs (id, session_id, kind, model, status, started_at, unit_count, variant, features_json)
       VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)`
    )
    .run(
      id,
      input.sessionId,
      input.kind,
      normalizeModelId(input.model),
      Date.now(),
      input.unitCount,
      input.variant ?? '',
      JSON.stringify(input.features ?? {})
    )
  return id
}

export function finishJob(
  jobId: string,
  status: 'complete' | 'cancelled' | 'failed',
  unitsCompleted: number
): void {
  getDb()
    .prepare(`UPDATE llm_jobs SET status = ?, ended_at = ?, units_completed = ? WHERE id = ?`)
    .run(status, Date.now(), unitsCompleted, jobId)
}

// ─── Calls ────────────────────────────────────────────────────────────────────

export function recordCall(input: {
  jobId: string | null
  sessionId: string | null
  kind: LlmJobKind
  model: string
  startedAt: number
  tokens: TokenCounts
  ok: boolean
  error?: string | null
  stopReason?: string | null
  speed?: string
  features?: Record<string, number | string>
}): LlmCallRecord {
  const { pricingOverrides } = getSettings()
  const cost = computeCost(input.model, input.tokens, pricingOverrides, {
    at: input.startedAt,
    speed: input.speed,
  })
  const durationMs = Date.now() - input.startedAt
  const id = randomUUID()
  const features = input.features ?? {}

  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO llm_calls (
         id, job_id, session_id, kind, model, started_at, duration_ms,
         input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
         cost_usd, priced, pricing_version, ok, error, stop_reason, features_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.jobId,
      input.sessionId,
      input.kind,
      normalizeModelId(input.model),
      input.startedAt,
      durationMs,
      input.tokens.inputTokens,
      input.tokens.outputTokens,
      input.tokens.cacheReadInputTokens,
      input.tokens.cacheCreationInputTokens,
      cost.totalUsd,
      cost.priced ? 1 : 0,
      cost.pricingVersion,
      input.ok ? 1 : 0,
      input.error ?? null,
      input.stopReason ?? null,
      JSON.stringify(features)
    )

    if (input.jobId) {
      db.prepare(
        `UPDATE llm_jobs SET
           call_count            = call_count + 1,
           input_tokens          = input_tokens + ?,
           output_tokens         = output_tokens + ?,
           cache_read_tokens     = cache_read_tokens + ?,
           cache_creation_tokens = cache_creation_tokens + ?,
           cost_usd              = cost_usd + ?
         WHERE id = ?`
      ).run(
        input.tokens.inputTokens,
        input.tokens.outputTokens,
        input.tokens.cacheReadInputTokens,
        input.tokens.cacheCreationInputTokens,
        cost.totalUsd,
        input.jobId
      )
    }
  })
  tx()

  return {
    id,
    jobId: input.jobId,
    sessionId: input.sessionId,
    kind: input.kind,
    model: normalizeModelId(input.model),
    startedAt: input.startedAt,
    durationMs,
    tokens: input.tokens,
    cost,
    ok: input.ok,
    error: input.error ?? null,
    stopReason: input.stopReason ?? null,
    features,
  }
}

// ─── Aggregates ───────────────────────────────────────────────────────────────

interface TotalsRow {
  call_count: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  cost_usd: number
  unpriced: number
}

const TOTALS_SELECT = `
  COUNT(*)                            AS call_count,
  COALESCE(SUM(input_tokens), 0)          AS input_tokens,
  COALESCE(SUM(output_tokens), 0)         AS output_tokens,
  COALESCE(SUM(cache_read_tokens), 0)     AS cache_read_tokens,
  COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
  COALESCE(SUM(cost_usd), 0)              AS cost_usd,
  COALESCE(SUM(CASE WHEN priced = 0 THEN 1 ELSE 0 END), 0) AS unpriced`

function toTotals(row: TotalsRow | undefined): UsageTotals {
  if (!row) return { ...ZERO_TOTALS }
  return {
    callCount: row.call_count,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadInputTokens: row.cache_read_tokens,
    cacheCreationInputTokens: row.cache_creation_tokens,
    totalTokens:
      row.input_tokens + row.output_tokens + row.cache_read_tokens + row.cache_creation_tokens,
    costUsd: row.cost_usd,
    unpricedCallCount: row.unpriced,
  }
}

function summarize(where: string, params: unknown[]): UsageSummary {
  const db = getDb()
  const totals = toTotals(
    db.prepare(`SELECT ${TOTALS_SELECT} FROM llm_calls ${where}`).get(...params) as TotalsRow
  )
  const byKind = (
    db
      .prepare(`SELECT kind, ${TOTALS_SELECT} FROM llm_calls ${where} GROUP BY kind`)
      .all(...params) as (TotalsRow & { kind: LlmJobKind })[]
  ).map((r) => ({ kind: r.kind, totals: toTotals(r) }))
  const byModel = (
    db
      .prepare(`SELECT model, ${TOTALS_SELECT} FROM llm_calls ${where} GROUP BY model`)
      .all(...params) as (TotalsRow & { model: string })[]
  ).map((r) => ({ model: r.model, totals: toTotals(r) }))

  return { totals, byKind, byModel }
}

export function getJobTotals(jobId: string): UsageTotals {
  const row = getDb()
    .prepare(
      `SELECT call_count, input_tokens, output_tokens, cache_read_tokens,
              cache_creation_tokens, cost_usd, 0 AS unpriced
       FROM llm_jobs WHERE id = ?`
    )
    .get(jobId) as TotalsRow | undefined
  return toTotals(row)
}

export function getSessionUsage(sessionId: string): UsageSummary {
  return summarize('WHERE session_id = ?', [sessionId])
}

export function getLifetimeUsage(): UsageSummary {
  return summarize('', [])
}

// ─── Estimation ───────────────────────────────────────────────────────────────

interface PerUnitSample {
  input: number
  output: number
  cacheRead: number
  durationMs: number
}

function jobSamples(
  kind: LlmJobKind,
  model: string | null,
  variant: string
): PerUnitSample[] {
  const db = getDb()
  const clauses = [
    `kind = ?`,
    `variant = ?`,
    `status IN ('complete', 'cancelled')`,
    `units_completed > 0`,
  ]
  const params: unknown[] = [kind, variant]
  if (model) {
    clauses.push('model = ?')
    params.push(normalizeModelId(model))
  }
  const rows = db
    .prepare(
      `SELECT input_tokens, output_tokens, cache_read_tokens, units_completed, started_at,
              ended_at, features_json
       FROM llm_jobs WHERE ${clauses.join(' AND ')}
       ORDER BY started_at DESC LIMIT ?`
    )
    .all(...params, ESTIMATE_WINDOW) as {
    input_tokens: number
    output_tokens: number
    cache_read_tokens: number
    units_completed: number
    started_at: number
    ended_at: number | null
    features_json: string
  }[]

  return rows.map((r) => {
    // Wall-clock depends on how many calls ran in parallel, so store duration
    // normalised to serial-equivalent. The estimate divides by the concurrency
    // the next run will actually use.
    let ranAt = 1
    try {
      const f = JSON.parse(r.features_json) as { concurrency?: number }
      if (typeof f.concurrency === 'number' && f.concurrency > 0) ranAt = f.concurrency
    } catch {
      // features are advisory; a malformed blob just means concurrency 1
    }
    return {
      input: r.input_tokens / r.units_completed,
      output: r.output_tokens / r.units_completed,
      cacheRead: r.cache_read_tokens / r.units_completed,
      durationMs: r.ended_at ? ((r.ended_at - r.started_at) * ranAt) / r.units_completed : 0,
    }
  })
}

function meanAndSpread(values: number[]): { mean: number; sd: number } {
  if (values.length === 0) return { mean: 0, sd: 0 }
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  if (values.length < 2) return { mean, sd: 0 }
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1)
  return { mean, sd: Math.sqrt(variance) }
}

export function estimateJob(input: {
  kind: LlmJobKind
  model: string
  unitCount: number
  variant?: string
  // Cold-start fallback: mean characters of the per-unit portion of the prompt.
  promptCharsPerUnit?: number
  outputTokensPerUnitHint?: number
  // Batching and caching. The prefix is a fixed cost per run rather than a
  // per-unit one, so it is modelled separately from the fitted per-unit terms.
  batchSize?: number
  concurrency?: number
  prefixTokens?: number
  prefixCacheable?: boolean
}): JobEstimate {
  const { pricingOverrides } = getSettings()
  const model = normalizeModelId(input.model)
  const variant = input.variant ?? ''
  const batchSize = Math.max(1, input.batchSize ?? 1)
  const prefixTokens = input.prefixTokens ?? 0
  const callCount = Math.ceil(input.unitCount / batchSize)

  let samples = jobSamples(input.kind, model, variant)
  let basis: JobEstimate['basis'] = samples.length >= MIN_SAMPLES ? 'history' : 'none'

  if (basis === 'none') {
    const crossModel = jobSamples(input.kind, null, variant)
    if (crossModel.length >= MIN_SAMPLES) {
      samples = crossModel
      basis = 'history-other-model'
    }
  }

  let perUnitInput: { mean: number; sd: number }
  let perUnitOutput: { mean: number; sd: number }
  let perUnitCacheRead = 0
  let perUnitDuration: number | null = null

  if (basis === 'none') {
    if (!input.promptCharsPerUnit) {
      return {
        kind: input.kind,
        model,
        unitCount: input.unitCount,
        callCount,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUsd: 0,
        costLowUsd: 0,
        costHighUsd: 0,
        durationMsEstimate: null,
        basis: 'none',
        sampleSize: 0,
        priced: getPricing(model, pricingOverrides) !== null,
      }
    }
    basis = 'prompt-size'
    const estInput = input.promptCharsPerUnit / CHARS_PER_TOKEN
    perUnitInput = { mean: estInput, sd: estInput * 0.25 }
    const estOutput = input.outputTokensPerUnitHint ?? 0
    perUnitOutput = { mean: estOutput, sd: estOutput * 0.4 }
    // On a cold start the prefix cost has to be derived rather than fitted: a
    // cacheable prefix is written once and read back on every later call; an
    // uncacheable one is re-sent in full every call.
    if (input.prefixCacheable) {
      perUnitCacheRead = (Math.max(0, callCount - 1) * prefixTokens) / Math.max(1, input.unitCount)
    } else {
      perUnitInput.mean += (callCount * prefixTokens) / Math.max(1, input.unitCount)
    }
  } else {
    // Fitted per-unit terms already carry whatever prefix behaviour the sampled
    // runs had, since samples are variant-matched.
    perUnitInput = meanAndSpread(samples.map((s) => s.input))
    perUnitOutput = meanAndSpread(samples.map((s) => s.output))
    perUnitCacheRead = meanAndSpread(samples.map((s) => s.cacheRead)).mean
    const d = meanAndSpread(samples.map((s) => s.durationMs)).mean
    perUnitDuration = d > 0 ? d : null
  }

  const n = input.unitCount
  // The prefix write is a fixed per-run cost, not a per-unit one — modelling it
  // per unit would scale it with queue size, which is wrong.
  const cacheCreation = input.prefixCacheable ? prefixTokens : 0

  const tokensAt = (inputMult: number, outputMult: number): TokenCounts => ({
    inputTokens: Math.max(0, Math.round((perUnitInput.mean + inputMult * perUnitInput.sd) * n)),
    outputTokens: Math.max(0, Math.round((perUnitOutput.mean + outputMult * perUnitOutput.sd) * n)),
    cacheReadInputTokens: Math.round(perUnitCacheRead * n),
    cacheCreationInputTokens: cacheCreation,
  })

  const mid = tokensAt(0, 0)
  const low = computeCost(model, tokensAt(-1, -1), pricingOverrides)
  const high = computeCost(model, tokensAt(1, 1), pricingOverrides)
  const cost = computeCost(model, mid, pricingOverrides)

  return {
    kind: input.kind,
    model,
    unitCount: n,
    callCount,
    inputTokens: mid.inputTokens,
    outputTokens: mid.outputTokens,
    cacheReadInputTokens: mid.cacheReadInputTokens,
    cacheCreationInputTokens: mid.cacheCreationInputTokens,
    costUsd: cost.totalUsd,
    costLowUsd: low.totalUsd,
    costHighUsd: high.totalUsd,
    durationMsEstimate:
      perUnitDuration !== null
        ? Math.round((perUnitDuration * n) / Math.max(1, input.concurrency ?? 1))
        : null,
    basis,
    sampleSize: samples.length,
    priced: cost.priced,
  }
}
