export const SQLITE_ROUTINES_SCHEMA = `
CREATE TABLE jini_routines (
  scope TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, prompt TEXT NOT NULL,
  schedule TEXT NOT NULL, target TEXT NOT NULL, skill_id TEXT, agent_id TEXT, model TEXT,
  context TEXT NOT NULL, creator_id TEXT NOT NULL, enabled INTEGER NOT NULL,
  next_run_at INTEGER, revision INTEGER NOT NULL, created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, deleted_at INTEGER, PRIMARY KEY (scope,id)
);
CREATE INDEX jini_routines_live ON jini_routines(scope,created_at,id) WHERE deleted_at IS NULL;
CREATE TABLE jini_routine_runs (
  scope TEXT NOT NULL, id TEXT NOT NULL, routine_id TEXT NOT NULL, trigger TEXT NOT NULL,
  status TEXT NOT NULL, catch_up INTEGER NOT NULL, slot_at INTEGER, holder_id TEXT NOT NULL,
  project_id TEXT NOT NULL, conversation_id TEXT NOT NULL, agent_run_id TEXT NOT NULL,
  assistant_message_id TEXT, agent_id TEXT, model TEXT, started_at INTEGER NOT NULL,
  completed_at INTEGER, summary TEXT, error TEXT, error_code TEXT,
  approval_state TEXT NOT NULL, approval_ref TEXT, approval_since INTEGER,
  PRIMARY KEY (scope,id), FOREIGN KEY (scope,routine_id) REFERENCES jini_routines(scope,id)
);
CREATE INDEX jini_routine_history ON jini_routine_runs(scope,routine_id,started_at DESC,id DESC);
CREATE UNIQUE INDEX jini_routine_slots ON jini_routine_runs(scope,routine_id,slot_at)
  WHERE trigger='scheduled' AND slot_at IS NOT NULL;
CREATE UNIQUE INDEX jini_routine_active ON jini_routine_runs(scope,routine_id)
  WHERE status IN ('queued','running');
CREATE TABLE jini_routine_leases (
  scope TEXT NOT NULL PRIMARY KEY, holder_id TEXT NOT NULL, expires_at INTEGER NOT NULL
);
`;
