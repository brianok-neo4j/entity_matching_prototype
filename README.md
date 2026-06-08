# Entity Resolution Tool for Neo4j

A desktop application for deduplicating entity nodes in Neo4j knowledge graphs, purpose-built for graphs created with [neo4j-graphrag-python](https://github.com/neo4j/neo4j-graphrag-python).

Built with Electron, React, TypeScript, and Tailwind CSS.

---

## What it does

The tool guides you through a four-step workflow:

1. **Connect** — Save a Bolt connection profile (credentials stored in the OS keychain via keytar, never in plaintext). Test connectivity and discover the graph schema automatically.
2. **Configure** — Select an entity label, choose which properties to compare, assign similarity metrics with per-metric thresholds, and set a surfacing rule that controls which pairs enter the review queue. If an Anthropic API key is set, the **✦ Ask AI to suggest** button will recommend fields, metrics, and thresholds based on the property names and sample values, with a per-field explanation of the reasoning.
3. **Compute** — Run pairwise similarity scoring across all nodes. Progress is streamed per metric. After completion, interactive score-distribution histograms let you adjust thresholds before proceeding.
4. **Review** — Work through the pair queue, mark each as **Duplicate** or **Distinct**, add notes, inspect relationships and source passages, and apply merges when ready. The **✦ AI Classify…** button sends all pending pairs to Claude for automated Duplicate/Distinct recommendations with reasoning stored in the Notes field (cancelable mid-run). After applying merges, choose to return to the Session list or stay in review. Use **Re-run Compute →** to run a second scoring pass on the same session (e.g. to surface transitive duplicates after merging) — existing verdicts are preserved.

Sessions are persisted in SQLite. Verdicts are preserved across recomputes — only scores and node snapshots are refreshed.

---

## Similarity metrics

| Metric | Best for | Configurable params |
|---|---|---|
| Exact Match | Identifiers, codes | — |
| Edit Distance (Levenshtein ratio) | Short names, IDs | Min string length |
| Jaro-Winkler | Person/place names | Prefix weight |
| Token Jaccard | Multi-word names, text | Tokenization mode |
| Token Sort Ratio | Names with word reordering | Tokenization mode |
| Phonetic (Double Metaphone) | Names with spelling variants | — |
| Numeric Proximity | Year, age, quantity fields | — |
| Semantic Cosine | Long text, descriptions | Backend: BGE (in-process), OpenAI API, or neo4j-stored vector |

Candidate pairs are generated with a **token-bucket** approach (O(n × tokens), not O(n²)), so the tool stays fast even on large label sets.

---

## Surfacing rules

Controls which scored pairs enter the review queue:

- **Any field** — surface if any field score meets its threshold
- **All fields** — surface only if every field score meets its threshold
- **Weighted average** — surface if the weighted sum of field scores meets a combined threshold

The pair count estimate on the Configure screen shows the approximate queue size before you commit to running compute.

---

## Review keyboard shortcuts

| Key | Action |
|---|---|
| `D` | Mark as Duplicate |
| `X` | Mark as Distinct |
| `J` / `→` | Next pair |
| `K` / `←` | Previous pair |
| `N` | Open note editor |
| `?` | Toggle shortcut overlay |
| `Esc` | Close overlays |

---

## Merging duplicates

The merge step uses **union-find** to group transitively connected duplicates into merge groups. Pairs you marked as Distinct are not merged even if they are in the same group transitively — only directly confirmed duplicates are joined.

For each group, the survivor node is chosen by highest degree (most relationships). Two merge paths are available:

- **APOC path** — a single `apoc.refactor.mergeNodes` call per group (recommended; requires APOC installed)
- **Fallback path** — a manual Cypher transaction that collects all relationships, re-creates them on the survivor, then `DETACH DELETE`s absorbed nodes (no APOC dependency)

Property conflict strategy is selectable per merge pass: **discard** (keep survivor), **overwrite** (absorbed overwrites), or **combine** (merge arrays, APOC only).

Every merge pass writes an audit record to SQLite (and optionally to the graph as `ERAuditRecord` nodes).

---

## GraphRAG integration

The tool assumes the graph was built with neo4j-graphrag-python and understands its conventions:

- `__Entity__`, `__KGBuilder__`, `Document`, and `Chunk` labels are hidden from the label selector by default (configurable in Settings)
- Source passages are fetched via `(:Entity)-[:FROM_CHUNK]->(:Chunk)` and displayed inline in the review panel
- When **Neo4j storage** is enabled, reviewed pairs are written back as `(:ERPair)-[:INVOLVES]->(:Entity)` nodes, making deduplication decisions queryable from within the graph

---

## Setup

### Prerequisites

- Node.js 18+
- A running Neo4j instance (5.x recommended)
- APOC plugin (optional, enables the faster merge path and combine property strategy)

### Install

```bash
cd app && npm install
```

### Development

```bash
cd app && npm run dev
```

### Build

```bash
# macOS
cd app && npm run build:mac

# Windows
cd app && npm run build:win

# Linux
cd app && npm run build:linux
```

---

## Settings

Open **Settings** from the top nav bar.

| Setting | Description |
|---|---|
| Anthropic API Key | Powers three features: the assistant panel (chatbot), **AI Auto-classify** (bulk pair verdicts), and **AI field/metric suggestion** on the Configure screen. |
| OpenAI API Key | Required only when using the OpenAI semantic-cosine backend. |
| Assistant Model | Defaults to `claude-haiku-4-5-20251001`. Can be upgraded to Sonnet or Opus. |
| Hidden Labels | Labels excluded from schema discovery. Defaults to GraphRAG infrastructure labels. |
| Neo4j Storage | Write pair verdicts and merge audit records back into the graph as first-class nodes. |

---

## Data storage

| What | Where |
|---|---|
| Sessions, pairs, scores, audit records | `~/Library/Application Support/er-tool/er-sessions.db` (macOS) |
| Connection passwords | OS keychain via keytar |
| All other settings | Same SQLite database |

Sessions can be exported at any point from the review panel as CSV or JSON, filtered by verdict.

---

## Architecture

```
src/
  main/              Electron main process
    connection-service.ts   Neo4j driver, profile CRUD, keytar
    schema-service.ts       Schema discovery, PropertyKind inference
    session-service.ts      Session and pair CRUD, verdict upsert
    metric-runner.ts        Orchestrates metrics, surfacing, distributions
    merge-executor.ts       Union-find, APOC/fallback merge, audit
    assistant-service.ts    Anthropic SDK streaming
    neo4j-storage.ts        Optional graph write-back
    metrics/                Eight pluggable MetricModule implementations
  preload/           Typed contextBridge (window.api)
  renderer/          React UI
    screens/          ConnectScreen, SessionListScreen, ConfigureScreen,
                      ComputeScreen, ReviewScreen, SettingsScreen
    components/       AssistantPanel, ScoreHistogram, NodeRelationships,
                      SourcePassages, Toast
    store/            Zustand global state
    lib/metrics.ts    Metric definitions for the UI
  shared/
    types.ts          All shared TypeScript types
    ipc-channels.ts   Typed IPC channel constants
```

### Adding a new metric

1. Create `src/main/metrics/my-metric.ts` implementing the `MetricModule` interface from `src/main/metrics/types.ts`
2. Register it in `src/main/metrics/registry.ts`
3. Add its UI definition to `src/renderer/src/lib/metrics.ts` (display name, description, applicable PropertyKinds, default params)
