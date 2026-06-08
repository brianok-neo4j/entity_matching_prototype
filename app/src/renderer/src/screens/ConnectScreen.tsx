import { useState, useEffect } from 'react'
import { useStore } from '../store'
import type { ConnectionProfile, TestConnectionResult } from '../../../shared/types'

const BLANK = { name: '', uri: 'bolt://localhost:7687', username: 'neo4j', password: '', database: 'neo4j' }

export default function ConnectScreen() {
  const { setConnection, setSchema, setScreen, addToast } = useStore()
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [form, setForm] = useState(BLANK)
  const [editId, setEditId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadProfiles() }, [])

  async function loadProfiles() {
    const list = await window.api.connection.list()
    setProfiles(list)
  }

  async function saveProfile() {
    if (!form.name || !form.uri || !form.username) return
    setSaving(true)
    try {
      await window.api.connection.save({ ...form, id: editId ?? undefined })
      setForm(BLANK)
      setEditId(null)
      await loadProfiles()
      addToast('Profile saved', 'success')
    } catch (err) {
      addToast(`Save failed: ${(err as Error).message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function testProfile(id: string) {
    setTestingId(id)
    setTestResult(null)
    try {
      const result = await window.api.connection.test(id)
      setTestResult(result)
    } catch (err) {
      setTestResult({ ok: false, error: (err as Error).message })
    } finally {
      setTestingId(null)
    }
  }

  async function connectProfile(profile: ConnectionProfile) {
    setConnectingId(profile.id)
    setTestResult(null)
    try {
      const schema = await window.api.connection.connect(profile.id)
      setConnection(profile)
      setSchema(schema)
      setScreen('sessions')
    } catch (err) {
      addToast(`Connection failed: ${(err as Error).message}`, 'error')
    } finally {
      setConnectingId(null)
    }
  }

  async function deleteProfile(id: string) {
    if (!confirm('Delete this profile?')) return
    await window.api.connection.delete(id)
    await loadProfiles()
    addToast('Profile deleted')
  }

  function editProfile(p: ConnectionProfile) {
    setEditId(p.id)
    setForm({ name: p.name, uri: p.uri, username: p.username, password: '', database: p.database })
  }

  const f = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }))

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto py-16 px-6 space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Connect to Neo4j</h1>
          <p className="text-gray-400 text-sm mt-1">Add a Bolt connection profile to get started.</p>
        </div>

        {/* Form */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
            {editId ? 'Edit Profile' : 'New Profile'}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Profile Name</label>
              <input className="input" placeholder="My Neo4j" value={form.name} onChange={f('name')} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-400 mb-1">Bolt URI</label>
              <input className="input" placeholder="bolt://localhost:7687" value={form.uri} onChange={f('uri')} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Username</label>
              <input className="input" value={form.username} onChange={f('username')} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Password</label>
              <input type="password" className="input" value={form.password} onChange={f('password')} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Database</label>
              <input className="input" placeholder="neo4j" value={form.database} onChange={f('database')} />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={saveProfile}
              disabled={!form.name || !form.uri || saving}
              className="btn-primary"
            >
              {saving ? 'Saving…' : editId ? 'Update Profile' : 'Save Profile'}
            </button>
            {editId && (
              <button onClick={() => { setEditId(null); setForm(BLANK) }} className="btn-secondary">
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* Saved profiles */}
        {profiles.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Saved Profiles</h2>
            {profiles.map((p) => (
              <div key={p.id} className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-white text-sm truncate">{p.name}</div>
                    <div className="text-xs text-gray-500 truncate">
                      {p.uri} · {p.username} · {p.database}
                    </div>
                  </div>
                  <button
                    onClick={() => testProfile(p.id)}
                    disabled={testingId === p.id}
                    className="btn-ghost text-xs"
                  >
                    {testingId === p.id ? '…' : 'Test'}
                  </button>
                  <button onClick={() => editProfile(p)} className="btn-ghost text-xs">Edit</button>
                  <button onClick={() => deleteProfile(p.id)} className="btn-ghost text-xs text-red-400 hover:text-red-300">
                    Delete
                  </button>
                  <button
                    onClick={() => connectProfile(p)}
                    disabled={!!connectingId}
                    className="btn-primary text-xs px-4"
                  >
                    {connectingId === p.id ? 'Connecting…' : 'Connect'}
                  </button>
                </div>

                {testResult && testingId === null && (
                  <div className={`mt-3 text-xs px-3 py-2 rounded-lg ${testResult.ok ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-red-950 text-red-300 border border-red-800'}`}>
                    {testResult.ok
                      ? `OK · ${testResult.latencyMs}ms · ${testResult.nodeCount?.toLocaleString()} nodes`
                      : `Error: ${testResult.error}`}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
