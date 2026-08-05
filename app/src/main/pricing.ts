import type { ModelPricing, PricingOverrides, TokenCounts, CostBreakdown } from '../shared/types'

// Bump whenever CATALOG changes. Stamped onto every llm_calls row so historical
// costs stay reproducible after a rate change.
export const PRICING_VERSION = '2026-08-04'

// Cache rates are fixed multiples of the model's input rate across the whole
// Claude lineup, so they are derived rather than duplicated per model.
const CACHE_WRITE_5M_MULTIPLIER = 1.25
const CACHE_WRITE_1H_MULTIPLIER = 2.0
const CACHE_READ_MULTIPLIER = 0.1

interface CatalogEntry {
  displayName: string
  inputPerMTok: number
  outputPerMTok: number
  fast?: { inputPerMTok: number; outputPerMTok: number }
  intro?: { untilIso: string; inputPerMTok: number; outputPerMTok: number }
}

const CATALOG: Record<string, CatalogEntry> = {
  'claude-fable-5': { displayName: 'Claude Fable 5', inputPerMTok: 10, outputPerMTok: 50 },
  'claude-mythos-5': { displayName: 'Claude Mythos 5', inputPerMTok: 10, outputPerMTok: 50 },
  'claude-opus-5': {
    displayName: 'Claude Opus 5',
    inputPerMTok: 5,
    outputPerMTok: 25,
    fast: { inputPerMTok: 10, outputPerMTok: 50 },
  },
  'claude-opus-4-8': {
    displayName: 'Claude Opus 4.8',
    inputPerMTok: 5,
    outputPerMTok: 25,
    fast: { inputPerMTok: 10, outputPerMTok: 50 },
  },
  'claude-opus-4-7': { displayName: 'Claude Opus 4.7', inputPerMTok: 5, outputPerMTok: 25 },
  'claude-opus-4-6': { displayName: 'Claude Opus 4.6', inputPerMTok: 5, outputPerMTok: 25 },
  'claude-opus-4-5': { displayName: 'Claude Opus 4.5', inputPerMTok: 5, outputPerMTok: 25 },
  'claude-sonnet-5': {
    displayName: 'Claude Sonnet 5',
    inputPerMTok: 3,
    outputPerMTok: 15,
    intro: { untilIso: '2026-09-01', inputPerMTok: 2, outputPerMTok: 10 },
  },
  'claude-sonnet-4-6': { displayName: 'Claude Sonnet 4.6', inputPerMTok: 3, outputPerMTok: 15 },
  'claude-sonnet-4-5': { displayName: 'Claude Sonnet 4.5', inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku-4-5': { displayName: 'Claude Haiku 4.5', inputPerMTok: 1, outputPerMTok: 5 },
}

// Minimum prefix length before a cache_control breakpoint does anything. Below
// it the API silently declines to cache — no error, just
// cache_creation_input_tokens: 0. Not monotonic across generations.
const CACHE_FLOORS: Record<string, number> = {
  'claude-fable-5': 512,
  'claude-mythos-5': 512,
  'claude-opus-5': 512,
  'claude-opus-4-8': 1024,
  'claude-sonnet-5': 1024,
  'claude-sonnet-4-6': 1024,
  'claude-sonnet-4-5': 1024,
  'claude-opus-4-7': 2048,
  'claude-opus-4-6': 4096,
  'claude-opus-4-5': 4096,
  'claude-haiku-4-5': 4096,
}

const DEFAULT_CACHE_FLOOR = 4096

export function cacheFloorFor(model: string): number {
  return CACHE_FLOORS[normalizeModelId(model)] ?? DEFAULT_CACHE_FLOOR
}

// Models whose cache floor a prefix of this size already clears, cheapest
// input rate first — used to name a concrete alternative when the current
// model's floor is out of reach.
export function modelsCachingAtOrBelow(
  prefixTokens: number,
  overrides: PricingOverrides = {}
): ModelPricing[] {
  return listPricing(overrides)
    .filter((p) => cacheFloorFor(p.modelId) <= prefixTokens)
    .sort((a, b) => a.inputPerMTok - b.inputPerMTok)
}

export function normalizeModelId(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/^(anthropic|us|eu|apac)\./, '')
    .replace(/\[[^\]]*\]$/, '')
    .replace(/@\d{8}$/, '')
    .replace(/-\d{8}$/, '')
    .replace(/-v\d+:\d+$/, '')
}

