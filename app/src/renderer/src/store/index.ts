import { create } from 'zustand'
import type {
  ConnectionProfile,
  SchemaModel,
  Session,
  CandidatePair,
  ScoreDistributions,
  AppSettings,
} from '../../../shared/types'

type Screen = 'connect' | 'sessions' | 'configure' | 'compute' | 'review' | 'settings'

export interface Toast {
  id: string
  message: string
  type: 'info' | 'success' | 'error'
}

interface AppStore {
  screen: Screen
  setScreen: (s: Screen) => void

  toasts: Toast[]
  addToast: (message: string, type?: Toast['type']) => void
  removeToast: (id: string) => void

  connection: ConnectionProfile | null
  schema: SchemaModel | null
  setConnection: (c: ConnectionProfile | null) => void
  setSchema: (s: SchemaModel | null) => void

  session: Session | null
  setSession: (s: Session | null) => void

  pairs: CandidatePair[]
  setPairs: (p: CandidatePair[]) => void
  updatePairVerdict: (pairId: string, verdict: CandidatePair['verdict']) => void

  distributions: ScoreDistributions | null
  setDistributions: (d: ScoreDistributions | null) => void

  currentPairIndex: number
  setCurrentPairIndex: (i: number) => void

  assistantOpen: boolean
  setAssistantOpen: (v: boolean) => void

  settings: AppSettings | null
  setSettings: (s: AppSettings) => void
}

export const useStore = create<AppStore>((set) => ({
  screen: 'connect',
  setScreen: (screen) => set({ screen }),

  toasts: [],
  addToast: (message, type = 'info') => {
    const id = Math.random().toString(36).slice(2)
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4500)
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  connection: null,
  schema: null,
  setConnection: (connection) => set({ connection }),
  setSchema: (schema) => set({ schema }),

  session: null,
  setSession: (session) => set({ session }),

  pairs: [],
  setPairs: (pairs) => set({ pairs }),
  updatePairVerdict: (pairId, verdict) =>
    set((s) => ({
      pairs: s.pairs.map((p) =>
        p.id === pairId ? { ...p, verdict, decidedAt: new Date().toISOString() } : p
      ),
    })),

  distributions: null,
  setDistributions: (distributions) => set({ distributions }),

  currentPairIndex: 0,
  setCurrentPairIndex: (currentPairIndex) => set({ currentPairIndex }),

  assistantOpen: true,
  setAssistantOpen: (assistantOpen) => set({ assistantOpen }),

  settings: null,
  setSettings: (settings) => set({ settings }),
}))
