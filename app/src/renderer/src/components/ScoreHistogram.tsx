interface Props {
  p50: number
  p75: number
  p90: number
  p95: number
  max: number
  threshold: number
  onThresholdChange?: (v: number) => void
}

// Estimate fraction of pairs above the given threshold using percentile interpolation
function fractionAbove(t: number, p50: number, p75: number, p90: number, p95: number, max: number): number {
  if (t <= 0) return 1
  if (t > max) return 0
  const pts: [number, number][] = [
    [0, 0], [p50, 0.5], [p75, 0.75], [p90, 0.9], [p95, 0.95], [max, 1.0],
  ]
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[i + 1]
    if (t >= x0 && t <= x1) {
      const frac = x1 === x0 ? y1 : y0 + ((t - x0) / (x1 - x0)) * (y1 - y0)
      return Math.max(0, 1 - frac)
    }
  }
  return 0
}

export default function ScoreHistogram({ p50, p75, p90, p95, max, threshold, onThresholdChange }: Props) {
  const W = 260
  const H = 28
  const toX = (s: number) => Math.round(Math.min(s, 1) * W)

  const above = fractionAbove(threshold, p50, p75, p90, p95, max)
  const tX = toX(Math.min(Math.max(threshold, 0), 1))

  // Percentile tick marks to label
  const ticks = [
    { v: p50, label: 'p50' },
    { v: p75, label: 'p75' },
    { v: p90, label: 'p90' },
    { v: p95, label: 'p95' },
  ]

  return (
    <div className="space-y-1">
      <svg width={W} height={H} className="block overflow-visible cursor-crosshair"
        onClick={onThresholdChange ? (e) => {
          const rect = (e.currentTarget as SVGElement).getBoundingClientRect()
          const x = e.clientX - rect.left
          onThresholdChange(Math.max(0, Math.min(1, x / W)))
        } : undefined}
      >
        {/* Background track */}
        <rect x={0} y={8} width={W} height={H - 16} rx={3} fill="#1f2937" />

        {/* Percentile bands — darker = lower score range */}
        <rect x={0}         y={8} width={toX(p50)}           height={H-16} fill="#374151" rx={3} />
        <rect x={toX(p50)}  y={8} width={toX(p75)-toX(p50)}  height={H-16} fill="#4b5563" />
        <rect x={toX(p75)}  y={8} width={toX(p90)-toX(p75)}  height={H-16} fill="#6b7280" />
        <rect x={toX(p90)}  y={8} width={toX(p95)-toX(p90)}  height={H-16} fill="#9ca3af" />
        <rect x={toX(p95)}  y={8} width={toX(max)-toX(p95)}  height={H-16} fill="#d1d5db" />

        {/* Threshold marker */}
        <line x1={tX} y1={2} x2={tX} y2={H-2} stroke="#f87171" strokeWidth={2} strokeDasharray="3,2" />
        <polygon points={`${tX},${H} ${tX-4},${H+6} ${tX+4},${H+6}`} fill="#f87171" />

        {/* Percentile tick labels */}
        {ticks.map(({ v, label }) => (
          <text key={label} x={toX(v)} y={5} textAnchor="middle" fontSize={7} fill="#6b7280">
            {label}
          </text>
        ))}
      </svg>

      {/* Legend row */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-600">0</span>
        <span className={`font-medium ${above > 0.1 ? 'text-emerald-400' : above > 0 ? 'text-amber-400' : 'text-gray-500'}`}>
          ≈{(above * 100).toFixed(0)}% above threshold
        </span>
        <span className="text-gray-600">1</span>
      </div>

      {onThresholdChange && (
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={threshold}
          onChange={(e) => onThresholdChange(parseFloat(e.target.value))}
          className="w-full accent-red-400"
        />
      )}
    </div>
  )
}
