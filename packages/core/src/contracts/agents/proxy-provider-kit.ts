/**
 * @file Request-field kit for `/api/proxy/*` provider registrations: primitive type tests, the table-driven
 * "optional field present but badly typed" check, the required-field 400 builder, the shared
 * `apiKey`/`model`/`messages` parse and the "forward an optional field only when present" copy. Transport-level
 * shape only: nothing here knows any provider's wire protocol. Lives in core (not daemon) so a vendor plugin
 * package, which may import only core and protocol, builds its registration from the same helpers the daemon's
 * generic route layer is tested against.
 */
import { err, ok, validationError, type Result } from '../server.js';
import type { ServerApiError as ApiError } from '../server/api-error.js';

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
export function firstOptionalFieldError({ record, checks }: { record: Record<string, unknown>; checks: readonly OptionalFieldCheck[] }, _optional: Record<string, never> = {}): ApiError | undefined {
  const failed = checks.find(([field, isValid]) => record[field] !== undefined && !isValid(record[field]));
  return failed ? validationError({ message: failed[2] }) : undefined;
}

/** A 400 for a required field, carrying the single-issue `details` the client can point at. */
export function requiredFieldError({ path, message, issue }: { path: string; message: string; issue: string }, _optional: Record<string, never> = {}): ApiError {
  return validationError({ message }, { issues: [{ path, message: issue }] });
}

/** Copies only the listed keys whose value is not `undefined` — the "forward an optional field only when present" rule every parser and turn-runner call shares. */
export function pickDefined<T extends object, K extends keyof T>({ source, keys }: { source: T; keys: readonly K[] }, _optional: Record<string, never> = {}): Partial<Pick<T, K>> {
  const picked: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    if (source[key] !== undefined) picked[key] = source[key];
  }
  return picked;
}

export const TOOLS_CHECK: OptionalFieldCheck = ['tools', isArray, 'tools must be an array when provided'];
export const SYSTEM_CHECK: OptionalFieldCheck = ['system', isString, 'system must be a string when provided'];

/** The shared optional fields, in the order `parseCommon` reports them. */
export const COMMON_OPTIONAL_CHECKS: readonly OptionalFieldCheck[] = [
  ['baseUrl', isString, 'baseUrl must be a string when provided'],
  ['temperature', isNumber, 'temperature must be a number when provided'],
  ['maxTokens', isNumber, 'maxTokens must be a number when provided'],
  ['maxToolTurns', isNumber, 'maxToolTurns must be a number when provided'],
  ['extraHeaders', isRecord, 'extraHeaders must be an object when provided'],
];

export interface ParsedProxyCommon {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model: string;
  readonly messages: unknown[];
  readonly temperature?: number;
  /** Optional here; individual providers narrow to required where their real API demands it (see `ParsedAnthropicProxyRequest`). OpenAI/Azure/Ollama all default to 8192 in their turn-runner when omitted — see each module's doc. */
  readonly maxTokens?: number;
  readonly maxToolTurns?: number;
  readonly extraHeaders?: Record<string, string>;
}

/** The required shared fields, in the order `parseCommon` reports them. */
export function firstRequiredFieldError(body: Record<string, unknown>): ApiError | undefined {
  if (!nonEmptyString(body.apiKey)) return requiredFieldError({ path: 'apiKey', message: 'apiKey must be a non-empty string', issue: 'required non-empty string' });
  if (!nonEmptyString(body.model)) return requiredFieldError({ path: 'model', message: 'model must be a non-empty string', issue: 'required non-empty string' });
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return requiredFieldError({ path: 'messages', message: 'messages must be a non-empty array', issue: 'required non-empty array' });
  }
  return undefined;
}

