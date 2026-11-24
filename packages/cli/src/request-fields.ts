/**
 * Strict field validation for a host command that reads one JSON request on stdin.
 * `invalid` is always injected by the host, so wire codes and wording stay the host's;
 * this module mints no error class.
 */
import { isAbsolute } from 'node:path';

/** The host's refusal factory; its error is thrown for every rejected input. */
export interface InvalidRequestPort {
  invalid: () => Error;
}

/**
 * Parse bounded JSON without allowing parser diagnostics (which can quote secrets) to escape.
 * @throws the host's `invalid()` error for null or over-cap text, bad JSON, arrays and non-objects.
 * @complexity O(n) time and space for n bytes of JSON.
 */
export function parseRequestObject(
  { text }: { text: string | null },
  { maxBytes, invalid }: InvalidRequestPort & { maxBytes?: number },
): Record<string, unknown> {
  if (text === null || (maxBytes !== undefined && Buffer.byteLength(text) > maxBytes)) throw invalid();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw invalid(); }
  return requireObject({ value: parsed }, { invalid });
}

/**
 * Unknown fields fail before any file is opened; sensitive input cannot become an accidental
 * future option.
 */
export function assertKnownFields(
  { record, fields }: { record: Record<string, unknown>; fields: readonly string[] },
  { invalid }: InvalidRequestPort,
): void {
  if (Object.keys(record).some(field => !fields.includes(field))) throw invalid();
}

export function requireObject({ value }: { value: unknown }, { invalid }: InvalidRequestPort): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

/** Non-empty after trim and free of NUL bytes. */
export function requireString({ value }: { value: unknown }, { invalid }: InvalidRequestPort): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\0')) throw invalid();
  return value;
}

/** Absolute and free of `..` segments on both separators, so a request cannot walk out of the
 * directory it names (Windows accepts `/` and `\`; drive and UNC roots stay absolute).
 */
export function requireAbsolutePath(
  { value }: { value: unknown },
  { invalid, isAbsolute: absolute = isAbsolute }: InvalidRequestPort & { isAbsolute?: (path: string) => boolean },
): string {
  const path = requireString({ value }, { invalid });
  if (!absolute(path) || path.split(/[\\/]/).includes('..')) throw invalid();
  return path;
}

export function requirePositiveInt({ value }: { value: unknown }, { invalid }: InvalidRequestPort): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw invalid();
  return value;
}
