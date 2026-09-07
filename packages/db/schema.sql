PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
INSERT OR IGNORE INTO schema_migrations VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('client','desktop')),
  token_hash TEXT UNIQUE, revoked INTEGER NOT NULL DEFAULT 0, last_seen_at TEXT, cursor INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id), expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS raw_notes (
  id TEXT PRIMARY KEY, device_id TEXT NOT NULL, text TEXT NOT NULL, content_type TEXT NOT NULL,
  client_created_at TEXT NOT NULL, server_received_at TEXT NOT NULL, source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SERVER_RECEIVED', vault_path TEXT, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TRIGGER IF NOT EXISTS protect_raw_update BEFORE UPDATE OF text, device_id, content_type, client_created_at, source ON raw_notes
BEGIN SELECT RAISE(ABORT, 'RAW is immutable'); END;
CREATE TRIGGER IF NOT EXISTS protect_raw_delete BEFORE DELETE ON raw_notes
BEGIN SELECT RAISE(ABORT, 'Use explicit retention procedure; RAW cannot be deleted'); END;
CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mutation_receipts (operation_id TEXT PRIMARY KEY, request TEXT NOT NULL, response TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  operation TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS event_entity ON sync_events(entity_type, entity_id);
CREATE TRIGGER IF NOT EXISTS protect_event_update BEFORE UPDATE ON sync_events BEGIN SELECT RAISE(ABORT, 'Append-only log'); END;
CREATE TRIGGER IF NOT EXISTS protect_event_delete BEFORE DELETE ON sync_events BEGIN SELECT RAISE(ABORT, 'Append-only log'); END;
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY, device_id TEXT NOT NULL, operation TEXT NOT NULL, entity_id TEXT, created_at TEXT NOT NULL);
