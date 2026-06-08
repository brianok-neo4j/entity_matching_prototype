import type { Toast as ToastType } from '../store'

interface Props {
  toast: ToastType
  onClose: () => void
}

const colors = {
  info: 'bg-gray-800 border-gray-700 text-gray-200',
  success: 'bg-emerald-900 border-emerald-700 text-emerald-200',
  error: 'bg-red-900 border-red-700 text-red-200',
}

export default function Toast({ toast, onClose }: Props) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg text-sm max-w-sm ${colors[toast.type]}`}
    >
      <span className="flex-1">{toast.message}</span>
      <button onClick={onClose} className="opacity-60 hover:opacity-100 text-lg leading-none">
        ×
      </button>
    </div>
  )
}
