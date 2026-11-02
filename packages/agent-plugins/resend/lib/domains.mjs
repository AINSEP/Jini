// @ts-check
import { parseErrorBody } from './errors.mjs';

/**
 * @file Resend sending-domain verification over the Domains API (Jini `MailProviderModule`
 * `domainRequirements` / `domainStatus`). Never throws: every outcome is a `ProviderResult`.
 *
 * `GET /domains` lists the account's domains (no records); `GET /domains/{id}` carries the DNS
 * records Resend needs: SPF as an MX and a TXT on the `send` subdomain, DKIM as a TXT. Record names
 * come back relative to the domain and are qualified here, because the DNS port takes full names.
 * Requests go through the host's guarded client (`ctx.httpClient`; see `getJson` for its shape).
 *
 * @typedef {{ status: 'ok', value: any } | { status: 'rejected' | 'unknown', error: { code: string, message: string, retryAfterMs?: number } }} ProviderResult
 * @typedef {{ method: string, url: string, headers: Record<string, string>, timeoutMs: number }} HttpRequest
 * @typedef {{ status: number, bodyText: string, headers?: Readonly<Record<string, string>> }} HttpResponse
 * @typedef {{ credential: { token: string, baseUrl?: string }, httpClient: { send(required: { request: HttpRequest }): Promise<HttpResponse> } }} CallContext
 */

export const DEFAULT_BASE_URL = 'https://api.resend.com';
const TIMEOUT_MS = 10_000;
const DNS_TYPES = new Set(['TXT', 'MX', 'CNAME']);
/** @type {Readonly<Record<number, string>>} */
const REJECTED_CODES = { 401: 'unauthorized', 403: 'forbidden', 404: 'not_found' };

/** `Retry-After` (seconds) in ms, when present and sane. @param {Readonly<Record<string, string>> | undefined} headers */
export function retryAfterMs(headers) {
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After'] ?? '';
  const seconds = raw.trim() === '' ? Number.NaN : Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : undefined;
}

/** Legacy fallback when Resend supplies no structured error body. @param {{status: number}} required */
function domainFailureFallback({ status }) {
  if (status === 429) return { errorCode: 'rate_limited', message: 'Resend rate limit reached' };
  if (status >= 500) return { errorCode: 'provider_unavailable', message: `Resend responded with HTTP ${status}` };
  return { errorCode: REJECTED_CODES[status] ?? 'provider_error', message: `Resend refused the request (HTTP ${status})` };
}

/** HTTP status to a rejected/unknown result. The code stays Jini's canonical one for the status;
 * Resend's own error name and message ride in `message` so the owner sees what Resend said.
 * A 401 `restricted_api_key` is a valid Sending access key without domain permission. The host
 * retries only permission refusals with the account key, so it must be `forbidden`, not the
 * `unauthorized` a bad key gets. @param {HttpResponse} response @returns {ProviderResult} */
function failure(response) {
  const { status } = response;
  const fallback = domainFailureFallback({ status });
  const parsed = parseErrorBody({ status, bodyText: response.bodyText }, { fallback });
  const restricted = status === 401 && parsed.errorCode === 'restricted_api_key';
  const named = parsed.errorCode !== fallback.errorCode;
  const detail = { code: restricted ? 'forbidden' : fallback.errorCode, message: named ? `${parsed.errorCode}: ${parsed.message}` : parsed.message };
  if (status === 429) {
    const wait = retryAfterMs(response.headers);
    return { status: 'rejected', error: { ...detail, ...(wait === undefined ? {} : { retryAfterMs: wait }) } };
  }
  if (status >= 500) return { status: 'unknown', error: { ...detail } };
  return { status: 'rejected', error: detail };
}

/** One GET, parsed. @param {CallContext} ctx @param {string} path @returns {Promise<ProviderResult>} */
async function getJson(ctx, path) {
  const baseUrl = ctx.credential.baseUrl || DEFAULT_BASE_URL;
  let response;
  try {
    const request = { method: 'GET', url: `${baseUrl}${path}`, headers: { Authorization: `Bearer ${ctx.credential.token}` }, timeoutMs: TIMEOUT_MS };
    // Both client shapes: Jini's `send({ request })` reads `.request`, the host's positional
    // `send(request)` reads the fields. The provider contract names Jini's; `create()` has always been
    // handed the host's positional shape.
    response = await ctx.httpClient.send({ request, ...request });
  } catch (err) {
    return { status: 'unknown', error: { code: 'network', message: err instanceof Error ? err.message : String(err) } };
  }
  if (response.status < 200 || response.status >= 300) return failure(response);
  try {
    return { status: 'ok', value: JSON.parse(response.bodyText) };
  } catch {
    return { status: 'unknown', error: { code: 'unexpected_response', message: 'Resend returned a body that is not JSON' } };
  }
}

/** The account's domain named `domain` (case-insensitive), or null. @param {CallContext} ctx @param {string} domain */
async function findDomain(ctx, domain) {
  const listed = await getJson(ctx, '/domains');
  if (listed.status !== 'ok') return listed;
  const rows = Array.isArray(listed.value?.data) ? listed.value.data : [];
  const wanted = domain.toLowerCase();
  return { status: 'ok', value: rows.find((/** @type {any} */ row) => String(row?.name ?? '').toLowerCase() === wanted) ?? null };
}

/** Resend's domain status to the contract's four states. @param {unknown} status */
export function domainState(status) {
  if (status === 'verified') return 'verified';
  return status === 'failed' ? 'failed' : 'pending';
}

/** A relative record name under `domain` as a full name. @param {string} name @param {string} domain */
export function qualify(name, domain) {
  const lower = name.toLowerCase();
  if (lower === '' || lower === '@' || lower === domain) return domain;
  return lower.endsWith(`.${domain}`) ? lower : `${lower}.${domain}`;
}

/** @param {any} record @param {string} domain */
function toRequirement(record, domain) {
  return {
    type: record.type, name: qualify(String(record.name ?? ''), domain), value: String(record.value ?? ''),
    ...(typeof record.ttl === 'number' ? { ttl: record.ttl } : {}),
    ...(typeof record.priority === 'number' ? { priority: record.priority } : {}),
    note: `${record.record ?? 'Resend'} record`,
  };
}

/**
 * @param {CallContext} ctx @param {{ domain: string }} required
 * @returns {Promise<ProviderResult>}
 */
export async function domainRequirements(ctx, { domain }) {
  const name = domain.toLowerCase();
  const found = await findDomain(ctx, name);
  if (found.status !== 'ok') return found;
  if (found.value === null) return { status: 'rejected', error: { code: 'not_found', message: `Add ${name} under Domains in Resend first` } };
  const detail = await getJson(ctx, `/domains/${encodeURIComponent(String(found.value.id))}`);
  if (detail.status !== 'ok') return detail;
  const records = (Array.isArray(detail.value?.records) ? detail.value.records : [])
    .filter((/** @type {any} */ record) => DNS_TYPES.has(record?.type)).map((/** @type {any} */ record) => toRequirement(record, name));
  return { status: 'ok', value: { purpose: 'mail', domain: name, providerId: 'resend', records } };
}

/**
 * @param {CallContext} ctx @param {{ domain: string }} required
 * @returns {Promise<ProviderResult>}
 */
export async function domainStatus(ctx, { domain }) {
  const name = domain.toLowerCase();
  const found = await findDomain(ctx, name);
  if (found.status !== 'ok') return found;
  return { status: 'ok', value: { domain: name, state: found.value === null ? 'not_found' : domainState(found.value.status) } };
}
