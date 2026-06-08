# CLAUDE.md — Entity Matching Prototype

Guidance for working in this repo. Read before making changes.

## Project overview

An Electron desktop app for deduplicating entity nodes in Neo4j knowledge graphs (built for graphs created with neo4j-graphrag-python). Stack: Electron 30+, electron-vite, React 18, TypeScript, Tailwind CSS, Zustand, better-sqlite3, Anthropic SDK, ONNX Runtime (via @huggingface/transformers).

All app code lives under `app/`. The repo root holds only `LICENSE`, `README.md`, `.gitignore`, and this file.

## Architecture

```
app/src/
  main/         Electron main process — all Node.js/native code lives here
  preload/      contextBridge only — exposes typed window.api to renderer
  renderer/     React UI (screens/, components/, store/, lib/)
  shared/       Types and IPC channel constants shared across all three layers
```

### IPC conventions

- All channel names are declared in `app/src/shared/ipc-channels.ts` as the `IPC` const — never use raw strings.
- `ipcRenderer.invoke` / `ipcMain.handle` for request-response.
- Push events (progress, streaming) use `event.sender.send()` from main; the preload wraps these with `ipcRenderer.on` and returns an unsubscribe function.
- The preload is a separate Vite bundle — after editing it, a full dev-server restart is required (hot reload does not pick up preload changes).

### State management

Single Zustand store at `app/src/renderer/src/store/index.ts`. Screen navigation is driven by the `screen` field. No React Router.

### Adding a metric

1. Create `app/src/main/metrics/my-metric.ts` implementing `MetricModule` from `app/src/main/metrics/types.ts`.
2. Register it in `app/src/main/metrics/registry.ts`.
3. Add its UI definition to `app/src/renderer/src/lib/metrics.ts`.

## Key constraints and gotchas

**React 18 StrictMode double-mount** — effects run twice in development. Any one-shot IPC listener or API call must be guarded with a `startedRef`:
```tsx
const startedRef = useRef(false)
useEffect(() => {
  if (startedRef.current) return
  startedRef.current = true
  // start the job
}, [])
```

**Sibling `key` props** — if two sibling components both derive their key from the same id (e.g. `NodeRelationships` and `SourcePassages` for the same node), they will silently share state. Always use a type prefix: `key={\`rel-${node.id}\`}` and `key={\`src-${node.id}\`}`.

**ONNX Runtime batch size** — the BGE semantic cosine pipeline crashes (`EXC_BREAKPOINT` in `AllocateMLValueTensorSelfOwnBufferHelper`) if given too many inputs at once. Hard limit: `BGE_BATCH_SIZE = 16`. The pipeline is cached as a module-level singleton (`bgeExtractor`) — do not re-instantiate per call. Input strings are truncated to 2000 chars before encoding.

**Neo4j Integer handling** — the Neo4j driver v6 returns `neo4j.Integer` for integer fields; these are not JS numbers. Use the `sanitize()` helper in `app/src/main/neo4j-int.ts` to convert before serialising to the renderer.

**Cancellable async loops** — use a module-level flag (`autoClassifyCancelled`) checked at the top of each loop iteration. Do not try to cancel mid-API-call; let the in-flight request finish, then stop. Return `{ classified, cancelled }` so the renderer can show a partial-result banner.

**Re-run compute** — detected via `session.status === 'reviewing' | 'merges-applied'` in ConfigureScreen. Uses `session.save` instead of `session.create`. The `upsertPairs` SQL uses `ON CONFLICT(id) DO UPDATE SET` but intentionally does **not** overwrite `verdict`, `decided_at`, or `note` — existing verdicts are preserved across recomputes.

**Session status** — the status field must be set explicitly when saving. `ComputeScreen.proceed()` must include `status: 'reviewing'` in the object passed to `session.save`; omitting it silently resets status to the previous value.

**Settings loading** — `App.tsx` loads settings on mount via `window.api.settings.get().then(setSettings)`. The `.then()` call must not be dropped; if it is, `store.settings` stays `null` and any feature gated on `settings.anthropicKey` will be permanently disabled.

## Conventions

- No comments unless the *why* is non-obvious. No docstrings.
- Tailwind only — no CSS modules or inline styles.
- All shared TypeScript types in `app/src/shared/types.ts`.
- SQLite access is synchronous (better-sqlite3); keep DB calls in main process only.
- Passwords stored in OS keychain via keytar, never in SQLite or plaintext.
- Planning documents (`*_SPEC.md`, `TASKS.md`) are gitignored at the repo root.
