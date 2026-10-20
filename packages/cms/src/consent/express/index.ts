import { randomUUID } from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';
import { createConsentRecord, googleConsentSignals, readConsentRecord, resolveConsentRegion } from '../policy.js';
import { CONSENT_MAX_AGE_MS, type ConsentConfig, type ConsentRecord, type ConsentRecordPort } from '../types.js';
import { gateConsentHtml } from '../html/index.js';
import { inertConsentBody, captureConsentHtml, CONSENT_MAX_HTML_BYTES } from './response.js';
import type { ConsentGateOptions } from '../html/gate.js';

export type ConsentReceiptProof = { id: string | null; present: boolean };

/** All host effects are explicit. Region defaults to unknown; no geo service is required. */
export interface ConsentHttpPorts {
  config: { get(required: Record<string, never>, optional?: Record<string, never>): Promise<ConsentConfig> };
  records: ConsentRecordPort;
  clock: { nowMs(): number; nowIso(): string };
  ids: { newId(): string };
  /** Prefer { id, present }; legacy null readers use the configured cookie name to retain invalid presence. */
  readReceiptId(required: { cookieHeader: string }, optional?: Record<string, never>): string | null | ConsentReceiptProof;
  origin(required: { request: Request }, optional?: Record<string, never>): string;
  region(required: { request: Request }, optional?: Record<string, never>): string | null;
  allowWrite(required: { request: Request }, optional?: Record<string, never>): Promise<boolean>;
  reportError(required: { operation: 'read' | 'save'; error: unknown }, optional?: Record<string, never>): void;
}

function isPublicPage(request: Request): boolean {
  return ['GET', 'HEAD'].includes(request.method) && !/^\/(?:admin|api|theme-assets|assets|\.well-known)(?:\/|$)/.test(request.path);
}

/** Structured readers retain malformed-cookie presence. Legacy readers returning null are
 * checked against the configured cookie name, so they cannot mistake invalid proof for absence.
 * @complexity O(cookie header length), bounded by the HTTP server. */
function receiptProof({ cookieHeader, cookieName, ports }: { cookieHeader: string; cookieName: string; ports: ConsentHttpPorts }): ConsentReceiptProof {
  const value = ports.readReceiptId({ cookieHeader });
  if (value !== null && typeof value === 'object') return value;
  const present = value !== null || cookieHeader.split(';').some(part => part.split('=', 1)[0]?.trim() === cookieName);
  return { id: value, present };
}

/** Missing/malformed IDs never reach storage. Changed policy versions require another choice.
 * Only a visitor without a receipt cookie is new: a cookie whose receipt is missing (evicted,
 * deleted, another store) is failed proof, so opt-out regions cannot turn a lost rejection into a grant.
 * @complexity O(1) and at most one bounded record read. */
async function currentRecord({ request, ports, config }: { request: Request; ports: ConsentHttpPorts; config: ConsentConfig }, { cookieName }: { cookieName: string }): Promise<{ record: ConsentRecord | null; failed: boolean }> {
  try {
    const { id, present } = receiptProof({ cookieHeader: request.get('cookie') ?? '', cookieName, ports });
    if (!present) return { record: null, failed: false };
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(id)) throw new Error('The consent receipt cookie is invalid. Optional content stays denied; choose cookie preferences again.');
    const value = await ports.records.read({ id });
    const record = readConsentRecord({ value, policyVersion: config.policyVersion, nowMs: ports.clock.nowMs() });
    if (record === null) {
      ports.reportError({ operation: 'read', error: new Error(value === null || value === undefined ? 'The consent receipt named by the visitor cookie is unavailable; optional content stays denied until the visitor chooses again.' : 'The stored consent receipt is invalid or expired. Optional content stays denied; choose cookie preferences again.') });
      return { record: null, failed: true };
    }
    return { record, failed: false };
  } catch (error) {
    // Corrupt, oversized or unreadable proof is absence, never a visitor-wide outage.
    ports.reportError({ operation: 'read', error });
    return { record: null, failed: true };
  }
}

/** Browsers supply Origin on normal POST; Referer supports progressively enhanced no-JS forms.
 * Refuse a request with neither, and ignore caller-selected redirect destinations.
 * @complexity O(header length), bounded by the HTTP server. */
function sameOrigin(request: Request, origin: string): boolean {
  const source = request.get('origin') ?? request.get('referer');
  if (!source) return false;
  try { return new URL(source).origin === new URL(origin).origin; } catch { return false; }
}

function respondError(response: Response, status: number, error: string): void {
  response.status(status).json({ error });
}

