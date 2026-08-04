import type { JobEstimate, TokenCounts } from '../../../shared/types'

export function formatUsd(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return `<$0.01`
  if (usd < 1) return `$${usd.toFixed(3).replace(/0$/, '')}`
  return `$${usd.toFixed(2)}`
}

export function formatUsdRange(low: number, high: number): string {
  if (high - low < 0.005) return formatUsd((low + high) / 2)
  return `${formatUsd(low)} – ${formatUsd(high)}`
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

const BASIS_LABEL: Record<JobEstimate['basis'], string> = {
  history: 'from prior runs on this model',
  'history-other-model': 'from prior runs on a different model',
  'prompt-size': 'estimated from prompt size — no run history yet',
  none: 'no basis for an estimate yet',
}

export function describeBasis(e: JobEstimate): string {
  const label = BASIS_LABEL[e.basis]
  if (e.basis === 'history' || e.basis === 'history-other-model') {
    return `${label} (${e.sampleSize} run${e.sampleSize === 1 ? '' : 's'})`
  }
  return label
}

// One-line token summary; cache terms are dropped when unused so the common
// no-cache case stays readable.
export function summarizeTokens(t: TokenCounts): string {
  const parts = [`in ${formatTokens(t.inputTokens)}`, `out ${formatTokens(t.outputTokens)}`]
  if (t.cacheReadInputTokens > 0) parts.push(`cache read ${formatTokens(t.cacheReadInputTokens)}`)
  if (t.cacheCreationInputTokens > 0)
    parts.push(`cache write ${formatTokens(t.cacheCreationInputTokens)}`)
  return parts.join(' · ')
}
