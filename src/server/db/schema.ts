export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK(role IN ('admin', 'publisher', 'reviewer')),
  created_at    INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS signing_keys (
  key_id          TEXT PRIMARY KEY,
  public_key      TEXT NOT NULL,
  private_key_enc TEXT NOT NULL,
  status          TEXT NOT NULL CHECK(status IN ('active', 'revoked')),
  not_before      INTEGER NOT NULL,
  not_after       INTEGER NOT NULL,
  created_at      INTEGER DEFAULT (unixepoch()),
  revoked_at      INTEGER
);

CREATE TABLE IF NOT EXISTS key_lists (
  list_sequence  INTEGER PRIMARY KEY,
  content        TEXT NOT NULL,
  root_signature TEXT NOT NULL,
  published_at   INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS configs (
  version        INTEGER PRIMARY KEY,
  config_content TEXT NOT NULL,
  content_hash   TEXT,
  content_size   INTEGER,
  author_id      TEXT NOT NULL REFERENCES users(id),
  status         TEXT NOT NULL CHECK(status IN ('draft', 'pending_review', 'approved', 'published', 'rejected')),
  base_version   INTEGER,
  key_id         TEXT,
  signature      TEXT,
  expires_at     INTEGER,
  created_at     INTEGER DEFAULT (unixepoch()),
  submitted_at   INTEGER,
  approved_at    INTEGER,
  published_at   INTEGER
);

CREATE TABLE IF NOT EXISTS approvals (
  id          TEXT PRIMARY KEY,
  config_ver  INTEGER NOT NULL REFERENCES configs(version),
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  decision    TEXT NOT NULL CHECK(decision IN ('approved', 'rejected')),
  comment     TEXT,
  created_at  INTEGER DEFAULT (unixepoch()),
  UNIQUE(config_ver, reviewer_id)
);

CREATE INDEX IF NOT EXISTS idx_configs_status ON configs(status);
CREATE INDEX IF NOT EXISTS idx_configs_published ON configs(status, version) WHERE status = 'published';
`;
