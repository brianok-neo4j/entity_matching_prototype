import { useState } from 'react'

interface Passage {
  chunkIndex: number
  text: string
}

interface Props {
  nodeId: string
}

export default function SourcePassages({ nodeId }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [passages, setPassages] = useState<Passage[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    if (passages !== null) { setOpen(true); return }
    setOpen(true)
    setLoading(true)
    setError(null)
    try {
      const data = await window.api.node.sourcePassages(nodeId)
      setPassages(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="border-t border-gray-800">
      <button
        onClick={open ? () => setOpen(false) : load}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-800/40 transition-colors"
      >
        <span className="font-medium">Source Passages (FROM_CHUNK)</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {loading && <p className="text-xs text-gray-500">Loading…</p>}
          {error && <p className="text-xs text-red-400">{error}</p>}
          {passages && passages.length === 0 && (
            <p className="text-xs text-gray-600">No source chunks linked via FROM_CHUNK.</p>
          )}
          {passages && passages.map((p, i) => (
            <div key={i} className="bg-gray-950 rounded-lg p-3 space-y-1">
              <div className="text-xs text-gray-600 font-mono">Chunk #{p.chunkIndex}</div>
              <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap line-clamp-6">
                {p.text}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
