import type { FileLockOptions, JsonFileRead, QuarantineNotice } from '@jini-ai/core/contracts/site/fs-durable-json';

/** Synchronous durable JSON (atomic replace, quarantine, token lock); `createDurableJsonFile` satisfies it. */
export interface RetirementLedgerStore {
  read(required: Record<string, never>): JsonFileRead;
  write(required: { value: unknown }): void;
  quarantine(required: { notice: QuarantineNotice }): boolean;
  withLock<T>(required: { critical: () => T }, optional?: FileLockOptions): T;
}
export interface RetirementDirIdentity { dev: number; ino: number; birthtimeMs: number }
/** Proof captured by the erase arm: identity before the erase, written only after the folder is gone. */
export interface ErasedRetirementCandidate {
  basis: 'erased'; profile: string; sessionRoot: string; partition: string; subjectId: string; subjectDir: string;
  dirIdentity: RetirementDirIdentity; parentDir: string; parentDev: number; eraseVersion: string; erasedAt: string;
}
/** Written by owner-confirmed manual removal; never actionable by an automatic pass. */
export interface OwnerRetirementCandidate { basis: 'owner-dialog'; profile: string; sessionRoot: string; partition: string }
export type RetirementCandidate = ErasedRetirementCandidate | OwnerRetirementCandidate;
export type RetirementState = 'pending' | 'removed' | 'invalidated';
export type RetirementRecord = RetirementCandidate & {
  id: string; state: RetirementState; attempts: number; recordedAt: string;
  lastReason?: string; asideIdentity?: string; closedAt?: string;
};
export type RetirementRead = { state: 'ok'; records: RetirementRecord[] } | { state: 'unknown'; reason: string };
export type RetirementTransition =
  | { state: 'ok'; record: RetirementRecord }
  | { state: 'conflict'; current: RetirementState | 'missing' | 'aside-mismatch' }
  | { state: 'illegal'; from: RetirementState; to: RetirementState }
  | { state: 'unknown'; reason: string };
export interface RetirementLedgerRequired {
  profile: string; durableJson: RetirementLedgerStore; clock: { now(): number }; id: () => string;
}

/** Only `pending` moves; `removed` and `invalidated` are terminal ("kept" is pending with a reason). */
const LEGAL: Record<RetirementState, readonly RetirementState[]> = {
  pending: ['pending', 'removed', 'invalidated'], removed: [], invalidated: [],
};
const NOTICE: QuarantineNotice = {
  label: 'website sign-in removal list',
  consequence: 'sign-ins of deleted websites will be kept and listed instead of removed automatically.',
};
const DAY_MS = 86_400_000;

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function isErasedShape(r: Record<string, unknown>): boolean {
  const id = r.dirIdentity;
  const identity = isObj(id) && isNum(id.dev) && isNum(id.ino) && isNum(id.birthtimeMs);
  return identity && [r.subjectId, r.subjectDir, r.parentDir, r.eraseVersion, r.erasedAt].every(isStr) && isNum(r.parentDev);
}
function isRecord(r: unknown): r is RetirementRecord {
  if (!isObj(r) || ![r.id, r.profile, r.sessionRoot, r.partition, r.recordedAt].every(isStr)) return false;
  if (!(isStr(r.state) && r.state in LEGAL) || !Number.isSafeInteger(r.attempts)) return false;
  const optional = [r.lastReason, r.asideIdentity, r.closedAt].every(v => v === undefined || isStr(v));
  return optional && (r.basis === 'owner-dialog' || (r.basis === 'erased' && isErasedShape(r)));
}

/** A file bound to another profile, or any malformed record, is as untrustworthy as torn bytes. */
function parse(read: JsonFileRead, profile: string): RetirementRead {
  if (read.state === 'missing') return { state: 'ok', records: [] };
  if (read.state === 'unreadable') return { state: 'unknown', reason: 'ledger unreadable' };
  const v = read.value;
  if (!isObj(v) || v.v !== 1 || !Array.isArray(v.records)) return { state: 'unknown', reason: 'ledger malformed' };
  if (v.profile !== profile) return { state: 'unknown', reason: 'ledger belongs to another profile' };
  if (!v.records.every(isRecord)) return { state: 'unknown', reason: 'ledger record malformed' };
  return { state: 'ok', records: v.records };
}

interface LedgerContext extends RetirementLedgerRequired { retentionMs: number }
const iso = (ctx: LedgerContext) => new Date(ctx.clock.now()).toISOString();
const save = (ctx: LedgerContext, records: RetirementRecord[]) => ctx.durableJson.write({ value: { v: 1, profile: ctx.profile, records } });
const close = (ctx: LedgerContext, record: RetirementRecord, state: RetirementState, reason?: string) =>
  Object.assign(record, { state, closedAt: iso(ctx) }, reason === undefined ? {} : { lastReason: reason });

/** Append starts a fresh file over a damaged one only after the damaged bytes were moved aside. */
function recordsForAppend(ctx: LedgerContext): RetirementRecord[] {
  const read = parse(ctx.durableJson.read({}), ctx.profile);
  if (read.state === 'ok') return read.records;
  if (!ctx.durableJson.quarantine({ notice: NOTICE })) throw new Error('The sign-in removal list is damaged and could not be moved aside; nothing was recorded.');
  return [];
}

