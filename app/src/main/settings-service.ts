import { getDb } from './db'
import { DEFAULT_ASSISTANT_MODEL } from '../shared/constants'
import type { AppSettings } from '../shared/types'

const DEFAULTS: AppSettings = {
  anthropicApiKey: '',
  openaiApiKey: '',
  assistantModel: DEFAULT_ASSISTANT_MODEL,
  excludedLabels: ['__Entity__', '__KGBuilder__', 'Document', 'Chunk', '_Bloom_Perspective_', '_Bloom_Scene_'],
  theme: 'system',
  useNeo4jStorage: false,
  pricingOverrides: {},
  classifyBatchSize: 20,
  classifyFewShotCount: 12,
  classifyCachedPrefix: true,
}

export function getSettings(): AppSettings {
  const db = getDb()
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const stored: Partial<AppSettings> = {}
  for (const { key, value } of rows) {
    try {
      stored[key as keyof AppSettings] = JSON.parse(value)
    } catch {
      // ignore malformed rows
    }
  }
  const merged = { ...DEFAULTS, ...stored }
  // A stored empty string would survive the spread and reach the API as a blank
  // model. Enforcing the invariant here means callers can use
  // settings.assistantModel directly instead of each repeating a fallback.
  if (!merged.assistantModel) merged.assistantModel = DEFAULT_ASSISTANT_MODEL
  return merged
}

export function setSettings(partial: Partial<AppSettings>): void {
  const db = getDb()
  const upsert = db.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)')
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(partial)) {
      upsert.run(key, JSON.stringify(value))
    }
  })
  tx()
}