type ConsentHttpOptions = { endpoint?: string; cookieName?: string; nonce?: string | ((required: { request: Request; response: Response }) => string | undefined); necessaryScripts?: ConsentGateOptions['necessaryScripts']; resourceOrigins?: ConsentGateOptions['resourceOrigins']; categoryOrigins?: ConsentGateOptions['categoryOrigins']; delivery?: 'live' | 'static'; maxHtmlBytes?: number };

const UNAVAILABLE_CONFIG: ConsentConfig = { enabled: true, regionMode: 'opt-in', policyVersion: 'unavailable', privacyPolicyUrl: '', title: 'Cookie preferences', message: 'Optional content is paused while preferences are unavailable.', acceptLabel: 'Accept all', rejectLabel: 'Reject non-essential', preferencesLabel: 'Cookie preferences' };

/** A port or validation failure while building the receipt is the visitor's 400, never a 500.
 * @complexity O(form fields). */
function newRecord({ request, ports, config }: { request: Request; ports: ConsentHttpPorts; config: ConsentConfig }): { record: ConsentRecord } | { error: string } {
  const gpc = request.get('sec-gpc') === '1' || request.body?.gpc === '1';
  try {
    return { record: createConsentRecord({ fields: request.body ?? {}, config, id: ports.ids.newId(), timestamp: ports.clock.nowIso(), regionMode: resolveConsentRegion({ configuredMode: config.regionMode, region: ports.region({ request }) }), gpc }) };
  } catch (error) { return { error: error instanceof Error ? error.message : 'Invalid cookie preferences.' }; }
}

/** Return to the same-origin page that posted the no-JS form, else home. The caller has already
 * checked sameOrigin for this request. @complexity O(header length). */
function redirectDestination({ request, origin }: { request: Request; origin: string }): string {
  const referer = request.get('referer');
  if (!referer) return '/';
  const url = new URL(referer, origin);
  // A root path beginning // would become a cross-origin Location header.
  return url.origin === new URL(origin).origin && !url.pathname.startsWith('//') ? url.pathname + url.search : '/';
}

/** Durable proof precedes cookie issuance. @complexity O(1), one durable write. */
async function saveChoice({ request, response, ports }: { request: Request; response: Response; ports: ConsentHttpPorts }, { cookieName }: { cookieName: string }): Promise<void> {
  const origin = ports.origin({ request });
  if (!sameOrigin(request, origin)) return respondError(response, 403, 'Cookie preferences must be saved from this site.');
  if (!await ports.allowWrite({ request })) return respondError(response, 429, 'Too many cookie preference changes. Please try again later.');
  const config = await ports.config.get({});
  if (!config.enabled) return respondError(response, 409, 'Cookie consent is disabled on this site.');
  const created = newRecord({ request, ports, config });
  if ('error' in created) return respondError(response, 400, created.error);
  const { record } = created;
  await ports.records.save({ record });
  response.cookie(cookieName, record.id, { httpOnly: true, sameSite: 'lax', secure: new URL(origin).protocol === 'https:', path: '/', maxAge: CONSENT_MAX_AGE_MS });
  if (request.get('accept')?.includes('application/json')) { response.json({ record, signals: googleConsentSignals({ choices: record.choices }) }); return; }
  response.redirect(303, redirectDestination({ request, origin }));
}

/** On a read failure keep the last good policy; without one, deny optional content.
 * @complexity O(1), one config read. */
async function deliveryConfig({ ports, state }: { ports: ConsentHttpPorts; state: { lastGood?: ConsentConfig } }): Promise<{ config: ConsentConfig; failed: boolean }> {
  try {
    const config = await ports.config.get({});
    state.lastGood = config;
    return { config, failed: false };
  } catch (error) {
    ports.reportError({ operation: 'read', error });
    // A failed policy/proof read cannot safely decide that consent is off.
    return { config: state.lastGood ?? UNAVAILABLE_CONFIG, failed: true };
  }
}

/** @complexity O(1). */
function gateOptions({ request, response }: { request: Request; response: Response }, { nonce, necessaryScripts, resourceOrigins, categoryOrigins }: ConsentHttpOptions): ConsentGateOptions {
  const requestNonce = typeof nonce === 'function' ? nonce({ request, response }) : nonce;
  return { runtimeToken: randomUUID(), ...(requestNonce === undefined ? {} : { nonce: requestNonce }), ...(necessaryScripts === undefined ? {} : { necessaryScripts }), ...(resourceOrigins === undefined ? {} : { resourceOrigins }), ...(categoryOrigins === undefined ? {} : { categoryOrigins }) };
}

/** Gate one enabled HTML body; any failure returns inert text under the blocking policy.
 * @complexity O(HTML bytes), at most one receipt read. */
