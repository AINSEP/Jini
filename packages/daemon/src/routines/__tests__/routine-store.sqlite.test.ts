import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteRoutineStore, SQLITE_ROUTINES_SCHEMA } from '../routine-store.sqlite.js';
import { pinnedChecksum, JINI_ROUTINES_LEDGER_TABLE } from '../migrations/index.js';
import type { RoutineRun } from '../types.js';

const clock = Date.UTC(2026, 10, 24, 12);
const handles: Database.Database[] = [];
const dirs: string[] = [];
function fixture(scope = 'a', file = ':memory:') {
  const db = new Database(file); handles.push(db); db.pragma('foreign_keys = ON');
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jini_routines'").get()) db.exec(SQLITE_ROUTINES_SCHEMA);
  db.exec(`CREATE TABLE IF NOT EXISTS ${JINI_ROUTINES_LEDGER_TABLE} (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  db.prepare(`INSERT OR IGNORE INTO ${JINI_ROUTINES_LEDGER_TABLE} VALUES (?, ?, 'now')`).run('0001_jini_routines_v1', pinnedChecksum({ id: '0001_jini_routines_v1' }, {}));
  let id = 0;
  const adapter = createSqliteRoutineStore({ db, scope }, { now: () => clock, newId: () => `${scope}-${++id}`, holderId: scope });
  adapter.persistence.acquireLease({ holderId: scope, now: clock, ttlMs: 90_000 }, {});
  return { db, ...adapter };
}
const draft = { name: 'Brief', prompt: 'Brief', schedule: { kind: 'hourly', minute: 0 } as const, target: { mode: 'create_each_run' } as const };
function run(routineId: string, id = 'run'): RoutineRun {
  return { id, routineId, trigger: 'scheduled', status: 'running', projectId: '', conversationId: 'real-chat', agentRunId: '',
    startedAt: clock, completedAt: null, summary: null, error: null, errorCode: null, holderId: 'a', catchUp: false,
    slotAt: clock, approvalState: 'none', approvalRef: null, approvalSince: null, assistantMessageId: 'm' };
}
afterEach(() => { for (const db of handles.splice(0)) if (db.open) db.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true }); });

describe('durable routine storage', () => {
  it('reopen keeps routines and nextRunAt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'routine-')); dirs.push(dir); const file = join(dir, 'r.db');
    const f = fixture('a', file); const row = await f.store.create(draft, { creatorId: 'owner' });
    f.db.close(); const g = fixture('a', file);
    expect(await g.store.get({ id: row.id }, {})).toEqual(row); expect(row.nextRunAt).toBe(clock + 3_600_000);
  });
  it('claim and advance roll back together', async () => {
    const f = fixture(); const row = await f.store.create(draft, { creatorId: 'owner' });
    f.db.exec("CREATE TRIGGER reject_run BEFORE INSERT ON jini_routine_runs BEGIN SELECT RAISE(ABORT, 'reject'); END");
    expect(() => f.persistence.claimDueSlot({ routineId: row.id, expectedNextRunAt: row.nextRunAt!, nextRunAt: clock + 7_200_000,
      run: run(row.id), holderId: 'a', now: clock }, {})).toThrow('reject');
    expect((await f.store.get({ id: row.id }))?.nextRunAt).toBe(row.nextRunAt);
  });
  it('duplicate claim loses', async () => {
    const f = fixture(); const row = await f.store.create(draft, { creatorId: 'owner' });
    const claim = { routineId: row.id, expectedNextRunAt: row.nextRunAt!, nextRunAt: clock + 7_200_000, run: run(row.id), holderId: 'a', now: clock };
    expect(f.persistence.claimDueSlot(claim, {})).toEqual({ claimed: true });
    expect(f.persistence.claimDueSlot({ ...claim, run: run(row.id, 'second') }, {})).toEqual({ claimed: false, reason: 'slot-moved' });
    expect((await f.store.listRuns({ routineId: row.id }, {})).items).toHaveLength(1);
    expect(f.persistence.claimDueSlot({ ...claim, expectedNextRunAt: claim.nextRunAt, nextRunAt: clock + 10_800_000,
      run: run(row.id, 'active-slot') }, {})).toEqual({ claimed: false, reason: 'active-run' });
    expect((await f.store.get({ id: row.id }))?.nextRunAt).toBe(clock + 10_800_000);
  });
  it('scope isolation', async () => {
    const f = fixture(); const other = createSqliteRoutineStore({ db: f.db, scope: 'b' });
    const row = await f.store.create(draft, { creatorId: 'owner' });
    expect(await other.store.list({}, {})).toEqual([]); expect(await other.store.get({ id: row.id })).toBeNull();
  });
  it('pause clears nextRunAt, resume sets the next future slot', async () => {
    const f = fixture(); const row = await f.store.create(draft, { creatorId: 'owner' });
    expect((await f.store.setEnabled({ id: row.id, enabled: false }, { expectedRevision: 1 }))?.nextRunAt).toBeNull();
    expect((await f.store.setEnabled({ id: row.id, enabled: true }, { expectedRevision: 2 }))?.nextRunAt).toBe(clock + 3_600_000);
  });
  it('delete keeps run history links', async () => {
    const f = fixture(); const row = await f.store.create(draft, { creatorId: 'owner' });
    f.persistence.insertRun({ run: { ...run(row.id), trigger: 'manual' } }, { holderId: 'a', now: clock });
    await f.store.delete({ id: row.id }, { expectedRevision: 1 });
    expect(await f.store.get({ id: row.id })).toBeNull();
    expect((await f.store.listRuns({ routineId: row.id }, {})).items[0]?.conversationId).toBe('real-chat');
  });
  it('concurrent pause versus claim', async () => {
    const f = fixture(); const row = await f.store.create(draft, { creatorId: 'owner' });
    await f.store.setEnabled({ id: row.id, enabled: false }, { expectedRevision: 1 });
    expect(f.persistence.claimDueSlot({ routineId: row.id, expectedNextRunAt: row.nextRunAt!, nextRunAt: clock + 7_200_000,
      run: run(row.id), holderId: 'a', now: clock }, {})).toEqual({ claimed: false, reason: 'disabled' });
    expect((await f.store.listRuns({ routineId: row.id }, {})).items).toEqual([]);
  });
  it('late completion does not overwrite interrupted', async () => {
    const f = fixture(); const row = await f.store.create(draft, { creatorId: 'owner' });
    f.persistence.insertRun({ run: run(row.id) }, { holderId: 'a', now: clock });
    f.persistence.markInterrupted({ runIds: ['run'], holderId: 'a', now: clock }, {});
    f.persistence.updateRun({ id: 'run', patch: { status: 'succeeded' } });
    expect((await f.store.getLatestRun({ routineId: row.id }))?.status).toBe('interrupted');
  });
  it('CRUD write is visible to the scheduler adapter', async () => {
    const f = fixture(); const row = await f.store.create(draft, { creatorId: 'owner' });
    expect(f.persistence.list()).toEqual([row]); await f.store.update({ id: row.id, patch: { name: 'New' } });
    expect(f.persistence.list()[0]?.name).toBe('New');
  });
  it('update cannot change creator', async () => {
    const f = fixture(); const row = await f.store.create(draft, { creatorId: 'owner' });
    const patch = { name: 'New', creatorId: 'attacker' };
    await f.store.update({ id: row.id, patch }); expect((await f.store.get({ id: row.id }))?.creatorId).toBe('owner');
  });
  it('old exchange answer cannot clear a newer waiting ref', async () => {
    const f = fixture(); const row = await f.store.create(draft, { creatorId: 'owner' });
    f.persistence.insertRun({ run: run(row.id) }, { holderId: 'a', now: clock });
    await f.store.setApproval({ runId: 'run', state: 'waiting' }, { ref: 'old', since: clock });
    await f.store.setApproval({ runId: 'run', state: 'waiting' }, { ref: 'new', since: clock });
    await f.store.setApproval({ runId: 'run', state: 'approved' }, { expectedRef: 'old' });
    expect(await f.store.getLatestRun({ routineId: row.id })).toMatchObject({ approvalState: 'waiting', approvalRef: 'new' });
  });
  it('refuses missing stamp, pin mismatch, and future history', () => {
    const f = fixture(); f.db.exec(`DELETE FROM ${JINI_ROUTINES_LEDGER_TABLE}`);
    expect(() => createSqliteRoutineStore({ db: f.db, scope: 'a' })).toThrow();
    f.db.prepare(`INSERT INTO ${JINI_ROUTINES_LEDGER_TABLE} VALUES (?, ?, 'now')`).run('0001_jini_routines_v1', 'wrong');
    expect(() => createSqliteRoutineStore({ db: f.db, scope: 'a' })).toThrow();
    f.db.prepare(`UPDATE ${JINI_ROUTINES_LEDGER_TABLE} SET checksum=?`).run(pinnedChecksum({ id: '0001_jini_routines_v1' }));
    f.db.exec(`INSERT INTO ${JINI_ROUTINES_LEDGER_TABLE} VALUES ('9999_future', 'future', 'now')`);
    expect(() => createSqliteRoutineStore({ db: f.db, scope: 'a' })).toThrow();
  });
  it('second-handle takeover rejects a stale-holder manual insert', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'routine-')); dirs.push(dir); const file = join(dir, 'r.db');
    const f = fixture('a', file); const row = await f.store.create(draft, { creatorId: 'owner' });
    const db = new Database(file); handles.push(db);
    const g = createSqliteRoutineStore({ db, scope: 'a' }, { holderId: 'b' });
    expect(g.persistence.acquireLease({ holderId: 'b', now: clock + 90_001, ttlMs: 90_000 }, {})).toBe(true);
    expect(f.persistence.claimDueSlot({ routineId: row.id, expectedNextRunAt: row.nextRunAt!, nextRunAt: clock + 7_200_000,
      run: run(row.id), holderId: 'a', now: clock + 90_001 }, {})).toEqual({ claimed: false, reason: 'lease-lost' });
    expect(() => f.persistence.insertRun({ run: run(row.id) }, { holderId: 'a', now: clock + 90_001 })).toThrow('Routine lease lost');
    expect(g.persistence.insertRun({ run: { ...run(row.id), holderId: 'b' } }, { holderId: 'b', now: clock + 90_001 })).toBe(true);
  });
  it('scope-isolated pruning retains conversations', async () => {
    const f = fixture(); f.db.exec('CREATE TABLE conversations (id TEXT PRIMARY KEY); INSERT INTO conversations VALUES (\'real-chat\')');
    const a = createSqliteRoutineStore({ db: f.db, scope: 'a' }, { now: () => clock, holderId: 'a', historyLimit: 2 });
    const row = await a.store.create(draft, { creatorId: 'owner' });
    const b = createSqliteRoutineStore({ db: f.db, scope: 'b' }, { now: () => clock, holderId: 'b' });
    const other = await b.store.create(draft, { creatorId: 'owner' });
    b.persistence.acquireLease({ holderId: 'b', now: clock, ttlMs: 90_000 }, {});
    b.persistence.insertRun({ run: { ...run(other.id, 'other'), holderId: 'b' } }, { holderId: 'b', now: clock });
    for (let i = 0; i < 4; i++) {
      a.persistence.insertRun({ run: { ...run(row.id, `r${i}`), startedAt: clock + i, slotAt: clock + i } }, { holderId: 'a', now: clock });
      a.persistence.updateRun({ id: `r${i}`, patch: { status: 'succeeded' } });
    }
    expect((await a.store.listRuns({ routineId: row.id }, {})).items).toHaveLength(2);
    expect((await b.store.listRuns({ routineId: other.id }, {})).items).toHaveLength(1);
    expect(f.db.prepare('SELECT id FROM conversations').all()).toEqual([{ id: 'real-chat' }]);
  });
});

describe('routine sidecar migration through the real ADR-066 runner', () => {
  it('migrates a borrowed handle, opens the host-mode store, and a rerun applies nothing', async () => {
    const { runMigrations } = await import('@jini-ai/db/migrate');
    const { sqliteKernel } = await import('@jini-ai/db/kernel/sqlite');
    const { migrateJiniRoutines } = await import('../routine-store.sqlite.js');
    const db = new Database(':memory:'); handles.push(db); db.pragma('foreign_keys = ON');
    const kernel = sqliteKernel<unknown>({ source: db });
    const first = await migrateJiniRoutines({ kernel, runMigrations }, {});
    expect(first.applied).toEqual(['0001_jini_routines_v1']);
    expect((await migrateJiniRoutines({ kernel, runMigrations }, {})).applied).toEqual([]);
    const { store } = createSqliteRoutineStore({ db, scope: 'a' }, { now: () => clock, holderId: 'a' });
    expect((await store.create(draft, { creatorId: 'owner' })).revision).toBe(1);
  });
  it('a database without the ledger stamp is refused before any read', () => {
    const db = new Database(':memory:'); handles.push(db); db.exec(SQLITE_ROUTINES_SCHEMA);
    db.exec(`CREATE TABLE ${JINI_ROUTINES_LEDGER_TABLE} (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`);
    expect(() => createSqliteRoutineStore({ db, scope: 'a' }, { holderId: 'a' })).toThrow('Routine migration history mismatch');
  });
});
