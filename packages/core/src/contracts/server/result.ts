/**
 * @file The success/failure envelope route parsing, handling and origin checks resolve to instead
 * of throwing, so a route host can fold every failure mode into one error pipeline.
 */
import type { Result as CoreResult } from '../../primitives/result.js';
import type { ServerApiError } from './api-error.js';

/** A discriminated success/failure envelope; the error defaults to the wire error shape. */
export type Result<T, E = ServerApiError> = CoreResult<T, E>;

/** Builds a successful `Result` carrying `value`. */
export const ok = <T, E = ServerApiError>({ value }: { readonly value: T }, _optional: Record<string, never> = {}): Result<T, E> => ({ ok: true, value });
/** Builds a failed `Result` carrying `error`. */
export const err = <T = never, E = ServerApiError>({ error }: { readonly error: E }, _optional: Record<string, never> = {}): Result<T, E> => ({ ok: false, error });
