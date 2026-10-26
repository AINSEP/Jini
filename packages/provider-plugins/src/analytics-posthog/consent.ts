/** @file PostHog's cookie-consent contribution, server side. The host mounts `http` at a same-origin path
 * it chooses and lists `adapter` (a lazy `consent-adapter` entry) in the consent page config. The browser
 * imports the adapter only on an analytics grant; the adapter then loads the pinned SDK with SRI. */
import { readFile } from 'node:fs/promises';
import type { LazyAdapter } from '@jini-ai/cookie-consent';
import type { BrowserAnalyticsContribution } from '@jini-ai/analytics/product';
import { POSTHOG_STORAGE, type PostHogConsentConfig } from './consent-adapter.js';

/** posthog-js version and the SHA-256 (SRI form) of its `dist/module.full.no-external.js`, which the build
 * copies byte for byte. The build refuses any other bytes; browsers refuse them too. */
export const POSTHOG_BROWSER_VERSION = '1.260.2';
export const POSTHOG_SDK_INTEGRITY = 'sha256-QseGEOjBof8yWCWcE77LNGmWaKgfCRry6AFGs6AGvio=';
/** Artifact files beside `server/index.mjs`. */
export const SDK_FILE = 'posthog-browser.js';
export const ADAPTER_FILE = 'consent-adapter.mjs';
type AssetHandler = NonNullable<BrowserAnalyticsContribution['http']>['handle'];

/** Reject private tokens and credential-bearing endpoints before any browser config exists.
 * Errors are fixed copy: submitted values must never enter diagnostics. O(input bytes).
 */
export function validatePostHogBrowserConfig({ apiKey, host }: { apiKey: string; host: string }, _optional = {}): void {
  if (!/^phc_[A-Za-z0-9_]+$/.test(apiKey)) throw new TypeError('Use a PostHog project key starting with phc_, not a personal API key.');
  let url: URL;
  try { url = new URL(host); } catch { throw new TypeError('Use an HTTP or HTTPS host URL without credentials.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new TypeError('Use an HTTP or HTTPS host URL without credentials.');
  }
}

/** Same-origin collector: only fixed ingestion paths leave the server, with `ip=0`. Visitor cookies, IP
 * headers, referrers and vendor Set-Cookie never cross; redirects can't widen the boundary. O(body). */
export async function forwardCollectorEvent(required: { host: string; path: string; body: Uint8Array; contentType: string }, { request = fetch }: { request?: typeof fetch } = {}): Promise<{ status: number; body: string }> {
  if (!/^\/(?:e|batch|i\/v0\/e|s)\/?$/.test(required.path)) return { status: 404, body: '' };
  const response = await request(required.host.replace(/\/$/, '') + required.path + '?ip=0', { method: 'POST',
    headers: { 'content-type': required.contentType }, body: Buffer.from(required.body), redirect: 'error', signal: AbortSignal.timeout(5000) });
  await response.body?.cancel();
  return { status: response.ok ? 200 : 502, body: response.ok ? '1' : '' };
}

/** `path` is where the host mounts `http` (e.g. `/_consent/posthog`); it is also the browser's collector.
 * @returns the lazy adapter entry for the page config plus the same-origin asset/collector handler.
 * @throws TypeError on a private key, a credential-bearing host or a path that isn't a plain absolute path.
 * @complexity O(1) per request plus one asset read or one forwarded POST. */
export function postHogConsentContribution(
  required: { apiKey: string; host: string; sessionReplay: boolean; siteId?: string | undefined; path: string },
  { request = fetch, loadAsset = name => readFile(new URL(`./${name}`, import.meta.url), 'utf8') }: { request?: typeof fetch; loadAsset?: (name: string) => Promise<string> } = {},
): { adapter: LazyAdapter & { config: PostHogConsentConfig }; http: { path: string; handle: AssetHandler } } {
  validatePostHogBrowserConfig(required);
  if (!/^(?:\/[a-z0-9_-]+)+$/i.test(required.path)) throw new TypeError('Mount the consent assets at a plain absolute path such as /_consent/posthog.');
  const sdk = `/sdk-${POSTHOG_BROWSER_VERSION}.js`;
  const config: PostHogConsentConfig = { apiKey: required.apiKey, host: required.path, sdk: required.path + sdk, integrity: POSTHOG_SDK_INTEGRITY,
    sessionReplay: required.sessionReplay, ...(required.siteId ? { siteId: required.siteId } : {}) };
  const script = async (name: string, cacheControl: string) => ({ status: 200, body: await loadAsset(name), contentType: 'text/javascript; charset=utf-8', cacheControl });
  const handle: AssetHandler = async ({ method, path, body, contentType }) => {
    if (method === 'GET' && path === sdk) return script(SDK_FILE, 'public, max-age=31536000, immutable');
    // Unversioned and tiny: revalidate so a plugin update reaches visitors on their next grant.
    if (method === 'GET' && path === `/${ADAPTER_FILE}`) return script(ADAPTER_FILE, 'no-cache');
    if (method !== 'POST') return { status: 404, body: '' };
    return forwardCollectorEvent({ host: required.host, path, body, contentType }, { request });
  };
  return {
    adapter: { id: 'posthog', kind: 'consent-adapter', category: 'analytics', src: `${required.path}/${ADAPTER_FILE}`, config, storage: POSTHOG_STORAGE },
    http: { path: required.path, handle },
  };
}
