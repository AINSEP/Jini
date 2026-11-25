import { randomUUID } from 'node:crypto';
import { ToolInputError } from '@jini-ai/core';
import { ClientFacingError } from '@jini-ai/core/contracts/server';
import type { SqliteDb } from '@jini-ai/core/contracts/storage';
import type { RoutineStore, RoutineCreateInput, RoutineUpdateInput } from './routine-store.js';
import { summarizeLastRun } from './routine-store.js';
import type { ClaimResult, DurableRoutine, DurableRoutineRun, RoutineDurablePersistence, RoutineRun } from './types.js';
import { nextRunAtForSchedule } from './schedule.js';
import { JINI_ROUTINES_LEDGER_TABLE, pinnedChecksum } from './migrations/index.js';
export { SQLITE_ROUTINES_SCHEMA } from './routine-store.sqlite-schema.js';
export { JINI_ROUTINES_LEDGER_TABLE, JINI_ROUTINES_MIGRATIONS, migrateJiniRoutines, pinnedChecksum } from './migrations/index.js';

export function createSqliteRoutineStore(
  { db, scope }: { db: SqliteDb; scope: string },
  { now = Date.now, newId = randomUUID, holderId, schemaSetup = 'host', historyLimit = 100 }:
  { now?: () => number; newId?: () => string; holderId?: string; schemaSetup?: 'host'; historyLimit?: number } = {},
): { store: RoutineStore; persistence: RoutineDurablePersistence } {
  const history = db.prepare<[], { id: string; checksum: string }>(`SELECT id, checksum FROM ${JINI_ROUTINES_LEDGER_TABLE}`).all();
  if (schemaSetup !== 'host' || history.length !== 1 || history[0]?.id !== '0001_jini_routines_v1'
    || history[0].checksum !== pinnedChecksum({ id: '0001_jini_routines_v1' }, {})) throw new Error('Routine migration history mismatch');
  const rows = db.prepare<[string], Omit<DurableRoutine, 'schedule' | 'target' | 'context' | 'enabled'> &
    { schedule: string; target: string; context: string; enabled: number }>(`SELECT id,name,prompt,schedule,target,
      skill_id AS skillId,agent_id AS agentId,model,context,creator_id AS creatorId,enabled,next_run_at AS nextRunAt,
      revision,created_at AS createdAt,updated_at AS updatedAt FROM jini_routines WHERE scope=? AND deleted_at IS NULL ORDER BY created_at,id`);
  const runRows = db.prepare<[string, string], Omit<DurableRoutineRun, 'catchUp'> & { catchUp: number }>(`SELECT id,routine_id AS routineId,
    trigger,status,catch_up AS catchUp,slot_at AS slotAt,holder_id AS holderId,project_id AS projectId,
    conversation_id AS conversationId,agent_run_id AS agentRunId,assistant_message_id AS assistantMessageId,
    agent_id AS agentId,model,started_at AS startedAt,completed_at AS completedAt,summary,error,error_code AS errorCode,
    approval_state AS approvalState,approval_ref AS approvalRef,approval_since AS approvalSince
    FROM jini_routine_runs WHERE scope=? AND routine_id=? ORDER BY started_at DESC,id DESC`);
  const lease = db.prepare<[string, string, number], { holder_id: string }>(
    'SELECT holder_id FROM jini_routine_leases WHERE scope=? AND holder_id=? AND expires_at>?');
  const insert = db.prepare(`INSERT INTO jini_routine_runs (scope,id,routine_id,trigger,status,catch_up,slot_at,holder_id,
    project_id,conversation_id,agent_run_id,assistant_message_id,agent_id,model,started_at,completed_at,summary,error,error_code,
    approval_state,approval_ref,approval_since) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const advance = db.prepare(`UPDATE jini_routines SET next_run_at=? WHERE scope=? AND id=? AND deleted_at IS NULL
    AND next_run_at IS ? AND enabled=1`);
  const active = db.prepare<[string, string], { id: string }>("SELECT id FROM jini_routine_runs WHERE scope=? AND routine_id=? AND status IN ('queued','running')");
  const duplicate = db.prepare<[string, string, number], { id: string }>(
    "SELECT id FROM jini_routine_runs WHERE scope=? AND routine_id=? AND trigger='scheduled' AND slot_at=?");
  const prune = db.prepare(`DELETE FROM jini_routine_runs WHERE scope=? AND routine_id=? AND status NOT IN ('queued','running')
    AND id NOT IN (SELECT id FROM jini_routine_runs WHERE scope=? AND routine_id=? ORDER BY started_at DESC,id DESC LIMIT ?)`);
  const insertRun = (run: RoutineRun) => {
    insert.run(scope, run.id, run.routineId, run.trigger, run.status, Number(run.catchUp ?? false), run.slotAt ?? null,
      run.holderId, run.projectId, run.conversationId, run.agentRunId, run.assistantMessageId ?? null,
      run.agentId ?? null, run.model ?? null, run.startedAt, run.completedAt, run.summary, run.error, run.errorCode,
      run.approvalState ?? 'none', run.approvalRef ?? null, run.approvalSince ?? null);
    prune.run(scope, run.routineId, scope, run.routineId, historyLimit);
  };
  const listRuns = (routineId: string): DurableRoutineRun[] => runRows.all(scope, routineId).map((r) => ({ ...r, catchUp: Boolean(r.catchUp) }));
  const list = (): DurableRoutine[] => rows.all(scope).map((r) => ({ ...r, schedule: JSON.parse(r.schedule),
    target: JSON.parse(r.target), context: JSON.parse(r.context), enabled: Boolean(r.enabled),
    lastRun: summarizeLastRun({ run: listRuns(r.id)[0] ?? null }) }));
  const claimDueSlot = db.transaction((input: Parameters<RoutineDurablePersistence['claimDueSlot']>[0]): ClaimResult => {
    if (!lease.get(scope, input.holderId, input.now)) return { claimed: false, reason: 'lease-lost' };
    const routine = list().find((r) => r.id === input.routineId);
    if (!routine) return { claimed: false, reason: 'gone' };
    if (!routine.enabled) return { claimed: false, reason: 'disabled' };
    if (routine.nextRunAt !== input.expectedNextRunAt) return { claimed: false, reason: 'slot-moved' };
    if (duplicate.get(scope, input.routineId, input.expectedNextRunAt)) return { claimed: false, reason: 'slot-moved' };
    advance.run(input.nextRunAt, scope, routine.id, input.expectedNextRunAt);
    if (active.get(scope, routine.id)) return { claimed: false, reason: 'active-run' };
    insertRun(input.run);
    return { claimed: true };
  });
  const update = db.transaction(({ id, patch }: { id: string; patch: RoutineUpdateInput }, { expectedRevision }: { expectedRevision?: number }) => {
    const row = list().find((r) => r.id === id);
    if (!row) return null;
    if (expectedRevision !== undefined && row.revision !== expectedRevision) throw new ClientFacingError({ apiError:
      { code: 'CONFLICT', message: 'Routine changed', details: { reason: 'ROUTINE_CHANGED' } } });
    const schedule = patch.schedule ?? row.schedule;
    const enabled = patch.enabled ?? row.enabled;
    const next = patch.schedule !== undefined || patch.enabled !== undefined
      ? (enabled ? nextRunAtForSchedule({ schedule }, { now: new Date(now()) })?.getTime() ?? null : null) : row.nextRunAt;
    db.prepare(`UPDATE jini_routines SET name=?,prompt=?,schedule=?,target=?,skill_id=?,agent_id=?,model=?,context=?,enabled=?,
      next_run_at=?,revision=revision+1,updated_at=? WHERE scope=? AND id=? AND deleted_at IS NULL`).run(
      patch.name ?? row.name, patch.prompt ?? row.prompt, JSON.stringify(schedule), JSON.stringify(patch.target ?? row.target),
      patch.skillId === undefined ? row.skillId : patch.skillId, patch.agentId === undefined ? row.agentId : patch.agentId,
      patch.model === undefined ? row.model : patch.model, JSON.stringify(patch.context ?? row.context), Number(enabled), next, now(), scope, id);
    return list().find((r) => r.id === id)!;
  });
  const store: RoutineStore = {
    async list(_required = {}, _optional = {}) { return list(); },
    async get({ id }, _optional = {}) { return list().find((r) => r.id === id) ?? null; },
    async create(required: RoutineCreateInput, { creatorId, ...options } = {}) {
      if (!creatorId) throw new ClientFacingError({ apiError: { code: 'UNAUTHORIZED', message: 'A trusted creator is required' } });
      return db.transaction(() => {
        if (list().length >= 200) throw new ClientFacingError({ apiError: { code: 'BAD_REQUEST', message: 'Routine limit reached', details: { reason: 'ROUTINES_LIMIT' } } });
        const input = { ...required, ...options };
        const id = `routine-${newId()}`;
        const time = now();
        const enabled = input.enabled ?? true;
        const next = enabled ? nextRunAtForSchedule({ schedule: input.schedule }, { now: new Date(time) })?.getTime() ?? null : null;
        db.prepare(`INSERT INTO jini_routines (scope,id,name,prompt,schedule,target,skill_id,agent_id,model,context,creator_id,
          enabled,next_run_at,revision,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,NULL)`).run(
          scope, id, input.name, input.prompt, JSON.stringify(input.schedule), JSON.stringify(input.target), input.skillId ?? null,
          input.agentId ?? null, input.model ?? null, JSON.stringify(input.context ?? {}), creatorId, Number(enabled), next, time, time);
        return list().find((r) => r.id === id)!;
      }).immediate();
    },
    async update(required, optional = {}) { return update.immediate(required, optional); },
    async setEnabled({ id, enabled }, optional = {}) { return update.immediate({ id, patch: { enabled } }, optional); },
    async delete({ id }, { expectedRevision } = {}) {
      return db.transaction(() => {
        const row = list().find((r) => r.id === id);
        if (!row) return false;
        if (expectedRevision !== undefined && row.revision !== expectedRevision) throw new ClientFacingError({ apiError:
          { code: 'CONFLICT', message: 'Routine changed', details: { reason: 'ROUTINE_CHANGED' } } });
        db.prepare('UPDATE jini_routines SET deleted_at=?,enabled=0,next_run_at=NULL,revision=revision+1,updated_at=? WHERE scope=? AND id=?').run(now(), now(), scope, id);
        return true;
      }).immediate();
    },
    async listRuns({ routineId, limit: legacyLimit }, { cursor, limit = legacyLimit ?? 20 } = {}) {
      let position: { s: number; i: string } | undefined;
      if (cursor != null) {
        try {
          if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
          const decoded = Buffer.from(cursor, 'base64url');
          if (decoded.toString('base64url') !== cursor) throw new Error();
          const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decoded));
          if (!value || Object.keys(value).sort().join(',') !== 'i,s' || !Number.isSafeInteger(value.s)
            || typeof value.i !== 'string' || !value.i) throw new Error();
          position = value;
        } catch { throw new ToolInputError({ message: 'Invalid routine history cursor' }); }
      }
      if (!Number.isSafeInteger(limit) || limit < 1) throw new ToolInputError({ message: 'Invalid routine history limit' });
      const size = Math.min(50, limit);
      const found = listRuns(routineId).filter((r) => !position || r.startedAt < position.s || (r.startedAt === position.s && r.id < position.i));
      const items = found.slice(0, size);
      const last = items.at(-1);
      return { items, nextCursor: found.length > size && last ? Buffer.from(JSON.stringify({ s: last.startedAt, i: last.id })).toString('base64url') : null };
    },
    async getLatestRun({ routineId }) { return listRuns(routineId)[0] ?? null; },
    async setApproval({ runId, state }, { ref, expectedRef, since } = {}) {
      if (state !== 'waiting' && expectedRef === undefined) return;
      db.transaction(() => {
        db.prepare(`UPDATE jini_routine_runs SET approval_state=:state,approval_ref=COALESCE(:ref,approval_ref),
          approval_since=COALESCE(:since,approval_since) WHERE scope=? AND id=? AND status='running'
          AND (:expectedRef IS NULL OR approval_ref = :expectedRef)`).run(
          { state, ref: ref ?? null, since: since ?? null, expectedRef: expectedRef ?? null }, scope, runId);
      }).immediate();
    },
  };
  const persistence: RoutineDurablePersistence = {
    list,
    claimDueSlot(required, _optional = {}) { return claimDueSlot.immediate(required); },
    insertRun({ run }, { holderId: holder = holderId, now: time = now() } = {}) {
      return db.transaction(() => {
        if (!holder || !lease.get(scope, holder, time)) throw new ClientFacingError({ apiError:
          { code: 'SERVICE_UNAVAILABLE', message: 'Routine lease lost', details: { reason: 'ROUTINES_UNAVAILABLE' } } });
        if (!list().some((r) => r.id === run.routineId) || active.get(scope, run.routineId)) return false;
        insertRun({ ...run, holderId: holder }); return true;
      }).immediate();
    },
    updateRun({ id, patch }) {
      db.transaction(() => {
        const fields: Record<string, string> = { status: 'status', projectId: 'project_id', conversationId: 'conversation_id',
          agentRunId: 'agent_run_id', assistantMessageId: 'assistant_message_id', agentId: 'agent_id', model: 'model',
          completedAt: 'completed_at', summary: 'summary', error: 'error', errorCode: 'error_code' };
        const entries = Object.entries(patch).filter(([key, value]) => fields[key] !== undefined && value !== undefined);
        if (entries.length) db.prepare(`UPDATE jini_routine_runs SET ${entries.map(([key]) => `${fields[key]}=?`).join(',')}
          WHERE scope=? AND id=? AND status IN ('queued','running')`).run(...entries.map(([, value]) => value), scope, id);
        if (patch.status && !['queued', 'running'].includes(patch.status)) {
          db.prepare("UPDATE jini_routine_runs SET approval_state='expired' WHERE scope=? AND id=? AND approval_state='waiting'").run(scope, id);
          const row = db.prepare<[string, string], { routine_id: string }>('SELECT routine_id FROM jini_routine_runs WHERE scope=? AND id=?').get(scope, id);
          if (row) prune.run(scope, row.routine_id, scope, row.routine_id, historyLimit);
        }
      }).immediate();
    },
    getLatestRun({ routineId }) { return listRuns(routineId)[0] ?? null; },
    setNextRunAt({ routineId, expected, nextRunAt, holderId: holder, now: time }, _optional = {}) {
      return db.transaction(() => {
        if (!lease.get(scope, holder, time)) return false;
        return Number(advance.run(nextRunAt, scope, routineId, expected).changes) === 1;
      }).immediate();
    },
    listInFlight({ excludeHolderId } = {}, _optional = {}) {
      const ids = db.prepare<[string], { routine_id: string }>("SELECT DISTINCT routine_id FROM jini_routine_runs WHERE scope=? AND status IN ('queued','running')").all(scope);
      return ids.flatMap((r) => listRuns(r.routine_id)).filter((r) => ['queued', 'running'].includes(r.status) && r.holderId !== excludeHolderId);
    },
    markInterrupted({ runIds, now: time, holderId: holder }, _optional = {}) {
      db.transaction(() => {
        const owns = Boolean(lease.get(scope, holder, time));
        const statement = db.prepare(`UPDATE jini_routine_runs SET status='interrupted',completed_at=?,
          approval_state=CASE WHEN approval_state='waiting' THEN 'expired' ELSE approval_state END
          WHERE scope=? AND id=? AND status IN ('queued','running') AND (holder_id=? OR ?=1)`);
        for (const id of runIds) statement.run(time, scope, id, holder, Number(owns));
      }).immediate();
    },
    acquireLease({ holderId: holder, now: time, ttlMs }, _optional = {}) {
      return db.transaction(() => Number(db.prepare(`INSERT INTO jini_routine_leases (scope,holder_id,expires_at) VALUES (?,?,?)
        ON CONFLICT(scope) DO UPDATE SET holder_id=excluded.holder_id,expires_at=excluded.expires_at
        WHERE jini_routine_leases.holder_id=excluded.holder_id OR jini_routine_leases.expires_at<=?`).run(scope, holder, time + ttlMs, time).changes) === 1).immediate();
    },
    releaseLease({ holderId: holder }, _optional = {}) {
      db.transaction(() => { db.prepare('DELETE FROM jini_routine_leases WHERE scope=? AND holder_id=?').run(scope, holder); }).immediate();
    },
  };
  return { store, persistence };
}
