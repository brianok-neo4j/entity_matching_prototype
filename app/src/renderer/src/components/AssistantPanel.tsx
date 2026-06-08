import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'

interface Message {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

interface Props {
  sessionId: string
  pairId?: string | null
  suggestedPrompts?: string[]
}

export default function AssistantPanel({ sessionId, pairId, suggestedPrompts }: Props) {
  const { assistantOpen, setAssistantOpen } = useStore()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const offChunk = window.api.assistant.onChunk((chunk) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1]
        if (last?.streaming) {
          return [...prev.slice(0, -1), { ...last, content: last.content + chunk }]
        }
        return [...prev, { role: 'assistant', content: chunk, streaming: true }]
      })
    })
    const offDone = window.api.assistant.onDone(() => {
      setMessages((prev) => {
        const last = prev[prev.length - 1]
        if (last?.streaming) return [...prev.slice(0, -1), { ...last, streaming: false }]
        return prev
      })
      setBusy(false)
    })
    return () => { offChunk(); offDone() }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send(text: string) {
    if (!text.trim() || busy) return
    const userMsg: Message = { role: 'user', content: text.trim() }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setBusy(true)
    try {
      await window.api.assistant.send(sessionId, pairId ?? null, text.trim())
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${(err as Error).message}` }])
      setBusy(false)
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  if (!assistantOpen) {
    return (
      <button
        onClick={() => setAssistantOpen(true)}
        className="w-8 flex flex-col items-center justify-start pt-4 gap-1 bg-gray-900 border-l border-gray-800 text-gray-500 hover:text-gray-300 shrink-0"
        title="Open assistant"
      >
        <span className="text-xs rotate-90 whitespace-nowrap tracking-wider">Assistant</span>
      </button>
    )
  }

  return (
    <div className="w-80 flex flex-col bg-gray-900 border-l border-gray-800 shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <span className="text-sm font-medium text-gray-300">Assistant</span>
        <button onClick={() => setAssistantOpen(false)} className="text-gray-500 hover:text-gray-300 text-lg leading-none">
          ›
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {messages.length === 0 && (
          <p className="text-xs text-gray-500 text-center mt-4">
            Ask anything about this session, metrics, or pair decisions.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`text-sm leading-relaxed ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
            <span
              className={`inline-block px-3 py-2 rounded-lg max-w-full text-left whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-emerald-800 text-emerald-100'
                  : 'bg-gray-800 text-gray-200'
              }`}
            >
              {m.content}
              {m.streaming && <span className="animate-pulse">▋</span>}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Suggested prompts */}
      {suggestedPrompts && suggestedPrompts.length > 0 && messages.length === 0 && (
        <div className="px-3 pb-2 flex flex-wrap gap-1">
          {suggestedPrompts.map((p, i) => (
            <button
              key={i}
              onClick={() => send(p)}
              className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-full border border-gray-700 truncate max-w-full"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="px-3 pb-3 pt-2 border-t border-gray-800">
        <textarea
          ref={inputRef}
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          disabled={busy}
          placeholder="Ask a question… (Enter to send)"
          className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 resize-none disabled:opacity-50"
        />
      </div>
    </div>
  )
}
