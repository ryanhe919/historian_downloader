-- Historian Downloader sidecar — initial schema.
-- See docs/architecture.md §8.3.

CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER,
  username TEXT,
  password_enc TEXT,
  timeout_s INTEGER DEFAULT 15,
  tls INTEGER DEFAULT 0,
  windows_auth INTEGER DEFAULT 0,
  extra_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  name TEXT NOT NULL,
  tag_ids_json TEXT NOT NULL,
  range_start TEXT NOT NULL,
  range_end TEXT NOT NULL,
  sampling TEXT NOT NULL,
  segment_days INTEGER NOT NULL,
  format TEXT NOT NULL,
  output_dir TEXT NOT NULL,
  output_path TEXT,
  status TEXT NOT NULL,
  total_segments INTEGER NOT NULL,
  done_segments INTEGER NOT NULL DEFAULT 0,
  progress INTEGER NOT NULL DEFAULT 0,
  checkpoint TEXT,
  size_bytes INTEGER DEFAULT 0,
  speed_bps INTEGER DEFAULT 0,
  error TEXT,
  options_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS history (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  server_id TEXT,
  tag_count INTEGER,
  rows INTEGER,
  size_bytes INTEGER,
  range_start TEXT,
  range_end TEXT,
  format TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at DESC);

INSERT OR IGNORE INTO settings(key, value) VALUES ('schema_version', '1');
