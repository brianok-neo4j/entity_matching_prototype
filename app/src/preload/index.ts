import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type {
  ConnectionProfile,
  TestConnectionResult,
  SchemaModel,
  Session,
  CandidatePair,
  MergeGroup,
  MergeApplyResult,
  AuditRecord,
  ScoreDistributions,
  AppSettings,
  AISuggestion,
} from '../shared/types'

// Push-event listener helpers
function on(channel: string, cb: (...args: unknown[]) => void) {
  const wrapped = (_: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...args)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api = {
  // ── Connection ──────────────────────────────────────────────────────────────
  connection: {
    save: (profile: Omit<ConnectionProfile, 'id'> & { password: string; id?: string }) =>
      ipcRenderer.invoke(IPC.CONNECTION_SAVE, profile) as Promise<ConnectionProfile>,
    list: () => ipcRenderer.invoke(IPC.CONNECTION_LIST) as Promise<ConnectionProfile[]>,
    delete: (id: string) => ipcRenderer.invoke(IPC.CONNECTION_DELETE, id) as Promise<void>,
    test: (id: string) => ipcRenderer.invoke(IPC.CONNECTION_TEST, id) as Promise<TestConnectionResult>,
    connect: (id: string) => ipcRenderer.invoke(IPC.CONNECTION_CONNECT, id) as Promise<SchemaModel>,
    disconnect: () => ipcRenderer.invoke(IPC.CONNECTION_DISCONNECT) as Promise<void>,
  },

  // ── Schema ──────────────────────────────────────────────────────────────────
  schema: {
    discover: () => ipcRenderer.invoke(IPC.SCHEMA_DISCOVER) as Promise<SchemaModel>,
    estimatePairs: (sessionId: string) =>
      ipcRenderer.invoke(IPC.SCHEMA_ESTIMATE_PAIRS, sessionId) as Promise<number>,
  },

  // ── Sessions ─────────────────────────────────────────────────────────────────
  session: {
    list: () => ipcRenderer.invoke(IPC.SESSION_LIST) as Promise<Session[]>,
    create: (partial: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>) =>
      ipcRenderer.invoke(IPC.SESSION_CREATE, partial) as Promise<Session>,
    load: (id: string) => ipcRenderer.invoke(IPC.SESSION_LOAD, id) as Promise<Session>,
    save: (session: Session) => ipcRenderer.invoke(IPC.SESSION_SAVE, session) as Promise<void>,
    delete: (id: string) => ipcRenderer.invoke(IPC.SESSION_DELETE, id) as Promise<void>,
  },

  // ── Compute ──────────────────────────────────────────────────────────────────
  compute: {
    start: (sessionId: string) => ipcRenderer.invoke(IPC.COMPUTE_START, sessionId) as Promise<void>,
    cancel: () => ipcRenderer.invoke(IPC.COMPUTE_CANCEL) as Promise<void>,
    onProgress: (cb: (data: { metricId: string; fieldName: string; pct: number; pairsAbove: number }) => void) =>
      on(IPC.COMPUTE_PROGRESS, cb as never),
    onDone: (cb: (distributions: ScoreDistributions) => void) =>
      on(IPC.COMPUTE_DONE, cb as never),
  },

  // ── Pairs ────────────────────────────────────────────────────────────────────
  pairs: {
    list: (sessionId: string) => ipcRenderer.invoke(IPC.PAIRS_LIST, sessionId) as Promise<CandidatePair[]>,
    setVerdict: (pairId: string, verdict: CandidatePair['verdict']) =>
      ipcRenderer.invoke(IPC.PAIRS_SET_VERDICT, pairId, verdict) as Promise<void>,
    setNote: (pairId: string, note: string) =>
      ipcRenderer.invoke(IPC.PAIRS_SET_NOTE, pairId, note) as Promise<void>,
    export: (sessionId: string, format: 'csv' | 'json', verdictFilter: string) =>
      ipcRenderer.invoke(IPC.PAIRS_EXPORT, sessionId, format, verdictFilter) as Promise<string>,
    autoClassify: (sessionId: string) =>
      ipcRenderer.invoke(IPC.PAIRS_AUTO_CLASSIFY, sessionId) as Promise<{ classified: number; cancelled: boolean }>,
    cancelAutoClassify: () =>
      ipcRenderer.invoke(IPC.PAIRS_AUTO_CLASSIFY_CANCEL) as Promise<void>,
    onAutoClassifyProgress: (cb: (data: {
      pairId: string
      verdict: 'duplicate' | 'distinct' | null
      note: string | null
      completed: number
      total: number
    }) => void) => on(IPC.PAIRS_AUTO_CLASSIFY_PROGRESS, cb as never),
  },

  // ── Merge ────────────────────────────────────────────────────────────────────
  merge: {
    dryRun: (sessionId: string) =>
      ipcRenderer.invoke(IPC.MERGE_DRY_RUN, sessionId) as Promise<MergeGroup[]>,
    apply: (sessionId: string, conflictStrategy: 'discard' | 'overwrite' | 'combine') =>
      ipcRenderer.invoke(IPC.MERGE_APPLY, sessionId, conflictStrategy) as Promise<MergeApplyResult>,
  },

  // ── Audit ─────────────────────────────────────────────────────────────────────
  audit: {
    list: (sessionId: string) =>
      ipcRenderer.invoke(IPC.AUDIT_LIST, sessionId) as Promise<AuditRecord[]>,
  },

  // ── Assistant ─────────────────────────────────────────────────────────────────
  assistant: {
    send: (sessionId: string, pairId: string | null, message: string) =>
      ipcRenderer.invoke(IPC.ASSISTANT_SEND, sessionId, pairId, message) as Promise<void>,
    onChunk: (cb: (chunk: string) => void) => on(IPC.ASSISTANT_CHUNK, cb as never),
    onDone: (cb: () => void) => on(IPC.ASSISTANT_DONE, cb as never),
  },

  // ── Node detail ───────────────────────────────────────────────────────────────
  node: {
    neighbors: (nodeId: string) =>
      ipcRenderer.invoke(IPC.NODE_NEIGHBORS, nodeId) as Promise<
        { relType: string; direction: 'in' | 'out'; targetId: string; targetText: string }[]
      >,
    sourcePassages: (nodeId: string) =>
      ipcRenderer.invoke(IPC.NODE_SOURCE_PASSAGES, nodeId) as Promise<
        { chunkIndex: number; text: string }[]
      >,
  },

  // ── Settings ──────────────────────────────────────────────────────────────────
  settings: {
    get: () => ipcRenderer.invoke(IPC.SETTINGS_GET) as Promise<AppSettings>,
    set: (s: Partial<AppSettings>) => ipcRenderer.invoke(IPC.SETTINGS_SET, s) as Promise<void>,
  },

  // ── AI configuration suggestion ───────────────────────────────────────────────
  configure: {
    suggest: (labelName: string, properties: { name: string; kind: string; sampleValues: string[] }[]) =>
      ipcRenderer.invoke(IPC.CONFIGURE_SUGGEST, labelName, properties) as Promise<AISuggestion>,
  },
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-ignore
  window.api = api
}

export type Api = typeof api
