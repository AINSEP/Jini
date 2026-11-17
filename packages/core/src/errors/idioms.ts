/**
 * @file Named ways to let a failure go, each saying which kind it is. They replace anonymous
 * `.catch(() => {})` handlers so the error gate can tell an intended choice from a swallowed error,
 * and so every use can be listed. None of these is a way back to silent swallowing: a site where a
 * failure should be visible reports it instead.
 */
import type { Logger } from '../primitives/logger.js';
import type { ErrorClass } from './bindings.js';

/** Options of the idioms that take none yet; named so one can be added without changing a signature. */
export interface IdiomOptions {}
/** Options of {@link orFallback} and {@link orFallbackSync}. */
export interface FallbackOptions {
  /** Receives the failure, for a caller that wants it counted or logged. A throw from it is ignored. */
  readonly observe?: (required: { error: unknown; step: string }) => void;
}

/**
 * Marks a promise handled: no unhandled-rejection report for it. Every awaiter of the original
 * promise still gets the rejection. For a promise whose failure its own owner already shows.
 * @complexity O(1).
 */
export function observed(required: { promise: PromiseLike<unknown> }, _optional: IdiomOptions = {}): void {
  required.promise.then(undefined, () => undefined);
}

/**
 * Resolves when the promise settles and never rejects. Only for a promise whose rejection another
 * named owner already receives (a queue tail waiting for the previous job).
 * @complexity O(1).
 */
export function afterSettled(required: { promise: PromiseLike<unknown> }, _optional: IdiomOptions = {}): Promise<void> {
  return Promise.resolve(required.promise).then(() => undefined, () => undefined);
}

function notify({ error, step }: { error: unknown; step: string }, optional: FallbackOptions): void {
  try { optional.observe?.({ error, step }); } catch { /* An observer cannot turn an optional probe into a failure. */ }
}

/**
 * Runs `work`; on ANY failure returns `fallback`. For an optional probe or a documented fallback,
 * where every failure means "no answer". `step` is a fixed label naming the probe; the gate lists it.
 * Where a real failure must not look like "absent", use {@link absentWhen} instead.
 * @complexity O(1) beyond `work`.
 */
export async function orFallback<Value>(required: { work: () => Value | PromiseLike<Value>; fallback: Value; step: string }, optional: FallbackOptions = {}): Promise<Value> {
  try { return await required.work(); }
  catch (error) { notify({ error, step: required.step }, optional); return required.fallback; }
}

/** {@link orFallback} for a synchronous `work` (browser storage that may throw). */
export function orFallbackSync<Value>(required: { work: () => Value; fallback: Value; step: string }, optional: FallbackOptions = {}): Value {
  try { return required.work(); }
  catch (error) { notify({ error, step: required.step }, optional); return required.fallback; }
}

/**
 * Runs cleanup. A failure is logged with its step (the log line carries the class and listed code,
 * a host sink the original) and is never thrown, so cleanup cannot replace the result it follows.
 * @complexity O(1) beyond `work`.
 */
export async function bestEffort(required: { work: () => unknown; step: string; logger: Pick<Logger, 'warn'> }, _optional: IdiomOptions = {}): Promise<void> {
  try { await required.work(); }
  catch (error) {
    try { required.logger.warn({ message: `[cleanup] ${required.step} failed` }, { meta: { step: required.step }, error }); }
    catch { /* A failing log sink cannot turn cleanup into a failure. */ }
  }
}

function isAbsence({ error, codes, kinds }: { error: unknown; codes: readonly string[]; kinds: readonly ErrorClass[] }): boolean {
  if (kinds.some(kind => error instanceof kind)) return true;
  const code: unknown = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && codes.includes(code);
}

/**
 * Runs `work`; returns `undefined` only for the listed codes (`ENOENT`) or classes and RETHROWS
 * everything else, so a storage failure never reads as "not there".
 * @complexity O(codes + kinds) on the failure path.
 */
export async function absentWhen<Value>(
  required: { work: () => Value | PromiseLike<Value>; codes: readonly string[]; kinds: readonly ErrorClass[] }, _optional: IdiomOptions = {},
): Promise<Value | undefined> {
  try { return await required.work(); }
  catch (error) {
    if (isAbsence({ error, codes: required.codes, kinds: required.kinds })) return undefined;
    throw error;
  }
}
