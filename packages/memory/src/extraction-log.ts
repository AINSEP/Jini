/**
 * @module extraction-log
 *
 * A small bounded ring buffer of "extraction attempt" records plus a change
 * event stream, so a host UI can show live running/skipped/success/failed
 * state for whatever background process periodically tries to mine facts
 * out of some input (an LLM call, a regex pass, a connector read — the
 * `kind` field is a free-form host label, not a fixed enum). This is a UX
 * surface, not an audit log — the buffer is intentionally small and newest
 * records evict the oldest.
 */
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

const MAX_RECORDS = 20;
const PREVIEW_CAP = 120;
const ERROR_CAP = 240;

export type ExtractionPhase = 'running' | 'skipped' | 'success' | 'failed' | 'deleted' | 'cleared';

export interface ExtractionProvider {
  kind: string;
  model: string;
  credentialSource?: string | null;
}

export interface ExtractionRecord {
  id: string;
  kind: string;
  startedAt: number;
  finishedAt?: number;
  phase: ExtractionPhase;
  userMessagePreview: string;
  provider?: ExtractionProvider;
  proposedCount?: number;
  writtenCount?: number;
  writtenIds?: string[];
  reason?: string;
  error?: string;
}

export interface ExtractionLog {
  readonly events: EventEmitter;
  startExtraction(input: { userMessage: string; kind: string }): string;
  recordSkip(input: { userMessage: string; reason: string; kind: string }): string;
  recordHeuristic(input: { userMessage: string; kind: string; writtenCount: number; writtenIds: string[] }): string;
  markProvider(required: { id: string; provider: ExtractionProvider }): void;
  markProposed(required: { id: string; proposedCount: number }): void;
  markSuccess(required: { id: string; outcome: { writtenCount: number; writtenIds: string[] } }): void;
  markFailed(required: { id: string; error: unknown }): void;
  list(): ExtractionRecord[];
  remove(required: { id: string }): number;
  clear(): number;
}

function trim(s: string, cap: number): string {
  const text = s.replace(/\s+/g, ' ').trim();
  return text.length <= cap ? text : `${text.slice(0, cap - 1).trim()}…`;
}

function trimError(s: string): string {
  const text = s.replace(/\r?\n/g, ' ').trim();
  return text.length <= ERROR_CAP ? text : `${text.slice(0, ERROR_CAP - 1).trim()}…`;
}

function clone(record: ExtractionRecord): ExtractionRecord {
  return JSON.parse(JSON.stringify(record)) as ExtractionRecord;
}

type ExtractionEvent = ExtractionRecord | { id: string; phase: ExtractionPhase; startedAt: number; finishedAt: number };
type ExtractionLogOptions = { now?: () => number; ids?: () => string; defer?: (required: { callback: () => void }) => void };

/** The bounded record list, its event emitter and the clock/id sources every operation below shares. */
interface ExtractionKeeper {
  readonly events: EventEmitter;
  readonly records: ExtractionRecord[]; // newest first
  readonly nowMs: () => number;
  readonly nextId: () => string;
  emit(record: ExtractionEvent): void;
  pushNewest(record: ExtractionRecord): void;
  findById(id: string): ExtractionRecord | null;
}

function createExtractionKeeper(optional: ExtractionLogOptions): ExtractionKeeper {
  const defer = optional.defer ?? (({ callback }: { callback: () => void }) => { setImmediate(callback); });
  const records: ExtractionRecord[] = [];
  const events = new EventEmitter();
  events.setMaxListeners(64);
  return {
    events, records, nowMs: optional.now ?? Date.now, nextId: optional.ids ?? randomUUID,
    emit(record) {
      // Deferred so a synchronous follow-up update in the same call doesn't
      // fire two events back-to-back within one tick.
      defer({ callback: () => {
        try {
          events.emit('attempt', { ...record });
        } catch {
          // A listener throwing is not this module's problem.
        }
      } });
    },
    pushNewest(record) {
      records.unshift(record);
      if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
    },
    findById: (id) => records.find((r) => r.id === id) ?? null,
  };
}