async function gatedBody({ body, request, response, ports, config, failed }: { body: Buffer; request: Request; response: Response; ports: ConsentHttpPorts; config: ConsentConfig; failed: boolean }, options: ConsentHttpOptions & { endpoint: string }): Promise<Buffer> {
  try {
    const encoding = response.getHeader('Content-Encoding');
    if (encoding && encoding !== 'identity') throw new Error('Consent requires uncompressed HTML. Mount consent before compression and retry this page.');
    const receipt = failed ? { record: null, failed: false } : await currentRecord({ request, ports, config }, { cookieName: options.cookieName ?? 'jini_consent' });
    const regionMode = failed || receipt.failed ? 'opt-in' : resolveConsentRegion({ configuredMode: config.regionMode, region: ports.region({ request }) });
    return Buffer.from(gateConsentHtml({ html: body.toString('utf8'), config, record: receipt.record, regionMode, gpc: request.get('sec-gpc') === '1', endpoint: options.endpoint }, gateOptions({ request, response }, options)));
  } catch (error) {
    ports.reportError({ operation: 'read', error });
    // Fetch CSP cannot block meta refresh or first-party pixels, so never return failed HTML.
    return inertConsentBody({ response });
  }
}

type DeliveryPolicy = { config: ConsentConfig; failed: boolean } | { body: Buffer } | null;

/** Shared preflight for ordinary and oversized HTML. Disabled sites remain byte-identical;
 * static export is refused before any size fallback can publish optional content.
 * @complexity O(1), one config read and no receipt access. */
async function prepareDelivery({ request, response, ports, state }: { request: Request; response: Response; ports: ConsentHttpPorts; state: { lastGood?: ConsentConfig } }, { delivery }: ConsentHttpOptions): Promise<DeliveryPolicy> {
  const policy = await deliveryConfig({ ports, state });
  if (!policy.config.enabled) return null;
  response.set('Cache-Control', 'private, no-store');
  response.vary('Cookie'); response.vary('Sec-GPC');
  response.removeHeader('Content-Length'); response.removeHeader('ETag');
  if (delivery !== 'static') return policy;
  // Exported pages cannot POST a receipt. Refuse the export instead of publishing a broken theme.
  response.removeHeader('Content-Encoding');
  response.status(409).type('text/plain');
  return { body: Buffer.from('Static export requires cookie consent to be disabled. Review optional scripts before exporting.') };
}

/** Mount before public renderers, outside admin/API HTML. Durable proof precedes cookie issuance.
 * This is a basic Consent Mode implementation: no Google script or denied cookieless ping loads.
 * Errors are reported through the injected port, and never silently grant optional categories.
 * @complexity Per page O(HTML bytes), one config/receipt read; per choice O(1), one durable write.
 */
export function registerConsentHttp({ app, ports }: { app: Express; ports: ConsentHttpPorts }, options: ConsentHttpOptions = {}): void {
  const { endpoint = '/api/site-consent', cookieName = 'jini_consent', delivery = 'live', maxHtmlBytes = CONSENT_MAX_HTML_BYTES } = options;
  if (!Number.isSafeInteger(maxHtmlBytes) || maxHtmlBytes < 1) throw new Error(`Consent maxHtmlBytes must be a positive whole number of bytes; got ${maxHtmlBytes}.`);
  const state: { lastGood?: ConsentConfig } = {};
  app.get(`${endpoint}/status`, async (_request, response) => {
    response.set('Cache-Control', 'no-store').json({ ready: true });
  });
  app.post(endpoint, express.urlencoded({ extended: false, limit: '2kb', parameterLimit: 12 }), async (request, response) => {
    response.set('Cache-Control', 'no-store');
    try {
      await saveChoice({ request, response, ports }, { cookieName });
    } catch (error) {
      ports.reportError({ operation: 'save', error });
      respondError(response, 500, 'Cookie preferences could not be saved. Your previous choices still apply. Please try again.');
    }
  });
  app.use((request, response, next) => {
    if (!isPublicPage(request)) { next(); return; }
    const prepare = () => prepareDelivery({ request, response, ports, state }, { delivery });
    captureConsentHtml({ response, transform: async ({ body }) => {
      const policy = await prepare();
      if (policy === null) return body;
      if ('body' in policy) return policy.body;
      return gatedBody({ body, request, response, ports, ...policy }, { ...options, endpoint, cookieName });
    } }, {
      reportError: ({ error }) => ports.reportError({ operation: 'read', error }), maxBytes: maxHtmlBytes,
      overflow: async () => {
        const policy = await prepare();
        if (policy === null) return null;
        return 'body' in policy ? policy.body : inertConsentBody({ response });
      },
    });
    next();
  });
}
