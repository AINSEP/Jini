/**
 * @file Turns a plugin's untrusted connection declaration into a frozen, bounded descriptor.
 *
 * Exists because the declaration arrives from plugin manifests: every id, URL, parameter and
 * field limit is checked once here so the flow code can trust the shape. Endpoint safety (scheme,
 * private hosts, DNS) is still enforced at use by the injected OAuth URL guard.
 */
import { ApiConnectionError } from './errors.js';
import type { ApiConnectionBoundedField, ApiConnectionDescriptor } from './types.js';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PARAM_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_LABEL_LENGTH = 120;
const MAX_URL_LENGTH = 2048;
const MAX_PARAMS = 16;
const MAX_PARAM_VALUE_LENGTH = 512;
const MAX_FIELDS = 8;
/** Callback values ride in a URL; 8 KiB stays within common server request-line limits. */
export const MAX_FIELD_LENGTH = 8192;
/** Names the OAuth core sets itself or reads from the callback; a plugin may not shadow them. */
const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'resource', 'response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'code',
  'code_challenge', 'code_challenge_method', 'code_verifier', 'error', 'error_description', 'error_uri', 'iss',
]);

function invalid(detail: string): ApiConnectionError {
  return new ApiConnectionError({
    code: 'descriptor-invalid',
    message: `The plugin's connection declaration is invalid (${detail}). Fix the plugin manifest and reload it.`,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readId(source: Record<string, unknown>, name: string): string {
  const value = source[name];
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw invalid(`${name} must be a short id`);
  return value;
}

function readLabel(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_LABEL_LENGTH) throw invalid('label');
  return value;
}

function readUrl(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH || !URL.canParse(value)) throw invalid(`${name} must be a URL`);
  return value;
}

function readParamName(value: unknown, where: string): string {
  if (typeof value !== 'string' || !PARAM_NAME_PATTERN.test(value) || RESERVED_NAMES.has(value)) {
    throw invalid(`${where} uses an invalid or reserved name`);
  }
  return value;
}

function readParams(value: unknown, where: string): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze({});
  if (!isRecord(value) || Object.keys(value).length > MAX_PARAMS) throw invalid(where);
  const params: Record<string, string> = {};
  for (const [name, raw] of Object.entries(value)) {
    if (typeof raw !== 'string' || raw.length > MAX_PARAM_VALUE_LENGTH) throw invalid(`${where} value`);
    params[readParamName(name, where)] = raw;
  }
  return Object.freeze(params);
}

function readFields(value: unknown, where: string): readonly ApiConnectionBoundedField[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_FIELDS) throw invalid(where);
  const fields = value.map((entry: unknown) => {
    if (!isRecord(entry)) throw invalid(where);
    const { maxLength } = entry;
    if (!Number.isSafeInteger(maxLength) || (maxLength as number) < 1 || (maxLength as number) > MAX_FIELD_LENGTH) {
      throw invalid(`${where} maxLength`);
    }
    return Object.freeze({ name: readParamName(entry.name, where), maxLength: maxLength as number });
  });
  if (new Set(fields.map(field => field.name)).size !== fields.length) throw invalid(`${where} repeats a name`);
  return Object.freeze(fields);
}

/** Validate and freeze a plugin-declared connection. Throws `descriptor-invalid` naming the bad part. */
export function parseApiConnectionDescriptor(requiredArgs: { readonly value: unknown }): ApiConnectionDescriptor {
  const source = requiredArgs.value;
  if (!isRecord(source)) throw invalid('expected an object');
  const params = source.authorizationParams === undefined ? {} : source.authorizationParams;
  if (!isRecord(params)) throw invalid('authorizationParams');
  return Object.freeze({
    pluginId: readId(source, 'pluginId'),
    connectionId: readId(source, 'connectionId'),
    label: readLabel(source.label),
    authorizationEndpoint: readUrl(source.authorizationEndpoint, 'authorizationEndpoint'),
    tokenEndpoint: readUrl(source.tokenEndpoint, 'tokenEndpoint'),
    authorizationParams: Object.freeze({
      public: readParams(params.public, 'authorizationParams.public'),
      confidential: readParams(params.confidential, 'authorizationParams.confidential'),
    }),
    startParams: readFields(source.startParams, 'startParams'),
    callbackFields: readFields(source.callbackFields, 'callbackFields'),
  });
}
