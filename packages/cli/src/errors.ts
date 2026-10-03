/**
 * @module errors
 *
 * Structured error / exit-code handling, generalized from OD's
 * `apps/daemon/src/cli.ts` `exitWithStructuredError`/`structuredHttpFailure`
 * (see `archived provenance ledger`). The mechanism — map a stable error `code` to a
 * process exit code, write a `{ error: { code, message, data } }` envelope
 * to stderr — is generic CLI transport plumbing; OD's own exit-code table
 * (`plugin-not-found`, `snapshot-stale`, …) is product-specific and was not
 * ported. Callers extend {@link DEFAULT_CLI_EXIT_CODES} with their own pack's
 * codes rather than this package hosting one global mutable map.
 */

import { sanitizeUnknownDeep } from './redact.js';
import { sanitizeUntrustedText, stripControlSequences } from '@jini-ai/core/text';

// Per CR-004/SEC-RB-009
// (ADS-memory/reports/code-review/CR-remaining-backend-audit-2026-07-21.md,
// ADS-memory/reports/security/SEC-remaining-backend-audit-2026-07-21.md):
// structuredErrorData/structuredHttpFailure below sanitize untrusted
// daemon-supplied text (redact.ts) before it reaches a printed envelope — a
// raw non-JSON body or an arbitrary data/details field can otherwise leak
// internal paths, provider errors, tokens, or injected terminal escapes.

export type ExitCodeTable = Readonly<Record<string, number>>;

/** A minimal, product-neutral starting table. Packs extend this with their own codes. */
export const DEFAULT_CLI_EXIT_CODES: ExitCodeTable = {
  'daemon-not-running': 64,
  'missing-input': 67,
  'invalid-flag': 2,
};

export interface StructuredErrorEnvelope {
  error: {
    code: string;
    message: string;
    data: Record<string, unknown>;
  };
}

export interface ExitWithStructuredErrorInput {
  code: string;
  message: string;
}

export interface StructuredErrorOptions {
  data?: Record<string, unknown>;
  /** Extra/overriding `code -> exitCode` entries layered on {@link DEFAULT_CLI_EXIT_CODES}. */
  exitCodes?: ExitCodeTable;
  /** Defaults to `process.stderr.write`; inject for tests. */
  write?: (requiredArgs: { text: string }) => void;
  /** Defaults to `process.exit`; inject for tests (must not return). */
  exit?: (requiredArgs: { code: number }) => never;
}

/**
 * Write a `{ error }` envelope to stderr and exit with the code mapped from
 * `input.code` (falling back to `1` for an unrecognized code).
 */
export function exitWithStructuredError(
  input: ExitWithStructuredErrorInput,
  options: StructuredErrorOptions = {},
): never {
  const exitCodes: ExitCodeTable = { ...DEFAULT_CLI_EXIT_CODES, ...options.exitCodes };
  const exitCode = exitCodes[input.code] ?? 1;
  const envelope: StructuredErrorEnvelope = {
    error: { code: input.code, message: input.message, data: options.data ?? {} },
  };
  const write = options.write ?? (({ text }: { text: string }) => { process.stderr.write(text); });
  const exit = options.exit ?? (({ code }: { code: number }) => process.exit(code));
  write({ text: `${JSON.stringify(envelope)}\n` });
  return exit({ code: exitCode });
}

interface DaemonErrorBody {
  code?: unknown;
  message?: unknown;
  data?: unknown;
  details?: unknown;
  retryable?: unknown;
}

/** The minimal shape of a `fetch()` `Response` this module needs. */
export interface HttpFailureLike {
  status: number;
  text(): Promise<string>;
}

/**
 * Extract `{ data }` worth surfacing to the structured envelope from a
 * daemon error body: any `data` fields, plus `details`/`retryable` when
 * present. Returns `undefined` when there's nothing to attach.
 *
 * `data`/`details` are daemon-supplied and untrusted, so both are run
 * through {@link sanitizeUnknownDeep} — every string leaf gets bounded,
 * control-sequence-stripped, and secret-redacted before it can reach a
 * printed envelope (CR-004/SEC-RB-009).
 */
export function structuredErrorData({ error }: { error: DaemonErrorBody | undefined }): Record<string, unknown> | undefined {
  if (error === undefined) return undefined;
  const data: Record<string, unknown> = {};
  if (error.data !== undefined && typeof error.data === 'object' && error.data !== null) {
    Object.assign(data, sanitizeUnknownDeep({ value: error.data }) as Record<string, unknown>);
  }
  if (error.details !== undefined) data.details = sanitizeUnknownDeep({ value: error.details });
  if (typeof error.retryable === 'boolean') data.retryable = error.retryable;
  return Object.keys(data).length > 0 ? data : undefined;
}

function extractErrorObject(parsed: unknown): DaemonErrorBody | undefined {
  if (typeof parsed !== 'object' || parsed === null || !('error' in parsed)) return undefined;
  const error = (parsed as { error?: unknown }).error;
  if (typeof error === 'string') return { message: error };
  if (typeof error === 'object' && error !== null) return error as DaemonErrorBody;
  return undefined;
}

/**
 * Map a daemon HTTP error response into the structured exit-code envelope.
 * Daemon error bodies come in two shapes in practice: `{ error: { code,
 * message, ... } }` (structured routes) and `{ error: '<message>' }` (flat
 * legacy routes) — both normalize so the message always reaches the
 * envelope instead of collapsing to a bare `HTTP <status>`.
 *
 * Per CR-004/SEC-RB-009, when there is no structured `message` this no
 * longer embeds the complete raw response body verbatim into `message`
 * (a malicious/broken daemon's body could be enormous, contain terminal
 * control sequences, or echo back a secret). The envelope's `message` stays
 * a stable `HTTP <status>` in that case; a bounded, redacted excerpt of the
 * raw body is attached separately as `data.rawExcerpt` instead. A
 * structured `message` (when present) is still sanitized — it originates
 * from the same untrusted response.
 */
export async function structuredHttpFailure(
  { resp }: { resp: HttpFailureLike },
  { fallbackCode = 'daemon-not-running', ...options }: StructuredErrorOptions & { fallbackCode?: string } = {},
): Promise<never> {
  let raw = '';
  let parsed: unknown = {};
  try {
    raw = await resp.text();
    parsed = raw.length > 0 ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }
  const errorObj = extractErrorObject(parsed);
  const data = structuredErrorData({ error: errorObj });
  const code = typeof errorObj?.code === 'string' ? stripControlSequences({ text: errorObj.code }) : fallbackCode;
  const structuredMessage = typeof errorObj?.message === 'string' ? sanitizeUntrustedText({ text: errorObj.message }) : undefined;
  const message = structuredMessage ?? `HTTP ${resp.status}`;
  const rawExcerpt = structuredMessage === undefined && raw.length > 0 ? sanitizeUntrustedText({ text: raw }) : undefined;
  const mergedData = rawExcerpt !== undefined ? { ...(data ?? {}), rawExcerpt } : data;
  return exitWithStructuredError({ code, message }, { ...(mergedData !== undefined ? { data: mergedData } : {}), ...options });
}
