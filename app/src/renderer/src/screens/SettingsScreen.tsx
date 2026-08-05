import { useState, useEffect } from 'react'
import { useStore } from '../store'
import {
  DEFAULT_ASSISTANT_MODEL,
  DEFAULT_CLASSIFY_BATCH_SIZE,
  DEFAULT_CLASSIFY_FEW_SHOT_COUNT,
  DEFAULT_CLASSIFY_CACHED_PREFIX,
} from '../../../shared/constants'
import type { AppSettings, ModelPricing } from '../../../shared/types'

// Keeps a partially-typed number input from writing NaN into settings.
function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

export default function SettingsScreen() {
  const { setScreen, addToast, setSettings, connection } = useStore()
  const [form, setForm] = useState<AppSettings>({
    anthropicApiKey: '',
    openaiApiKey: '',
    assistantModel: DEFAULT_ASSISTANT_MODEL,
    excludedLabels: ['__Entity__', '__KGBuilder__', 'Document', 'Chunk', '_Bloom_Perspective_', '_Bloom_Scene_'],
    theme: 'dark',
    useNeo4jStorage: false,
    pricingOverrides: {},
    classifyBatchSize: DEFAULT_CLASSIFY_BATCH_SIZE,
    classifyFewShotCount: DEFAULT_CLASSIFY_FEW_SHOT_COUNT,
    classifyCachedPrefix: DEFAULT_CLASSIFY_CACHED_PREFIX,
  })
  const [saving, setSaving] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [pricing, setPricing] = useState<ModelPricing[]>([])

  useEffect(() => {
    window.api.settings.get().then((s) => {
      setForm(s)
      setSettings(s)
    })
    window.api.usage.pricing().then(setPricing)
  }, [])

  // Derived from the pricing catalog rather than a separate hard-coded list, so
  // the two can't drift and every selectable model is guaranteed to be priced.
  const modelOptions = (() => {
    const options = pricing.map((p) => ({
      id: p.modelId,
      label: `${p.displayName} — $${p.inputPerMTok.toFixed(2)} in / $${p.outputPerMTok.toFixed(2)} out`,
    }))
    // A saved model may be a dated snapshot (claude-haiku-4-5-20251001) that the
    // catalog stores un-dated. Keep it as an option so rendering the select
    // doesn't silently switch the user onto a different model.
    if (form.assistantModel && !options.some((o) => o.id === form.assistantModel)) {
      options.unshift({ id: form.assistantModel, label: `${form.assistantModel} (current)` })
    }
    return options
  })()

  // Cache rates are derived from the input rate, so an override only carries the
  // two rates the user can meaningfully set.
  function setRate(
    modelId: string,
    field: 'inputPerMTok' | 'outputPerMTok',
    raw: string
  ): void {
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0) return
    setForm((prev) => ({
      ...prev,
      pricingOverrides: {
        ...prev.pricingOverrides,
        [modelId]: { ...prev.pricingOverrides[modelId], [field]: value },
      },
    }))
    setPricing((prev) =>
      prev.map((p) =>
        p.modelId === modelId
          ? {
              ...p,
              [field]: value,
              overridden: true,
              ...(field === 'inputPerMTok'
                ? {
                    cacheWrite5mPerMTok: value * 1.25,
                    cacheWrite1hPerMTok: value * 2,
                    cacheReadPerMTok: value * 0.1,
                  }
                : {}),
            }
          : p
      )
    )
  }

  async function resetPricing(): Promise<void> {
    const next = { ...form, pricingOverrides: {} }
    setForm(next)
    await window.api.settings.set(next)
    setSettings(next)
    setPricing(await window.api.usage.pricing())
    addToast('Pricing reset to bundled rates', 'success')
  }

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
          {/* Settings is reachable before connecting, so Back must not land on
              the session list with no connection selected. */}
          <button
            onClick={() => setScreen(connection ? 'sessions' : 'connect')}
            className="btn-ghost text-xs"
          >
            ← Back
          </button>
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
              {modelOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-600 mt-1">
              Drives the assistant, auto-classify, and field suggestions. Rates are per million
              tokens; cheaper models also have a higher prompt-cache minimum, which the classify
              dialog reports.
            </p>
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

        {/* Auto-classify */}
        <section className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">AI Auto-classify</h2>
          <p className="text-xs text-gray-500">
            Controls how pending pairs are sent to Claude. Batching is the cost lever; the cached
            prefix is what makes worked examples affordable.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Pairs per request</label>
              <input
                type="number"
                min="1"
                max="50"
                className="input"
                value={form.classifyBatchSize}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    classifyBatchSize: clampInt(e.target.value, 1, 50, p.classifyBatchSize),
                  }))
                }
              />
              <p className="text-xs text-gray-600 mt-1">
                Larger batches cost less per pair, but cancelling mid-run wastes up to one batch.
              </p>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Worked examples</label>
              <input
                type="number"
                min="0"
                max="50"
                className="input"
                value={form.classifyFewShotCount}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    classifyFewShotCount: clampInt(e.target.value, 0, 50, p.classifyFewShotCount),
                  }))
                }
              />
              <p className="text-xs text-gray-600 mt-1">
                Your own reviewed pairs, included in the prompt as examples. Balanced across
                Duplicate and Distinct.
              </p>
            </div>
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.classifyCachedPrefix}
              onChange={(e) => setForm((p) => ({ ...p, classifyCachedPrefix: e.target.checked }))}
              className="w-4 h-4 accent-emerald-500"
            />
            <div>
              <div className="text-sm text-white">Cache the shared prompt prefix</div>
              <div className="text-xs text-gray-500 mt-0.5">
                Re-reads the dataset context and examples at 10% of input price. Has no effect
                unless the prefix clears the model&apos;s minimum — the classify dialog reports
                whether it does.
              </div>
            </div>
          </label>
        </section>

        {/* Token pricing */}
        <section className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Token Pricing</h2>
            {Object.keys(form.pricingOverrides).length > 0 && (
              <button onClick={resetPricing} className="text-xs text-gray-500 hover:text-gray-300">
                Reset to bundled rates
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500">
            USD per million tokens, used to cost every Claude call. Anthropic publishes no pricing
            API, so these ship with the app — edit a rate here if it has changed. Cache-write and
            cache-read rates are derived from the input rate (1.25× / 2× for 5m / 1h writes, 0.1×
            for reads).
          </p>
          <div className="space-y-1">
            <div className="grid grid-cols-[1fr_5rem_5rem_7rem] gap-2 text-[11px] text-gray-600 uppercase tracking-wide px-1">
              <span>Model</span>
              <span className="text-right">Input</span>
              <span className="text-right">Output</span>
              <span className="text-right">Cache read/write</span>
            </div>
            {pricing.map((p) => (
              <div
                key={p.modelId}
                className="grid grid-cols-[1fr_5rem_5rem_7rem] gap-2 items-center px-1 py-1 rounded hover:bg-gray-850"
              >
                <span className="text-xs text-gray-300 truncate" title={p.modelId}>
                  {p.displayName}
                  {p.overridden && <span className="ml-1 text-amber-500" title="Overridden">•</span>}
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={p.inputPerMTok}
                  onChange={(e) => setRate(p.modelId, 'inputPerMTok', e.target.value)}
                  className="input py-1 text-xs text-right"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={p.outputPerMTok}
                  onChange={(e) => setRate(p.modelId, 'outputPerMTok', e.target.value)}
                  className="input py-1 text-xs text-right"
                />
                <span className="text-xs text-gray-600 text-right tabular-nums">
                  {p.cacheReadPerMTok.toFixed(2)} / {p.cacheWrite5mPerMTok.toFixed(2)}
                </span>
              </div>
            ))}
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