function append(ctx: LedgerContext, { candidate }: { candidate: RetirementCandidate }): RetirementRecord {
  if (candidate.profile !== ctx.profile) throw new TypeError('Retirement candidate belongs to another profile.');
  return ctx.durableJson.withLock({ critical: () => {
    const records = recordsForAppend(ctx);
    for (const old of records) if (old.state === 'pending' && old.partition === candidate.partition) close(ctx, old, 'invalidated', 'superseded');
    const record: RetirementRecord = { ...candidate, id: ctx.id(), state: 'pending', attempts: 0, recordedAt: iso(ctx) };
    save(ctx, [...records, record]);
    return record;
  } });
}

function invalidate(ctx: LedgerContext, { partition, reason }: { partition: string; reason: string }): { invalidated: number } {
  return ctx.durableJson.withLock({ critical: () => {
    const read = parse(ctx.durableJson.read({}), ctx.profile);
    // A damaged ledger already grants nothing, so there is nothing to invalidate; append quarantines it.
    if (read.state === 'unknown') return { invalidated: 0 };
    const hits = read.records.filter(r => r.state === 'pending' && r.partition === partition);
    hits.forEach(r => close(ctx, r, 'invalidated', reason));
    if (hits.length > 0) save(ctx, read.records);
    return { invalidated: hits.length };
  } });
}

interface TransitionInput { id: string; from: RetirementState; to: RetirementState; reason?: string; asideIdentity?: string }

function applyTransition(ctx: LedgerContext, record: RetirementRecord, input: TransitionInput): RetirementTransition {
  if (input.to === 'pending') {
    record.attempts += 1;
    if (input.reason !== undefined) record.lastReason = input.reason;
    if (input.asideIdentity !== undefined) record.asideIdentity = input.asideIdentity;
    return { state: 'ok', record };
  }
  // The commit names the exact aside folder recorded before the rename; any other folder is not proven.
  if (input.to === 'removed' && (input.asideIdentity === undefined || record.asideIdentity !== input.asideIdentity)) {
    return { state: 'conflict', current: 'aside-mismatch' };
  }
  close(ctx, record, input.to, input.reason);
  return { state: 'ok', record };
}

function transition(ctx: LedgerContext, input: TransitionInput): RetirementTransition {
  if (!LEGAL[input.from].includes(input.to)) return { state: 'illegal', from: input.from, to: input.to };
  return ctx.durableJson.withLock({ critical: () => {
    const read = parse(ctx.durableJson.read({}), ctx.profile);
    if (read.state === 'unknown') return read;
    const record = read.records.find(r => r.id === input.id);
    if (!record) return { state: 'conflict', current: 'missing' };
    if (record.state !== input.from) return { state: 'conflict', current: record.state };
    const result = applyTransition(ctx, record, input);
    if (result.state === 'ok') save(ctx, read.records);
    return result;
  } });
}

/**
 * A terminal record whose aside folder is still on disk cannot be pruned: a `removed` record is the
 * only authority to delete that folder, and without it the next pass must treat the folder as
 * unproven and restore it, bringing a deleted website's sign-ins back as an unowned partition.
 */
function pruneTerminal(ctx: LedgerContext, { unresolvedAsideIds }: { unresolvedAsideIds: readonly string[] }): { pruned: number } {
  const unresolved = new Set(unresolvedAsideIds);
  const cutoff = ctx.clock.now() - ctx.retentionMs;
  const expired = (r: RetirementRecord) => r.state !== 'pending' && r.closedAt !== undefined && Date.parse(r.closedAt) <= cutoff
    && !(r.asideIdentity !== undefined && unresolved.has(r.asideIdentity));
  return ctx.durableJson.withLock({ critical: () => {
    const read = parse(ctx.durableJson.read({}), ctx.profile);
    if (read.state === 'unknown') return { pruned: 0 };
    const kept = read.records.filter(r => !expired(r));
    if (kept.length !== read.records.length) save(ctx, kept);
    return { pruned: read.records.length - kept.length };
  } });
}

/**
 * Positive-proof ledger for whole-partition removal, bound to one profile. Every mutation runs under
 * the store's synchronous lock and re-reads the file, so transitions are compare-and-set by record ID.
 * @complexity O(records) per call.
 */
export function createRetirementLedger(
  required: RetirementLedgerRequired,
  { terminalRetentionDays = 90 }: { terminalRetentionDays?: number } = {},
) {
  const ctx: LedgerContext = { ...required, retentionMs: terminalRetentionDays * DAY_MS };
  return {
    profile: required.profile,
    append: (input: { candidate: RetirementCandidate }, _optional: Record<string, never> = {}) => append(ctx, input),
    invalidate: (input: { partition: string; reason: string }, _optional: Record<string, never> = {}) => invalidate(ctx, input),
    transition: (input: TransitionInput, _optional: Record<string, never> = {}) => transition(ctx, input),
    readStrict: (_required: Record<string, never> = {}, _optional: Record<string, never> = {}) => parse(required.durableJson.read({}), required.profile),
    pruneTerminal: (input: { unresolvedAsideIds: readonly string[] }, _optional: Record<string, never> = {}) => pruneTerminal(ctx, input),
  };
}
export type RetirementLedger = ReturnType<typeof createRetirementLedger>;
