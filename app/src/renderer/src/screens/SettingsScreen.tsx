import { useState, useEffect } from 'react'
import { useStore } from '../store'
import type { AppSettings } from '../../../shared/types'

const MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
]

export default function SettingsScreen() {
  const { setScreen, addToast, setSettings } = useStore()
  const [form, setForm] = useState<AppSettings>({
    anthropicApiKey: '',
    openaiApiKey: '',
    assistantModel: 'claude-haiku-4-5-20251001',
    excludedLabels: ['__Entity__', '__KGBuilder__', 'Document', 'Chunk', '_Bloom_Perspective_', '_Bloom_Scene_'],
    theme: 'dark',
    useNeo4jStorage: false,
  })
  const [saving, setSaving] = useState(false)
  const [newLabel, setNewLabel] = useState('')

  useEffect(() => {
    window.api.settings.get().then((s) => {
      setForm(s)
      setSettings(s)
    })
  }, [])

  async function save() {
    setSaving(true)
    try {
      await window.api.settings.set(form)
      setSettings(form)
      addToast('Settings saved', 'success')
    } catch (err) {
      addToast(`Save failed: ${(err as Error).message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  function addLabel() {
    const trimmed = newLabel.trim()
    if (!trimmed || form.excludedLabels.includes(trimmed)) return
    setForm((f) => ({ ...f, excludedLabels: [...f.excludedLabels, trimmed] }))
    setNewLabel('')
  }

  function removeLabel(label: string) {
    setForm((f) => ({ ...f, excludedLabels: f.excludedLabels.filter((l) => l !== label) }))
  }

  const f = <K extends keyof AppSettings>(key: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto py-12 px-6 space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <button onClick={() => setScreen('sessions')} className="btn-ghost text-xs">← Back</button>
        </div>

        {/* API Keys */}
        <section className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">API Keys</h2>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Anthropic API Key</label>
            <input
              type="password"
              className="input"
              placeholder="sk-ant-…"
              value={form.anthropicApiKey}
              onChange={f('anthropicApiKey')}
            />
            <p className="text-xs text-gray-600 mt-1">Used for the assistant panel (Claude).</p>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">OpenAI API Key</label>
            <input
              type="password"
              className="input"
              placeholder="sk-…"
              value={form.openaiApiKey}
              onChange={f('openaiApiKey')}
            />
            <p className="text-xs text-gray-600 mt-1">Required only for the OpenAI semantic-cosine backend.</p>
          </div>
        </section>

        {/* Assistant Model */}
        <section className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Assistant</h2>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Model</label>
            <select className="input" value={form.assistantModel} onChange={f('assistantModel')}>
              {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </section>

        {/* Excluded Labels */}
        <section className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Hidden Labels</h2>
          <p className="text-xs text-gray-500">
            These node labels are excluded from the schema discovery and label selector.
          </p>
          <div className="flex flex-wrap gap-2">
            {form.excludedLabels.map((l) => (
              <span key={l} className="flex items-center gap-1 px-2 py-1 bg-gray-800 rounded-full text-xs text-gray-300">
                {l}
                <button onClick={() => removeLabel(l)} className="text-gray-500 hover:text-red-400 leading-none ml-1">×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="Label name"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addLabel()}
            />
            <button onClick={addLabel} disabled={!newLabel.trim()} className="btn-secondary text-xs px-3">Add</button>
          </div>
        </section>

        {/* Appearance */}
        <section className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Appearance</h2>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Theme</label>
            <select className="input w-48" value={form.theme} onChange={f('theme')}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </div>
        </section>

        {/* Neo4j Storage */}
        <section className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Neo4j Storage</h2>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.useNeo4jStorage}
              onChange={(e) => setForm((prev) => ({ ...prev, useNeo4jStorage: e.target.checked }))}
              className="w-4 h-4 accent-emerald-500"
            />
            <div>
              <div className="text-sm text-white">Write pairs and audit records to Neo4j</div>
              <div className="text-xs text-gray-500 mt-0.5">
                Creates ERPair, ERPairScore, and ERAuditRecord nodes in the connected graph.
              </div>
            </div>
          </label>
        </section>

        <button onClick={save} disabled={saving} className="btn-primary px-8 py-2">
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}
