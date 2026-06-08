import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { IPC } from '../shared/ipc-channels'
import * as connection from './connection-service'
import * as schema from './schema-service'
import * as sessions from './session-service'
import * as mergeExec from './merge-executor'
import * as assistant from './assistant-service'
import { runMetrics } from './metric-runner'
import { getSettings, setSettings } from './settings-service'
import { getDb } from './db'
import { estimatePairCount } from './candidate-generator'
import * as neo4jStorage from './neo4j-storage'
import { toJsNumber } from './neo4j-int'
import type { Session, Verdict, CandidatePair, AISuggestion } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let computeAbort: AbortController | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => mainWindow!.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.neo4j.er-tool')
  app.on('browser-window-created', (_, win) => optimizer.watchWindowShortcuts(win))
  registerIpc()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

function buildClassificationPrompt(pair: CandidatePair): string {
  const fmt = (props: Record<string, unknown>) =>
    Object.entries(props).map(([k, v]) => `  ${k}: ${String(v)}`).join('\n') || '  (no properties)'
  const scores = pair.scores
    .map((s) => `  ${s.fieldName} · ${s.metricId}: ${s.score.toFixed(3)}${s.aboveThreshold ? ' ✓' : ''}`)
    .join('\n')
  return `Classify whether these two "${pair.label}" entities are the same real-world entity or distinct entities.

Entity A:
${fmt(pair.nodeA.properties)}

Entity B:
${fmt(pair.nodeB.properties)}

Similarity scores:
${scores}

Respond with EXACTLY these two lines and nothing else:
VERDICT: DUPLICATE
REASON: One concise sentence explaining the key evidence.

Replace DUPLICATE with DISTINCT if they are different entities.`
}

// ── IPC Registration ──────────────────────────────────────────────────────────

