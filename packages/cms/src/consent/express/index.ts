import { randomUUID } from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';
import { createConsentRecord, googleConsentSignals, readConsentRecord, resolveConsentRegion } from '../policy.js';
import { CONSENT_MAX_AGE_MS, type ConsentConfig, type ConsentRecord, type ConsentRecordPort } from '../types.js';
import { gateConsentHtml } from '../html/index.js';
import { blockConsentResponse, captureConsentHtml } from './response.js';
import type { ConsentGateOptions } from '../html/gate.js';

/** All host effects are explicit. Region defaults to unknown; no geo service is required. */
export interface ConsentHttpPorts {
  config: { get(required: Record<string, never>, optional?: Record<string, never>): Promise<ConsentConfig> };
  records: ConsentRecordPort;
  clock: { nowMs(): number; nowIso(): string };
  ids: { newId(): string };
  readReceiptId(required: { cookieHeader: string }, optional?: Record<string, never>): string | null;
  origin(required: { request: Request }, optional?: Record<string, never>): string;
  region(required: { request: Request }, optional?: Record<string, never>): string | null;
  allowWrite(required: { request: Request }, optional?: Record<string, never>): Promise<boolean>;
  reportError(required: { operation: 'read' | 'save'; error: unknown }, optional?: Record<string, never>): void;
}

function isPublicPage(request: Request): boolean {
  return ['GET', 'HEAD'].includes(request.method) && !/^\/(?:admin|api|theme-assets|assets|\.well-known)(?:\/|$)/.test(request.path);
}

/** Missing/malformed IDs never reach storage. Changed policy versions require another choice.
 * @complexity O(1) and at most one bounded record read. */
async function currentRecord({ request, ports, config }: { request: Request; ports: ConsentHttpPorts; config: ConsentConfig }): Promise<{ record: ConsentRecord | null; failed: boolean }> {
  try {
    const id = ports.readReceiptId({ cookieHeader: request.get('cookie') ?? '' });
    if (!id || !/^[a-zA-Z0-9_-]{16,128}$/.test(id)) return { record: null, failed: false };
    const value = await ports.records.read({ id });
    const record = readConsentRecord({ value, policyVersion: config.policyVersion, nowMs: ports.clock.nowMs() });
    if (value !== null && record === null) {
      ports.reportError({ operation: 'read', error: new Error('Invalid consent receipt.') });
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

type ConsentHttpOptions = { endpoint?: string; cookieName?: string; nonce?: string | ((required: { request: Request; response: Response }) => string | undefined); necessaryScripts?: ConsentGateOptions['necessaryScripts']; resourceOrigins?: ConsentGateOptions['resourceOrigins']; delivery?: 'live' | 'static' };

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
function gateOptions({ request, response }: { request: Request; response: Response }, { nonce, necessaryScripts, resourceOrigins }: ConsentHttpOptions): ConsentGateOptions {
  const requestNonce = typeof nonce === 'function' ? nonce({ request, response }) : nonce;
  return { runtimeToken: randomUUID(), ...(requestNonce === undefined ? {} : { nonce: requestNonce }), ...(necessaryScripts === undefined ? {} : { necessaryScripts }), ...(resourceOrigins === undefined ? {} : { resourceOrigins }) };
}

/** Gate one enabled HTML body; any failure keeps the original page under the blocking policy.
 * @complexity O(HTML bytes), at most one receipt read. */
async function gatedBody({ body, request, response, ports, config, failed }: { body: Buffer; request: Request; response: Response; ports: ConsentHttpPorts; config: ConsentConfig; failed: boolean }, options: ConsentHttpOptions & { endpoint: string }): Promise<Buffer> {
  try {
    const encoding = response.getHeader('Content-Encoding');
    if (encoding && encoding !== 'identity') throw new Error('Consent requires uncompressed HTML.');
    const receipt = failed ? { record: null, failed: false } : await currentRecord({ request, ports, config });
    const regionMode = failed || receipt.failed ? 'opt-in' : resolveConsentRegion({ configuredMode: config.regionMode, region: ports.region({ request }) });
    return Buffer.from(gateConsentHtml({ html: body.toString('utf8'), config, record: receipt.record, regionMode, gpc: request.get('sec-gpc') === '1', endpoint: options.endpoint }, gateOptions({ request, response }, options)));
  } catch (error) {
    ports.reportError({ operation: 'read', error });
    // Last-resort browser enforcement keeps the original page available when HTML processing fails.
    blockConsentResponse({ response });
    return body;
  }
}

/** Mount before public renderers, outside admin/API HTML. Durable proof precedes cookie issuance.
 * This is a basic Consent Mode implementation: no Google script or denied cookieless ping loads.
 * Errors are reported through the injected port, and never silently grant optional categories.
 * @complexity Per page O(HTML bytes), one config/receipt read; per choice O(1), one durable write.
 */
export function registerConsentHttp({ app, ports }: { app: Express; ports: ConsentHttpPorts }, options: ConsentHttpOptions = {}): void {
  const { endpoint = '/api/site-consent', cookieName = 'jini_consent', delivery = 'live' } = options;
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
      respondError(response, 500, 'Cookie preferences could not be saved. Optional scripts remain paused. Please try again.');
    }
  });
  app.use((request, response, next) => {
    if (!isPublicPage(request)) { next(); return; }
    captureConsentHtml({ response, transform: ({ body }) => deliver({ body }) }, { reportError: ({ error }) => ports.reportError({ operation: 'read', error }) });
    async function deliver({ body }: { body: Buffer }, _options = {}): Promise<Buffer> {
      const { config, failed } = await deliveryConfig({ ports, state });
      if (!config.enabled) return body;
      response.set('Cache-Control', 'private, no-store');
      response.vary('Cookie'); response.vary('Sec-GPC');
      response.removeHeader('Content-Length'); response.removeHeader('ETag');
      if (delivery === 'static') {
        // Exported pages cannot POST a receipt. Refuse the export instead of publishing a broken theme.
        response.removeHeader('Content-Encoding');
        response.status(409).type('text/plain');
        return Buffer.from('Static export requires cookie consent to be disabled. Review optional scripts before exporting.');
      }
      return gatedBody({ body, request, response, ports, config, failed }, { ...options, endpoint });
    }
    next();
  });
}
