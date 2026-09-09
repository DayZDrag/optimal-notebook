-- Vault mirror v1: only user Markdown is uploaded by the desktop agent.
-- Current files are queryable; all prior uploaded versions stay available.
CREATE TABLE IF NOT EXISTS vault_files (
  path TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  content TEXT NOT NULL,
  size INTEGER NOT NULL,
  modified_at TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS vault_file_versions (
  path TEXT NOT NULL,
  version INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  content TEXT NOT NULL,
  size INTEGER NOT NULL,
  modified_at TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  PRIMARY KEY(path, version)
);