function createExtractionRecorders(keeper: ExtractionKeeper) {
  const { nowMs, nextId } = keeper;
  const publish = (record: ExtractionRecord): string => {
    keeper.pushNewest(record);
    keeper.emit(record);
    return record.id;
  };
  return {
    startExtraction(input: { userMessage: string; kind: string }): string {
      return publish({
        id: nextId(),
        kind: input.kind,
        startedAt: nowMs(),
        phase: 'running',
        userMessagePreview: trim(input.userMessage, PREVIEW_CAP),
      });
    },
    recordSkip(input: { userMessage: string; reason: string; kind: string }): string {
      const now = nowMs();
      return publish({
        id: nextId(),
        kind: input.kind,
        startedAt: now,
        finishedAt: now,
        phase: 'skipped',
        reason: input.reason,
        userMessagePreview: trim(input.userMessage, PREVIEW_CAP),
      });
    },
    recordHeuristic(input: { userMessage: string; kind: string; writtenCount: number; writtenIds: string[] }): string {
      const written = Number.isFinite(input.writtenCount) ? Math.max(0, Math.floor(input.writtenCount)) : 0;
      const now = nowMs();
      return publish({
        id: nextId(),
        kind: input.kind,
        startedAt: now,
        finishedAt: now,
        phase: written > 0 ? 'success' : 'skipped',
        userMessagePreview: trim(input.userMessage, PREVIEW_CAP),
        writtenCount: written,
        writtenIds: input.writtenIds.slice(0, 12),
        ...(written === 0 ? { reason: 'no-match' } : {}),
      });
    },
  };
}

function createExtractionMarkers(keeper: ExtractionKeeper) {
  const { findById, emit, nowMs } = keeper;
  return {
    markProvider({ id, provider }: { id: string; provider: ExtractionProvider }): void {
      const rec = findById(id);
      if (!rec) return;
      rec.provider = { kind: provider.kind, model: provider.model, credentialSource: provider.credentialSource ?? null };
      emit(rec);
    },
    markProposed({ id, proposedCount }: { id: string; proposedCount: number }): void {
      const rec = findById(id);
      if (!rec) return;
      rec.proposedCount = proposedCount;
      emit(rec);
    },
    markSuccess({ id, outcome }: { id: string; outcome: { writtenCount: number; writtenIds: string[] } }): void {
      const rec = findById(id);
      if (!rec) return;
      rec.phase = 'success';
      rec.writtenCount = outcome.writtenCount;
      rec.writtenIds = outcome.writtenIds.slice(0, 12);
      rec.finishedAt = nowMs();
      emit(rec);
    },
    markFailed({ id, error }: { id: string; error: unknown }): void {
      const rec = findById(id);
      if (!rec) return;
      rec.phase = 'failed';
      const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
      rec.error = trimError(message);
      rec.finishedAt = nowMs();
      emit(rec);
    },
  };
}

function createExtractionQueries({ records, emit, nowMs }: ExtractionKeeper) {
  return {
    list(): ExtractionRecord[] {
      return records.map(clone);
    },
    remove({ id }: { id: string }): number {
      const idx = records.findIndex((r) => r.id === id);
      if (idx < 0) return 0;
      const [removed] = records.splice(idx, 1);
      emit({ ...removed!, phase: 'deleted' }); // The matched index guarantees splice removed a record.
      return 1;
    },
    clear(): number {
      const removed = records.length;
      records.length = 0;
      if (removed > 0) {
        const now = nowMs();
        emit({ id: 'all', phase: 'cleared', startedAt: now, finishedAt: now });
      }
      return removed;
    },
  };
}

/**
 * Construct a bounded extraction-attempt log with its own event emitter.
 *
 * @returns A fresh, independent `ExtractionLog`.
 */
export function createExtractionLog(_required: Record<string, never>, optional: ExtractionLogOptions = {}): ExtractionLog {
  const keeper = createExtractionKeeper(optional);
  return { events: keeper.events, ...createExtractionRecorders(keeper), ...createExtractionMarkers(keeper), ...createExtractionQueries(keeper) };
}
