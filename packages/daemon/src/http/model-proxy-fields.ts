/**
 * @module model-proxy-fields
 *
 * Request-body field helpers for `model-proxy.ts`'s provider parsers: primitive type tests, the
 * table-driven "optional field present but badly typed" check, the required-field 400 builder, and
 * the "forward an optional field only when present" copy. Transport-level shape only — nothing here
 * knows any provider's wire protocol (see `model-proxy.ts`'s module doc).
 */
import type { ApiError } from '@jini-ai/protocol';
import { validationError } from '@jini-ai/http-kit';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export const isString = (value: unknown): boolean => typeof value === 'string';
export const isNumber = (value: unknown): boolean => typeof value === 'number';
export const isArray = (value: unknown): boolean => Array.isArray(value);

/** One optional body field: its name, the primitive-type test it must pass when present, and the 400 message when it does not. */
export type OptionalFieldCheck = readonly [field: string, isValid: (value: unknown) => boolean, message: string];

/** The first optional field that is present (not `undefined`) but fails its type test, as a 400 error; `undefined` when every present field is well-typed. */
export function firstOptionalFieldError(record: Record<string, unknown>, checks: readonly OptionalFieldCheck[]): ApiError | undefined {
  const failed = checks.find(([field, isValid]) => record[field] !== undefined && !isValid(record[field]));
  return failed ? validationError({ message: failed[2] }) : undefined;
}

/** A 400 for a required field, carrying the single-issue `details` the client can point at. */
export function requiredFieldError(path: string, message: string, issue: string): ApiError {
  return validationError({ message }, { issues: [{ path, message: issue }] });
}

/** Copies only the listed keys whose value is not `undefined` — the "forward an optional field only when present" rule every parser and turn-runner call shares. */
export function pickDefined<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const picked: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    if (source[key] !== undefined) picked[key] = source[key];
  }
  return picked;
}
