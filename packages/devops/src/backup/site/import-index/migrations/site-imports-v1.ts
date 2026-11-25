export const IMPORT_INDEX_V1_DDL = `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE site_import_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL) STRICT;
CREATE TABLE imports (import_id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, request_id TEXT, status TEXT NOT NULL CHECK (status IN ('verifying','needs-owner','creating','ready','failed')), created_ms INTEGER NOT NULL, settled_ms INTEGER, expires_ms INTEGER NOT NULL, row_json TEXT NOT NULL, CHECK ((status IN ('ready','failed')) = (settled_ms IS NOT NULL))) STRICT;
CREATE INDEX imports_page ON imports (principal_id, created_ms DESC, import_id DESC);
CREATE INDEX imports_active ON imports (status, expires_ms) WHERE status IN ('verifying','needs-owner','creating');
CREATE INDEX imports_settled ON imports (settled_ms) WHERE settled_ms IS NOT NULL;
CREATE TABLE replay (principal_id TEXT NOT NULL, request_id TEXT NOT NULL, fence_kind TEXT NOT NULL CHECK (fence_kind IN ('sha256','upload','origin')), fence_value TEXT NOT NULL, import_id TEXT NOT NULL, accepted_ms INTEGER NOT NULL, outcome_json TEXT NOT NULL, PRIMARY KEY (principal_id, request_id)) STRICT, WITHOUT ROWID;
CREATE INDEX replay_expiry ON replay (accepted_ms);
PRAGMA user_version = 1;`;
