/**
 * @file Bounds checks for values a host or plugin hands to start/complete.
 *
 * Exists so ids, scopes, per-start parameters and provider callback fields are validated in one
 * place before any state is stored or any token endpoint is called. Callback fields follow the
 * plugin's allowlist: undeclared fields are dropped, declared ones must fit their declared size.
 */
import { MAX_AUTHORIZATION_STATE_LENGTH, MAX_CALLBACK_FIELD_LENGTH } from '@jini-ai/oauth';
import { ApiConnectionError } from './errors.js';
import type { ApiConnectionBoundedField } from './types.js';

const MAX_ID_LENGTH = 256;
const MAX_SCOPES = 64;
/** RFC 6749 §3.3 scope-token characters, bounded. */
const SCOPE_TOKEN = /^[\x21\x23-\x5b\x5d-\x7e]{1,512}$/;
const MAX_CALLBACK_PARAMS = 64;
const OAUTH_CALLBACK_NAMES = ['state', 'code', 'error'] as const;

export function requestInvalid(detail: string): ApiConnectionError {
  return new ApiConnectionError({
    code: 'request-invalid',
    message: `The connection request is invalid (${detail}). Start connecting again from the connection settings.`,
  });
}

export function assertId(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value === '' || value.length > MAX_ID_LENGTH) throw requestInvalid(name);
}

/** Non-empty, de-duplicated scope list in RFC 6749 token syntax. */
export function checkScopes(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SCOPES
    || !value.every(scope => typeof scope === 'string' && SCOPE_TOKEN.test(scope))) {
    throw requestInvalid('the plugin resolved no valid scope set');
  }
  return [...new Set(value as string[])];
}

/** Keep only allowlisted names; refuse a declared value over its limit rather than truncate it. */
export function pickBoundedFields(
  fields: readonly ApiConnectionBoundedField[],
  values: Readonly<Record<string, string>>,
  where: string,
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length > field.maxLength) throw requestInvalid(`${where} '${field.name}' is too large`);
    picked[field.name] = value;
  }
  return picked;
}

/** Every name a caller passes must be declared; silently ignoring one would hide a plugin bug. */
export function checkStartParams(fields: readonly ApiConnectionBoundedField[], values: Readonly<Record<string, string>>): Record<string, string> {
  const unknown = Object.keys(values).find(name => !fields.some(field => field.name === name));
  if (unknown !== undefined) throw requestInvalid(`start parameter '${unknown}' is not declared by the plugin`);
  return pickBoundedFields(fields, values, 'start parameter');
}

export interface CheckedCallback {
  readonly state: string;
  readonly code?: string;
  readonly error?: string;
}

/** Bound the raw callback before anything is consumed; OAuth names are validated by the core. */
export function checkCallbackParams(value: Readonly<Record<string, string>>): CheckedCallback {
  const entries = Object.entries(value);
  if (entries.length > MAX_CALLBACK_PARAMS
    || !entries.every(([, raw]) => typeof raw === 'string' && raw.length <= Math.max(MAX_CALLBACK_FIELD_LENGTH, MAX_AUTHORIZATION_STATE_LENGTH))) {
    throw requestInvalid('the callback carried too many or oversized fields');
  }
  const checked: Record<string, string> = {};
  for (const name of OAUTH_CALLBACK_NAMES) if (typeof value[name] === 'string') checked[name] = value[name];
  return { ...checked, state: checked.state ?? '' };
}
