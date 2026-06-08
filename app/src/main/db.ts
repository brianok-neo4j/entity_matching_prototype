import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db
  const dbPath = join(app.getPath('userData'), 'er-sessions.db')
  _db = new Database(dbPath)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  migrate(_db)
  return _db
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id              TEXT PRIMARY KEY,
      connection_id   TEXT NOT NULL,
      label           TEXT NOT NULL,
      config_json     TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'configuring',
      review_cursor   INTEGER NOT NULL DEFAULT 0,
      review_filter   TEXT NOT NULL DEFAULT '{"verdict":"all"}',
      review_sort     TEXT NOT NULL DEFAULT 'score-desc',
      merge_passes    TEXT NOT NULL DEFAULT '[]',
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pairs (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      node_a_json     TEXT NOT NULL,
      node_b_json     TEXT NOT NULL,
      verdict         TEXT NOT NULL DEFAULT 'pending',
      decided_at      INTEGER,
      note            TEXT
    );

    CREATE TABLE IF NOT EXISTS pair_scores (
      pair_id         TEXT NOT NULL REFERENCES pairs(id) ON DELETE CASCADE,
      metric_id       TEXT NOT NULL,
      field_name      TEXT NOT NULL,
      score           REAL NOT NULL,
      above_threshold INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (pair_id, metric_id, field_name)
    );

    CREATE TABLE IF NOT EXISTS audit_records (
      id                TEXT PRIMARY KEY,
      session_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      merge_pass_id     TEXT NOT NULL,
      timestamp         INTEGER NOT NULL,
      label             TEXT NOT NULL,
      survivor_id       TEXT NOT NULL,
      survivor_props    TEXT NOT NULL,
      absorbed_ids      TEXT NOT NULL,
      absorbed_props    TEXT NOT NULL,
      scores_json       TEXT NOT NULL,
      conflict_strategy TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pairs_session  ON pairs(session_id);
    CREATE INDEX IF NOT EXISTS idx_pairs_verdict  ON pairs(session_id, verdict);
    CREATE INDEX IF NOT EXISTS idx_scores_pair    ON pair_scores(pair_id);
    CREATE INDEX IF NOT EXISTS idx_audit_session  ON audit_records(session_id);
  `)
}
