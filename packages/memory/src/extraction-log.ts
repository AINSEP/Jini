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

/**
 * Construct a bounded extraction-attempt log with its own event emitter.
 *
 * @returns A fresh, independent `ExtractionLog`.
 */
export function createExtractionLog(_required: Record<string, never>, optional: { now?: () => number; ids?: () => string; defer?: (required: { callback: () => void }) => void } = {}): ExtractionLog {
  const nowMs = optional.now ?? Date.now;
  const nextId = optional.ids ?? randomUUID;
  const defer = optional.defer ?? (({ callback }: { callback: () => void }) => { setImmediate(callback); });
  const records: ExtractionRecord[] = []; // newest first
  const events = new EventEmitter();
  events.setMaxListeners(64);

  function emit(record: ExtractionRecord | { id: string; phase: ExtractionPhase; startedAt: number; finishedAt: number }): void {
    // Deferred so a synchronous follow-up update in the same call doesn't
    // fire two events back-to-back within one tick.
    defer({ callback: () => {
      try {
        events.emit('attempt', { ...record });
      } catch {
        // A listener throwing is not this module's problem.
      }
    } });
  }

  function pushNewest(record: ExtractionRecord): void {
    records.unshift(record);
    if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
  }

  function findById(id: string): ExtractionRecord | null {
    return records.find((r) => r.id === id) ?? null;
  }

  function startExtraction(input: { userMessage: string; kind: string }): string {
    const record: ExtractionRecord = {
      id: nextId(),
      kind: input.kind,
      startedAt: nowMs(),
      phase: 'running',
      userMessagePreview: trim(input.userMessage, PREVIEW_CAP),
    };
    pushNewest(record);
    emit(record);
    return record.id;
  }

  function recordSkip(input: { userMessage: string; reason: string; kind: string }): string {
    const now = nowMs();
    const record: ExtractionRecord = {
      id: nextId(),
      kind: input.kind,
      startedAt: now,
      finishedAt: now,
      phase: 'skipped',
      reason: input.reason,
      userMessagePreview: trim(input.userMessage, PREVIEW_CAP),
    };
    pushNewest(record);
    emit(record);
    return record.id;
  }

  function recordHeuristic(input: { userMessage: string; kind: string; writtenCount: number; writtenIds: string[] }): string {
    const written = Number.isFinite(input.writtenCount) ? Math.max(0, Math.floor(input.writtenCount)) : 0;
    const now = nowMs();
    const record: ExtractionRecord = {
      id: nextId(),
      kind: input.kind,
      startedAt: now,
      finishedAt: now,
      phase: written > 0 ? 'success' : 'skipped',
      userMessagePreview: trim(input.userMessage, PREVIEW_CAP),
      writtenCount: written,
      writtenIds: input.writtenIds.slice(0, 12),
      ...(written === 0 ? { reason: 'no-match' } : {}),
    };
    pushNewest(record);
    emit(record);
    return record.id;
  }

  function markProvider({ id, provider }: { id: string; provider: ExtractionProvider }): void {
    const rec = findById(id);
    if (!rec) return;
    rec.provider = { kind: provider.kind, model: provider.model, credentialSource: provider.credentialSource ?? null };
    emit(rec);
  }

  function markProposed({ id, proposedCount }: { id: string; proposedCount: number }): void {
    const rec = findById(id);
    if (!rec) return;
    rec.proposedCount = proposedCount;
    emit(rec);
  }

  function markSuccess({ id, outcome }: { id: string; outcome: { writtenCount: number; writtenIds: string[] } }): void {
    const rec = findById(id);
    if (!rec) return;
    rec.phase = 'success';
    rec.writtenCount = outcome.writtenCount;
    rec.writtenIds = outcome.writtenIds.slice(0, 12);
    rec.finishedAt = nowMs();
    emit(rec);
  }

  function markFailed({ id, error }: { id: string; error: unknown }): void {
    const rec = findById(id);
    if (!rec) return;
    rec.phase = 'failed';
    const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
    rec.error = trimError(message);
    rec.finishedAt = nowMs();
    emit(rec);
  }

  function list(): ExtractionRecord[] {
    return records.map(clone);
  }

  function remove({ id }: { id: string }): number {
    const idx = records.findIndex((r) => r.id === id);
    if (idx < 0) return 0;
    const [removed] = records.splice(idx, 1);
    defer({ callback: () => {
      try {
        events.emit('attempt', { ...removed, phase: 'deleted' });
      } catch {
        // A listener throwing is not this module's problem.
      }
    } });
    return 1;
  }

  function clear(): number {
    const removed = records.length;
    records.length = 0;
    if (removed > 0) {
      const now = nowMs();
      defer({ callback: () => {
        try {
          events.emit('attempt', { id: 'all', phase: 'cleared', startedAt: now, finishedAt: now });
        } catch {
          // A listener throwing is not this module's problem.
        }
      } });
    }
    return removed;
  }

  return { events, startExtraction, recordSkip, recordHeuristic, markProvider, markProposed, markSuccess, markFailed, list, remove, clear };
}