function registerIpc() {
  // Connection
  ipcMain.handle(IPC.CONNECTION_SAVE, (_, p) => connection.saveProfile(p))
  ipcMain.handle(IPC.CONNECTION_LIST, () => connection.listProfiles())
  ipcMain.handle(IPC.CONNECTION_DELETE, (_, id: string) => connection.deleteProfile(id))
  ipcMain.handle(IPC.CONNECTION_TEST, (_, id: string) => connection.testConnection(id))
  ipcMain.handle(IPC.CONNECTION_CONNECT, async (_, id: string) => {
    await connection.connect(id)
    return schema.discoverSchema()
  })
  ipcMain.handle(IPC.CONNECTION_DISCONNECT, () => connection.disconnect())

  // Schema
  ipcMain.handle(IPC.SCHEMA_DISCOVER, () => schema.discoverSchema())
  ipcMain.handle(IPC.SCHEMA_ESTIMATE_PAIRS, async (_, sessionId: string) => {
    const session = sessions.loadSession(sessionId)
    if (!session) return 0
    const driver = connection.getDriver()
    const neo4jSession = driver.session()
    try {
      let total = 0
      for (const field of session.fields) {
        const result = await neo4jSession.run(
          `MATCH (n:\`${session.label}\`) WHERE n.\`${field.propertyName}\` IS NOT NULL RETURN n.\`${field.propertyName}\` AS val`
        )
        const nodes = result.records.map((r, i) => ({ id: String(i), value: String(r.get('val')) }))
        total = Math.max(total, estimatePairCount(nodes))
      }
      return total
    } finally {
      await neo4jSession.close()
    }
  })

  // Sessions
  ipcMain.handle(IPC.SESSION_LIST, () => sessions.listSessions())
  ipcMain.handle(IPC.SESSION_CREATE, (_, partial: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>) =>
    sessions.createSession(partial)
  )
  ipcMain.handle(IPC.SESSION_LOAD, (_, id: string) => sessions.loadSession(id))
  ipcMain.handle(IPC.SESSION_SAVE, (_, session: Session) => sessions.saveSession(session))
  ipcMain.handle(IPC.SESSION_DELETE, (_, id: string) => sessions.deleteSession(id))

  // Compute
  ipcMain.handle(IPC.COMPUTE_START, async (event, sessionId: string) => {
    computeAbort?.abort()
    computeAbort = new AbortController()
    const session = sessions.loadSession(sessionId)
    if (!session) throw new Error('Session not found')
    sessions.saveSession({ ...session, status: 'computing' })

    try {
      const distributions = await runMetrics(
        session,
        (progress) => event.sender.send(IPC.COMPUTE_PROGRESS, progress),
        computeAbort.signal
      )
      sessions.saveSession({ ...sessions.loadSession(sessionId)!, status: 'reviewing' })
      event.sender.send(IPC.COMPUTE_DONE, distributions)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') throw err
    }
  })
  ipcMain.handle(IPC.COMPUTE_CANCEL, () => { computeAbort?.abort() })

  // Pairs
  ipcMain.handle(IPC.PAIRS_LIST, (_, sessionId: string) => sessions.listPairs(sessionId))
  ipcMain.handle(IPC.PAIRS_SET_VERDICT, async (_, pairId: string, verdict: Verdict) => {
    sessions.setVerdict(pairId, verdict)
    // Best-effort Neo4j write — never blocks or fails the verdict
    const pair = sessions.getPair(pairId)
    if (pair) neo4jStorage.writePairVerdict({ ...pair, verdict }).catch(() => {})
  })
  ipcMain.handle(IPC.PAIRS_SET_NOTE, (_, pairId: string, note: string) =>
    sessions.setNote(pairId, note)
  )
  ipcMain.handle(IPC.PAIRS_EXPORT, async (_, sessionId: string, format: 'csv' | 'json', verdictFilter: string) => {
    const pairs = sessions.listPairs(sessionId)
    const filtered = verdictFilter === 'all' ? pairs : pairs.filter((p) => p.verdict === verdictFilter)
    if (format === 'json') return JSON.stringify(filtered, null, 2)
    // CSV
    const allMetricKeys = [...new Set(filtered.flatMap((p) => p.scores.map((s) => `${s.metricId}_${s.fieldName}`)))]
    const header = ['pair_id', 'node_a_id', 'node_a_display', 'node_b_id', 'node_b_display', 'verdict', 'decided_at', 'note', ...allMetricKeys]
    const displayVal = (props: Record<string, unknown>) =>
      String(props.name ?? props.title ?? props.heading ?? props.summary ?? props.text ?? '')
    const rows = filtered.map((p) => {
      const scoreMap = Object.fromEntries(p.scores.map((s) => [`${s.metricId}_${s.fieldName}`, s.score]))
      return [
        p.id, p.nodeA.id, displayVal(p.nodeA.properties),
        p.nodeB.id, displayVal(p.nodeB.properties),
        p.verdict, p.decidedAt ?? '', p.note ?? '',
        ...allMetricKeys.map((k) => scoreMap[k] ?? ''),
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')
    })
    return [header.join(','), ...rows].join('\n')
  })

  // Merge
  ipcMain.handle(IPC.MERGE_DRY_RUN, (_, sessionId: string) =>
    mergeExec.buildMergeGroups(sessionId)
  )
  ipcMain.handle(IPC.MERGE_APPLY, async (_, sessionId: string, strategy: 'discard' | 'overwrite' | 'combine') => {
    const schemaModel = schema.getCachedSchema()
    const result = await mergeExec.applyMerges(sessionId, strategy, schemaModel?.apocAvailable ?? false)
    const session = sessions.loadSession(sessionId)!
    sessions.saveSession({
      ...session,
      status: 'merges-applied',
      mergePasses: [...session.mergePasses, {
        id: result.passId,
        appliedAt: new Date().toISOString(),
        groupsApplied: result.groupsApplied,
        groupsSkipped: result.groupsSkipped,
        groupsFailed: result.groupsFailed,
      }],
    })
    return result
  })

  // Audit
  ipcMain.handle(IPC.AUDIT_LIST, (_, sessionId: string) => {
    const rows = getDb()
      .prepare('SELECT * FROM audit_records WHERE session_id = ? ORDER BY timestamp DESC')
      .all(sessionId) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      mergePassId: r.merge_pass_id,
      timestamp: new Date(r.timestamp as number).toISOString(),
      label: r.label,
      survivorId: r.survivor_id,
      survivorProperties: JSON.parse(r.survivor_props as string),
      absorbedIds: JSON.parse(r.absorbed_ids as string),
      absorbedProperties: JSON.parse(r.absorbed_props as string),
      scores: JSON.parse(r.scores_json as string),
      conflictStrategy: r.conflict_strategy,
    }))
  })

  // Assistant
  ipcMain.handle(IPC.ASSISTANT_SEND, async (event, sessionId: string, pairId: string | null, message: string) => {
    await assistant.sendMessage(
      sessionId, pairId, message,
      (chunk) => event.sender.send(IPC.ASSISTANT_CHUNK, chunk),
      () => event.sender.send(IPC.ASSISTANT_DONE)
    )
  })

  // Node detail
  ipcMain.handle(IPC.NODE_NEIGHBORS, async (_, nodeId: string) => {
    const driver = connection.getDriver()
    const neo4jSession = driver.session()
    try {
      const result = await neo4jSession.run(
        `MATCH (n) WHERE elementId(n) = $id
         OPTIONAL MATCH (n)-[r]->(target)
         WITH type(r) AS relType, 'out' AS dir,
              coalesce(target.name, target.title, target.text, elementId(target)) AS targetText,
              elementId(target) AS targetId
         WHERE relType IS NOT NULL
         RETURN relType, dir, targetId, targetText
         UNION ALL
         MATCH (n) WHERE elementId(n) = $id
         OPTIONAL MATCH (source)-[r]->(n)
         WITH type(r) AS relType, 'in' AS dir,
              coalesce(source.name, source.title, source.text, elementId(source)) AS targetText,
              elementId(source) AS targetId
         WHERE relType IS NOT NULL
         RETURN relType, dir, targetId, targetText`,
        { id: nodeId }
      )
      return result.records.map((r) => ({
        relType: r.get('relType') as string,
        direction: r.get('dir') as 'in' | 'out',
        targetId: r.get('targetId') as string,
        targetText: r.get('targetText') as string,
      }))
    } finally {
      await neo4jSession.close()
    }
  })

  ipcMain.handle(IPC.NODE_SOURCE_PASSAGES, async (_, nodeId: string) => {
    const driver = connection.getDriver()
    const neo4jSession = driver.session()
    try {
      const result = await neo4jSession.run(
        `MATCH (n) WHERE elementId(n) = $id
         OPTIONAL MATCH (n)-[:FROM_CHUNK]->(chunk:Chunk)
         WHERE chunk.text IS NOT NULL
         RETURN chunk.text AS text, coalesce(chunk.index, 0) AS chunkIndex
         ORDER BY chunkIndex`,
        { id: nodeId }
      )
      return result.records.map((r) => ({
        chunkIndex: toJsNumber(r.get('chunkIndex') ?? 0),
        text: r.get('text') as string,
      }))
    } finally {
      await neo4jSession.close()
    }
  })

  // AI auto-classify
  let autoClassifyCancelled = false

  ipcMain.handle(IPC.PAIRS_AUTO_CLASSIFY_CANCEL, () => { autoClassifyCancelled = true })

  ipcMain.handle(IPC.PAIRS_AUTO_CLASSIFY, async (event, sessionId: string) => {
    const { anthropicApiKey, assistantModel } = getSettings()
    if (!anthropicApiKey) throw new Error('Anthropic API key not set. Add it in Settings.')

    autoClassifyCancelled = false

    const pending = sessions.listPairs(sessionId).filter((p) => p.verdict === 'pending')
    const total = pending.length

    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey: anthropicApiKey })
    const model = assistantModel || 'claude-haiku-4-5-20251001'

    let classified = 0
    for (const pair of pending) {
      // Check cancel flag before starting each new API call
      if (autoClassifyCancelled) break

      let verdict: 'duplicate' | 'distinct' | null = null
      let note: string | null = null
      try {
        const msg = await client.messages.create({
          model,
          max_tokens: 150,
          messages: [{ role: 'user', content: buildClassificationPrompt(pair) }],
        })
        const text = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
        const lines = text.split('\n')
        const vLine = lines.find((l) => l.startsWith('VERDICT:'))?.replace('VERDICT:', '').trim().toLowerCase()
        const reason = lines.find((l) => l.startsWith('REASON:'))?.replace('REASON:', '').trim() ?? ''
        if (vLine === 'duplicate' || vLine === 'distinct') {
          verdict = vLine
          note = `[AI] ${reason}`
          sessions.setVerdict(pair.id, verdict)
          sessions.setNote(pair.id, note)
          classified++
        }
      } catch { /* skip pair on API error */ }

      event.sender.send(IPC.PAIRS_AUTO_CLASSIFY_PROGRESS, { pairId: pair.id, verdict, note, completed: classified, total })
    }

    return { classified, cancelled: autoClassifyCancelled }
  })

  // Settings
  ipcMain.handle(IPC.SETTINGS_GET, () => getSettings())
  ipcMain.handle(IPC.SETTINGS_SET, (_, partial) => setSettings(partial))

  // AI configuration suggestion
  ipcMain.handle(IPC.CONFIGURE_SUGGEST, async (_, labelName: string, properties: { name: string; kind: string; sampleValues: string[] }[]): Promise<AISuggestion> => {
    const { anthropicApiKey, assistantModel } = getSettings()
    if (!anthropicApiKey) throw new Error('Anthropic API key not set. Add it in Settings.')

    const propLines = properties
      .map((p) => `  - ${p.name} (kind: ${p.kind}${p.sampleValues.length ? `; e.g. ${p.sampleValues.slice(0, 3).join(', ')}` : ''})`)
      .join('\n')

    const prompt = `You are configuring an entity deduplication system for a Neo4j knowledge graph.

The goal is to find duplicate "${labelName}" nodes. Here are the available properties:
${propLines}

Available metrics (id · description · applicable kinds · default threshold):
  - exact-match · Normalized exact string equality · name, identifier, text · 1.0
  - edit-distance · Levenshtein ratio · name, identifier, text · 0.85
  - jaro-winkler · Jaro-Winkler similarity, best for short names · name, identifier · 0.88
  - token-jaccard · Token set Jaccard, order-insensitive · name, text · 0.5
  - token-sort-ratio · Sort tokens then LCS ratio, handles reordered names · name, text · 0.85
  - phonetic · Double Metaphone sounds-alike · name · 1.0
  - numeric-proximity · Fractional closeness for numbers · numeric · 0.95
  - semantic-cosine · Sentence embedding cosine similarity · name, text · 0.92

Rules:
- Only suggest metrics that match the property's kind (e.g. do not suggest jaro-winkler for a "text" kind property).
- Prefer 2-3 complementary metrics per field rather than using all available ones.
- Disable fields that are administrative (IDs, timestamps, internal keys) or too sparse to be useful.
- Threshold adjustments: lower thresholds surface more pairs (higher recall), higher thresholds are more precise. Suggest adjustments only when the default is clearly wrong for the data.

Respond with ONLY valid JSON, no markdown fences, no extra text:
{
  "explanation": "2-3 sentence summary of the overall deduplication strategy",
  "fields": [
    {
      "propertyName": "...",
      "enabled": true,
      "metrics": [{ "metricId": "...", "threshold": 0.85 }],
      "reason": "One sentence explaining why this field and these metrics were chosen"
    }
  ]
}`

    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey: anthropicApiKey })
    const msg = await client.messages.create({
      model: assistantModel || 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : ''
    // Strip optional markdown code fences
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    return JSON.parse(jsonText) as AISuggestion
  })
}
