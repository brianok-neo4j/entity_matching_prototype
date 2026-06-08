import { getDb } from './db'
import type { AppSettings } from '../shared/types'

const DEFAULTS: AppSettings = {
  anthropicApiKey: '',
  openaiApiKey: '',
  assistantModel: 'claude-haiku-4-5-20251001',
  excludedLabels: ['__Entity__', '__KGBuilder__', 'Document', 'Chunk', '_Bloom_Perspective_', '_Bloom_Scene_'],
  theme: 'system',
  useNeo4jStorage: false,
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
  return { ...DEFAULTS, ...stored }
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