/**
 * Validates only the transport-level shape every proxied request shares
 * (non-empty `apiKey`/`model`, a `messages` array, and the optional numeric/
 * record fields' primitive types) — never the *contents* of `messages` or
 * `tools`, which is provider wire-protocol knowledge this package does not
 * have (see module doc). A malformed message/tool shape is instead rejected
 * by the real provider API and surfaces as a normal `'error'` SSE event,
 * exactly like any other upstream rejection.
 *
 * SECURITY: `apiKey` travels in this JSON body, not an `Authorization` header
 * — a deliberate BYOK design choice (see module doc), not an oversight, but
 * one that only stays safe because every caller of this function is reached
 * through `runProxyStream`/`registerGenericProxyStreamRoute`, both of which
 * call `guardSameOrigin` before this parser ever runs (confirmed 2026-08-23;
 * see the "rejects a cross-origin request with 403 before touching fetch"
 * regression test per provider, plus the catch-all's own, in
 * `__tests__/model-proxy.test.ts` — each proves the credential is never
 * forwarded to `fetch` for a rejected cross-origin request). Do not loosen or
 * remove that same-origin enforcement without first moving `apiKey` to a
 * header — a body-carried credential is not safe to accept cross-origin.
 */
export function parseCommon(body: unknown): Result<ParsedProxyCommon> {
  if (!isRecord(body)) return err({ error: validationError({ message: 'body must be a JSON object' }) });
  const error = firstRequiredFieldError(body) ?? firstOptionalFieldError({ record: body, checks: COMMON_OPTIONAL_CHECKS });
  if (error) return err({ error });
  return ok({
    value: {
      apiKey: body.apiKey as string,
      model: body.model as string,
      messages: body.messages as unknown[],
      ...(pickDefined({ source: body, keys: COMMON_OPTIONAL_CHECKS.map(([field]) => field) }) as Partial<ParsedProxyCommon>),
    },
  });
}

/** Shared tail of every provider parser: rejects the first badly-typed provider-specific optional field, otherwise returns `base` plus `required` plus whichever of those optional fields are present. */
export function extendParsed<Parsed extends ParsedProxyCommon>(
  { base, record, checks }: { readonly base: ParsedProxyCommon; readonly record: Record<string, unknown>; readonly checks: readonly OptionalFieldCheck[] },
  { required = {} }: { readonly required?: Partial<Parsed> } = {},
): Result<Parsed> {
  const error = firstOptionalFieldError({ record, checks });
  if (error) return err({ error });
  const optional = pickDefined({ source: record, keys: checks.map(([field]) => field) }) as Partial<Parsed>;
  return ok({ value: { ...base, ...required, ...optional } as Parsed });
}

/**
 * OpenAI and Ollama accept the identical request shape: the shared fields plus optional `tools`.
 *
 * Ollama is built on `parseCommon` like every other provider — `apiKey` is required, matching Open
 * Design's real `/api/proxy/ollama/stream` handler (`apps/daemon/src/routes/chat.ts:1298`'s
 * `if (!apiKey || !model)`), confirmed by a live side-by-side comparison against a running OD
 * daemon. An earlier version of this function made `apiKey` optional for a "local Ollama needs no
 * auth" rationale that turned out not to match OD's actual behavior — OD's default target is
 * Ollama Cloud (`https://ollama.com`), which does require a key; see `ollama-chat.ts`'s module doc
 * for the full corrected design.
 */
export interface ParsedToolsProxyRequest extends ParsedProxyCommon {
  readonly tools?: unknown[];
}

export function parseToolsProxyRequest(body: unknown): Result<ParsedToolsProxyRequest> {
  const common = parseCommon(body);
  if (!common.ok) return common;
  return extendParsed<ParsedToolsProxyRequest>({ base: common.value, record: body as Record<string, unknown>, checks: [TOOLS_CHECK] });
}

/** `tools` cast to the turn-runner's own tool-definition type, forwarded only when present (the parser never inspects tool contents — see `parseCommon`); the cast itself now happens at the host-bound port. */
export function toolsOption(tools: unknown[] | undefined): { tools?: readonly unknown[] } {
  return tools !== undefined ? { tools } : {};
}
