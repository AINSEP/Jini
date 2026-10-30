/** @file Web-standard receipts (Request -> Response): Express, edge workers, serverless functions and Deno mount the
 * same function. The response never sets a cookie: the browser client owns the cookie, so a slow Accept
 * response can't overwrite a newer Reject. */
// MOVED-FROM: @jini-ai/cms consent/policy.ts createConsentRecord/readConsentRecord and consent/express receipt
// handling (origin check, policy race, no IP/user-agent in evidence). Follow-up (P4): delete the cms copies.
import { ACTIONS, CONSENT_COOKIE, REGION_COOKIE, type Choices, type ConsentAction, type ConsentState, type RegionMode } from '../contract.js';
import { choicesFor, clamp, DEFAULT_MAX_AGE_MS, effective, isFlags, parseStored, RECEIPT_ID, regionFrom } from '../contracts/policy.js';

/** Immutable evidence; no IP, user-agent, or principal identity is collected. */
export interface ConsentRecord { id: string; timestamp: string; policyVersion: string; choices: Choices; regionMode: RegionMode; gpc: boolean; action: ConsentAction }
/** save must be durable before resolving and must not overwrite an existing id. */
export interface ConsentRecordPort {
  save(required: { record: ConsentRecord }, optional?: object): Promise<void>;
  /** Remove a superseded choice from active lookup while retaining its immutable evidence. */
  retire?(required: { id: string }, optional?: object): Promise<void>;
  read?(required: { id: string }, optional?: object): Promise<unknown>;
}
export interface ReceiptPorts {
  store: ConsentRecordPort;
  policy: () => string | Promise<string>;
  /** Unguessable ids matching /^[\w-]{16,128}$/ (crypto.randomUUID() qualifies). */
  ids: () => string;
  now: () => number;
}
export interface ReceiptOptions {
  maxBytes?: number;
  /** The site's configured mode; 'auto' reads the region cookie the host's region middleware set. */
  regionMode?: 'auto' | RegionMode;
  /** Host-owned region answer for this request; overrides regionMode/cookie. */
  region?: (required: { request: Request }) => RegionMode | Promise<RegionMode>;
  /** Host-owned rate limit (the host binds consentRateLimitKey + its limiter). */
  allow?: (required: { request: Request }) => boolean | Promise<boolean>;
}
type Body = { policy?: unknown; choices?: unknown; action?: unknown; gpc?: unknown; previousId?: unknown };

const problem = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** POST <endpoint>. The host builds `request.url` from its PUBLIC origin so the origin check is meaningful.
 * @example app.post('/_consent', async (req, res) => send(res, await handleReceipt({ request: toRequest(req), ports })))
 * @complexity O(body ≤ maxBytes). */
export async function handleReceipt({ request, ports }: { request: Request; ports: ReceiptPorts }, options: ReceiptOptions = {}): Promise<Response> {
  const refused = await refuse({ request, options });
  if (refused) return refused;
  const body = await readJson({ request, maxBytes: options.maxBytes ?? 2048 });
  if (body instanceof Response) return body;
  const policy = await ports.policy();
  if (body.policy !== policy) return problem(409, 'The privacy policy changed. Reload this page and choose again.');
  const action = body.action as ConsentAction;
  if (!ACTIONS.includes(action)) return problem(400, 'Choose accept, reject, save, do-not-sell or withdraw.');
  const record = await toRecord({ request, body, action, policy, ports, options });
  await ports.store.save({ record });
  await retire({ store: ports.store, previousId: body.previousId });
  return new Response(JSON.stringify({ id: record.id }), { status: 201, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

async function toRecord({ request, body, action, policy, ports, options }: { request: Request; body: Body; action: ConsentAction; policy: string; ports: ReceiptPorts; options: ReceiptOptions }): Promise<ConsentRecord> {
  // eslint-disable-next-line no-restricted-syntax -- the Global Privacy Control request header, not a spec id
  const gpc = request.headers.get('sec-gpc') === '1' || request.headers.get('dnt') === '1' || body.gpc === true;
  const flags = choicesFor({ action, picked: isFlags(body.choices) ? body.choices : {} });
  const regionMode = await (options.region ? options.region({ request }) : regionFrom({ configured: options.regionMode ?? 'auto', hint: cookie(request.headers.get('cookie'), REGION_COOKIE) }));
  return { id: ports.ids(), timestamp: new Date(ports.now()).toISOString(), policyVersion: policy, regionMode, gpc, action, choices: clamp({ flags, gpc }) };
}

async function refuse({ request, options }: { request: Request; options: ReceiptOptions }): Promise<Response | null> {
  if (request.method !== 'POST') return problem(405, 'POST a consent choice.');
  if (request.headers.get('origin') !== new URL(request.url).origin) return problem(403, 'Cross-site consent writes are refused.');
  if (options.allow && !(await options.allow({ request }))) return problem(429, 'Too many choices. Try again in a few minutes.');
  return null;
}

/** The superseded receipt leaves active lookup; its evidence stays. A failed retire never fails the new choice. */
async function retire({ store, previousId }: { store: ConsentRecordPort; previousId: unknown }): Promise<void> {
  if (!store.retire || typeof previousId !== 'string' || !RECEIPT_ID.test(previousId)) return;
  await store.retire({ id: previousId }).catch(() => undefined);
}

async function readJson({ request, maxBytes }: { request: Request; maxBytes: number }): Promise<Body | Response> {
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return problem(415, 'Send the choice as JSON.');
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) return problem(413, 'The consent choice is too large.');
  const text = await request.text();
  if (text.length > maxBytes) return problem(413, 'The consent choice is too large.');
  try {
    const value = JSON.parse(text) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Body;
  } catch { /* reported below */ }
  return problem(400, 'Send one JSON consent choice.');
}

/** @complexity O(cookie header). */
function cookie(header: string | null | undefined, name: string): string | null {
  for (const part of (header ?? '').split(/;\s*/)) {
    const at = part.indexOf('=');
    if (at < 1 || part.slice(0, at) !== name) continue;
    try { return decodeURIComponent(part.slice(at + 1)); } catch { return null; }
  }
  return null;
}

/** Server-side read for a host's server-event gate, with the same rule as the browser (durable: an
 * unconfirmed grant is not allowed). The cookie is the visitor's own assertion: good enough to GATE their
 * own events, never proof. Proof is the receipt. No file read per event. @complexity O(cookie header). */
export function readConsent(
  { cookieHeader, policy, regionMode }: { cookieHeader: string | null | undefined; policy: string; regionMode: 'auto' | RegionMode },
  { secGpc, dnt, anonymous = false, nowMs = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS, regionHint }: { secGpc?: string | null; dnt?: string | null; anonymous?: boolean; nowMs?: number; maxAgeMs?: number; regionHint?: 'us' | null } = {},
): ConsentState {
  const header = anonymous ? null : cookieHeader;
  const hint = regionHint === undefined ? cookie(header, REGION_COOKIE) : regionHint;
  return effective({ stored: parseStored({ raw: cookie(header, CONSENT_COOKIE) }), policy, gpc: secGpc === '1' || dnt === '1',
    region: regionFrom({ configured: regionMode, hint }), nowMs }, { maxAgeMs, durable: true, anonymous });
}