function expand(entry: CatalogEntry, id: string, opts: { at?: number; speed?: string }): ModelPricing {
  const useIntro =
    entry.intro !== undefined && (opts.at ?? Date.now()) < Date.parse(entry.intro.untilIso)
  const useFast = entry.fast !== undefined && opts.speed === 'fast'

  const rates = useFast ? entry.fast! : useIntro ? entry.intro! : entry

  return {
    modelId: id,
    displayName: entry.displayName,
    inputPerMTok: rates.inputPerMTok,
    outputPerMTok: rates.outputPerMTok,
    cacheWrite5mPerMTok: rates.inputPerMTok * CACHE_WRITE_5M_MULTIPLIER,
    cacheWrite1hPerMTok: rates.inputPerMTok * CACHE_WRITE_1H_MULTIPLIER,
    cacheReadPerMTok: rates.inputPerMTok * CACHE_READ_MULTIPLIER,
  }
}

export function listPricing(overrides: PricingOverrides = {}): ModelPricing[] {
  return Object.entries(CATALOG)
    .map(([id, entry]) => applyOverride(expand(entry, id, {}), overrides[id]))
    .sort((a, b) => b.inputPerMTok - a.inputPerMTok || a.modelId.localeCompare(b.modelId))
}

function applyOverride(base: ModelPricing, override?: Partial<ModelPricing>): ModelPricing {
  if (!override) return base
  const input = override.inputPerMTok ?? base.inputPerMTok
  return {
    ...base,
    inputPerMTok: input,
    outputPerMTok: override.outputPerMTok ?? base.outputPerMTok,
    // Re-derive cache rates from an overridden input rate unless explicitly set.
    cacheWrite5mPerMTok: override.cacheWrite5mPerMTok ?? input * CACHE_WRITE_5M_MULTIPLIER,
    cacheWrite1hPerMTok: override.cacheWrite1hPerMTok ?? input * CACHE_WRITE_1H_MULTIPLIER,
    cacheReadPerMTok: override.cacheReadPerMTok ?? input * CACHE_READ_MULTIPLIER,
    overridden: true,
  }
}

export function getPricing(
  model: string,
  overrides: PricingOverrides = {},
  opts: { at?: number; speed?: string } = {}
): ModelPricing | null {
  const id = normalizeModelId(model)
  const entry = CATALOG[id]
  const override = overrides[id]
  if (!entry) {
    if (!override?.inputPerMTok || !override?.outputPerMTok) return null
    return applyOverride(
      {
        modelId: id,
        displayName: id,
        inputPerMTok: 0,
        outputPerMTok: 0,
        cacheWrite5mPerMTok: 0,
        cacheWrite1hPerMTok: 0,
        cacheReadPerMTok: 0,
      },
      override
    )
  }
  return applyOverride(expand(entry, id, opts), override)
}

export function computeCost(
  model: string,
  tokens: TokenCounts,
  overrides: PricingOverrides = {},
  opts: { at?: number; speed?: string } = {}
): CostBreakdown {
  const pricing = getPricing(model, overrides, opts)
  if (!pricing) {
    return {
      inputUsd: 0,
      outputUsd: 0,
      cacheWriteUsd: 0,
      cacheReadUsd: 0,
      totalUsd: 0,
      priced: false,
      pricingVersion: PRICING_VERSION,
    }
  }

  const per = (count: number, rate: number): number => (count / 1_000_000) * rate

  // The API only splits cache-creation tokens by TTL on newer responses; when it
  // doesn't, everything is 5m (the default TTL this app requests).
  const write1h = tokens.cacheCreation1hTokens ?? 0
  const write5m =
    tokens.cacheCreation5mTokens ?? Math.max(0, tokens.cacheCreationInputTokens - write1h)

  const inputUsd = per(tokens.inputTokens, pricing.inputPerMTok)
  const outputUsd = per(tokens.outputTokens, pricing.outputPerMTok)
  const cacheWriteUsd =
    per(write5m, pricing.cacheWrite5mPerMTok) + per(write1h, pricing.cacheWrite1hPerMTok)
  const cacheReadUsd = per(tokens.cacheReadInputTokens, pricing.cacheReadPerMTok)

  return {
    inputUsd,
    outputUsd,
    cacheWriteUsd,
    cacheReadUsd,
    totalUsd: inputUsd + outputUsd + cacheWriteUsd + cacheReadUsd,
    priced: true,
    pricingVersion: PRICING_VERSION,
  }
}
