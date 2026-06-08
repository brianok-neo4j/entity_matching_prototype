import { useState } from 'react'

interface Neighbor {
  relType: string
  direction: 'in' | 'out'
  targetId: string
  targetText: string
}

interface Props {
  nodeId: string
  label?: string
}

export default function NodeRelationships({ nodeId, label }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [neighbors, setNeighbors] = useState<Neighbor[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    if (neighbors !== null) { setOpen(true); return }
    setOpen(true)
    setLoading(true)
    setError(null)
    try {
      const data = await window.api.node.neighbors(nodeId)
      setNeighbors(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // Group by relType
  const grouped = neighbors
    ? neighbors.reduce<Record<string, Neighbor[]>>((acc, n) => {
        if (!acc[n.relType]) acc[n.relType] = []
        acc[n.relType].push(n)
        return acc
      }, {})
    : {}

  return (
    <div className="border-t border-gray-800">
      <button
        onClick={open ? () => setOpen(false) : load}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-800/40 transition-colors"
      >
        <span className="font-medium">Relationships{label ? ` · ${label}` : ''}</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-3">
          {loading && <p className="text-xs text-gray-500">Loading…</p>}
          {error && <p className="text-xs text-red-400">{error}</p>}
          {neighbors && neighbors.length === 0 && (
            <p className="text-xs text-gray-600">No relationships found.</p>
          )}
          {neighbors && neighbors.length > 0 && (
            <div className="space-y-2">
              {Object.entries(grouped).map(([relType, items]) => (
                <div key={relType}>
                  <div className="text-xs font-mono text-gray-500 mb-1">:{relType}</div>
                  <div className="space-y-1 pl-2">
                    {items.map((n, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-gray-400">
                        <span className={`font-mono text-gray-600 ${n.direction === 'out' ? 'text-emerald-700' : 'text-amber-700'}`}>
                          {n.direction === 'out' ? '→' : '←'}
                        </span>
                        <span className="truncate" title={n.targetId}>
                          {n.targetText || n.targetId.slice(-12)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
