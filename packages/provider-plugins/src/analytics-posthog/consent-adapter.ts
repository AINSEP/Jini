/** @file PostHog's cookie-consent adapter: the browser module imported for grants or off-mode identity cleanup.
 * Built to `server/consent-adapter.mjs` and served same-origin by `consent.ts`. Anonymous mode sends
 * only an aggregate pageview; full mode loads the pinned posthog-js SDK. The browser checks that SDK
 * against its SHA-256 (SRI) and never runs other bytes. Reuses the consent package's generic storage purge. */
import { purgeStorage } from '@jini-ai/cookie-consent/client';
import type { ConsentAdapter, ConsentState, Revoker, StoragePrefixes } from '@jini-ai/cookie-consent';

/** Public browser config only: the project key is publishable, `host` is the same-origin collector path.
 * Release and environment are trusted deployment labels, never copied from visitor event properties. */
export interface PostHogConsentConfig {
  apiKey: string; host: string; sdk: string; integrity: string; sessionReplay: boolean; siteId?: string;
  release?: string; environment?: string;
}
type BrowserAttributes = Readonly<Record<string, string | undefined>>;

/** Projects trusted host attribution to the three public browser fields; no arbitrary site metadata.
 * Returns a fresh map without mutating the input or performing I/O. @complexity O(1) time and space.
 * @example postHogBrowserAttributes({ attributes: { site_id: 'site-1', release: 'web@abc123' } }) */
export function postHogBrowserAttributes({ attributes }: { attributes: BrowserAttributes }, _optional = {}): Record<string, string> {
  const projected: Record<string, string> = {};
  for (const key of ['site_id', 'release', 'environment']) {
    const value = attributes[key];
    if (value) projected[key] = value;
  }
  return projected;
}
type Properties = Record<string, unknown>;
type CaptureEvent = { event?: string; properties?: Properties };
interface PostHogClient {
  set_config(config: Properties): void;
  stopSessionRecording?(): void;
  get_distinct_id(): string;
  identify(id: string): void;
}
interface PostHogSdk { init(token: string, config: Properties, name: string): PostHogClient }
type ScriptElement = { type: string; src: string; integrity: string; onload: (() => void) | null; onerror: (() => void) | null };
/** The slice of `document` the default loader touches. */
export interface LoaderDocument { createElement(tag: 'script'): ScriptElement; head: { append(node: ScriptElement): void } }
export interface PostHogConsentPorts {
  /** Resolves the SDK only when the bytes matched `integrity`; rejects before any SDK code ran otherwise. */
  loadSdk(required: { src: string; integrity: string }, optional?: object): Promise<PostHogSdk>;
  location: { origin: string; pathname: string; hostname: string };
  request?: typeof fetch;
  doc?: Document;
}

/** One aggregate pageview with public deployment labels, shared by browser and collector. A constant subject never links visitors
 * or pages. No SDK: 1.260.2 probes localStorage even with memory persistence. @complexity O(1). */
export function anonymousPageview({ apiKey, siteId, release, environment }: { apiKey: string; siteId?: string | undefined; release?: string | undefined; environment?: string | undefined }, _optional = {}): string {
  return JSON.stringify({ api_key: apiKey, event: '$pageview', properties: {
    distinct_id: 'visitor:ephemeral', $process_person_profile: false, $geoip_disable: true,
    surface: 'site', ...postHogBrowserAttributes({ attributes: { site_id: siteId, release, environment } }),
  } });
}

/** Cookieless aggregate delivery; no SDK, identity, replay, DOM capture or storage creation.
 * Fetch failures are isolated like SDK loading failures. @complexity O(1), one request. */
async function grantAnonymous({ config, signal, ports }: { config: PostHogConsentConfig; signal: AbortSignal; ports: PostHogConsentPorts }, _optional = {}): Promise<Revoker> {
  await (ports.request ?? fetch)(config.host + '/e/', { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
    headers: { 'content-type': 'application/json' }, body: anonymousPageview(config), signal }).catch(() => undefined);
  return { revoke: () => true };
}

/** Every key posthog-js 1.260.2 writes: `ph_<name>` persistence and the `__ph_opt_in_out_*` flag. */
export const POSTHOG_STORAGE: StoragePrefixes = { cookies: ['ph_', '__ph'], local: ['ph_', '__ph'] };
const INSTANCE = 'jini_consent';
/** Coarse metadata that survives sanitizing; authored text, attributes, URLs and referrers never do. */
const KEPT = ['$event_type', '$el_tag_name', '$browser', '$browser_version', '$os', '$device_type', '$lib', '$lib_version',
  '$viewport_width', '$viewport_height', 'distinct_id', '$device_id', '$session_id', '$window_id', '$is_identified'];

/** Page paths stay; email-like segments and opaque bearer tokens become `:redacted`. @complexity O(path length). */
export function safePath({ path }: { path: string }, _optional = {}): string {
  return (path || '/').split('/').map(part => {
    let decoded: string;
    try { decoded = decodeURIComponent(part); } catch { return ':redacted'; }
    return /@|[a-f0-9]{32,}|[A-Za-z0-9_-]{40,}/i.test(decoded) ? ':redacted' : part;
  }).join('/');
}

/** Only structural selectors survive; authored ids/classes/attributes/text can hold PII. @complexity O(chain), ≤32 elements. */
function maskedChain(chain: string): string {
  return chain.split(';').slice(0, 32).map(element => {
    const tag = /^[a-z][a-z0-9-]*/i.exec(element);
    return tag ? tag[0] + (element.match(/:nth-(?:child|of-type)\([0-9]+\)/g) ?? []).join('') : '';
  }).filter(Boolean).join(';');
}

function maskedElements(elements: unknown[]): Properties[] {
  return elements.slice(0, 32).filter((e): e is Properties => !!e && /^[a-z][a-z0-9-]*$/i.test(String((e as Properties).tag_name ?? '')))
    .map(element => {
      const safe: Properties = { tag_name: element.tag_name };
      for (const key of ['nth_child', 'nth_of_type']) if (Number.isInteger(element[key]) && (element[key] as number) > 0) safe[key] = element[key];
      return safe;
    });
}

/** Rebuilds an event from an allow-list with trusted host deployment labels (moved from the retired browser bridge's full mode).
 * @complexity O(properties + elements). Mutates and returns the SDK's event, as before_send expects. */
export function sanitizeEvent({ event, location, siteId, release, environment }: { event: CaptureEvent; location: PostHogConsentPorts['location']; siteId?: string | undefined; release?: string | undefined; environment?: string | undefined }, _optional = {}): CaptureEvent {
  const props = event.properties ?? {};
  const safe: Properties = {};
  for (const name of KEPT) if (props[name] !== undefined) safe[name] = props[name];
  safe.$process_person_profile = true;
  safe.$pathname = safePath({ path: location.pathname });
  safe.$current_url = location.origin + String(safe.$pathname);
  safe.$host = location.hostname;
  if (typeof props.$elements_chain === 'string') safe.$elements_chain = maskedChain(props.$elements_chain);
  if (Array.isArray(props.$elements)) safe.$elements = maskedElements(props.$elements);
  if (event.event === '$identify') safe.$set = {};
  Object.assign(safe, postHogBrowserAttributes({ attributes: { site_id: siteId, release, environment } }), { surface: 'site' });
  event.properties = safe;
  return event;
}

/** Full-consent settings (moved from the retired bridge). Replay stays off unless the owner enabled it. @complexity O(1). */
function settings(config: PostHogConsentConfig, ports: PostHogConsentPorts, signal: AbortSignal): Properties {
  return {
    api_host: config.host, persistence: 'localStorage+cookie', disable_persistence: false,
    persistence_name: `jini_site_${config.siteId || 'site'}`, person_profiles: 'identified_only',
    disable_compression: true, request_batching: false, mask_all_element_attributes: true, mask_all_text: true,
    autocapture: { capture_copied_text: false }, capture_pageview: 'history_change', capture_pageleave: false,
    disable_session_recording: !config.sessionReplay, session_recording: { maskAllInputs: true, maskTextSelector: '*' },
    disable_surveys: true, advanced_disable_feature_flags: true, advanced_disable_flags: true, disable_web_experiments: true,
    capture_performance: false, capture_heatmaps: false, capture_dead_clicks: false, disable_external_dependency_loading: true,
    enable_recording_console_log: false, capture_exceptions: false, ip: false,
    // Events queued between a withdrawal and revoke() are dropped (the signal aborts first).
    before_send: (event: CaptureEvent) => (signal.aborted ? null : sanitizeEvent({ event, location: ports.location, siteId: config.siteId, release: config.release, environment: config.environment })),
    loaded: (instance: PostHogClient) => {
      // identify(current anonymous ID) is a no-op in 1.260.2; a stable opaque prefix makes the first
      // identification and then reuses the persisted returning ID.
      const id = instance.get_distinct_id();
      if (!signal.aborted) instance.identify(id.startsWith('visitor:') ? id : `visitor:${id}`);
    },
  };
}

/** SRI on a module <script>, then import() of the same URL, which the module map serves from that
 * verified load. A mismatch fires `error` before any SDK code runs. @complexity O(1) + one download. */
export function loadVerifiedSdk({ src, integrity, doc }: { src: string; integrity: string; doc: LoaderDocument },
  { importModule = (url: string) => import(/* @vite-ignore */ url) as Promise<{ default: PostHogSdk }> }: { importModule?: (url: string) => Promise<{ default: PostHogSdk }> } = {}): Promise<PostHogSdk> {
  const script = doc.createElement('script');
  script.type = 'module';
  script.integrity = integrity;
  script.src = src;
  return new Promise<void>((resolve, reject) => {
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('The analytics SDK failed its integrity check or did not load.'));
    doc.head.append(script);
  }).then(() => importModule(script.src)).then(module => module.default);
}

/** One adapter per page. A re-grant after revoke() re-applies settings to the same named instance:
 * posthog-js returns the existing instance for a known name, so a second init() would be ignored.
 * @example createPostHogConsentAdapter({ ports: browserPorts() }) */
export function createPostHogConsentAdapter({ ports }: { ports: PostHogConsentPorts }, _optional = {}): ConsentAdapter<PostHogConsentConfig> {
  let client: PostHogClient | null = null;
  /** Remove only this provider's leftovers; storage can be unavailable in embedded browsers.
   * @complexity O(cookies + local keys), no storage creation or network. */
  function onState({ state }: { state: ConsentState }, _optional = {}): void {
    if (state.analyticsLevel === 'full' || !ports.doc) return;
    // A sandboxed frame throws on document.cookie; cleanup must never block the anonymous pageview.
    try { purgeStorage({ doc: ports.doc, storage: POSTHOG_STORAGE }); } catch { /* nothing readable to purge */ }
  }
  return {
    onState,
    id: 'posthog', kind: 'consent-adapter', category: 'analytics', supportsAnonymous: true, storage: POSTHOG_STORAGE,
    async grant({ config, state, signal }): Promise<Revoker | null> {
      if (signal.aborted) return null;
      onState({ state });
      if (state.analyticsLevel === 'none') return null;
      if (state.analyticsLevel === 'anonymous') return grantAnonymous({ config, signal, ports });
      let sdk: PostHogSdk;
      try { sdk = await ports.loadSdk({ src: config.sdk, integrity: config.integrity }); } catch { return null; }   // nothing ran
      if (signal.aborted) return null;                                       // withdrawn while the SDK downloaded
      const next = settings(config, ports, signal);
      if (client) client.set_config(next);
      else client = sdk.init(config.apiKey, next, INSTANCE);
      const granted = client;
      return {
        revoke() {
          granted.stopSessionRecording?.();
          // Disabling persistence makes the SDK remove its stored cookie/localStorage; the consent client
          // then purges POSTHOG_STORAGE. Batching is off, so no unsent batch survives a withdrawal.
          granted.set_config({ disable_persistence: true, autocapture: false, capture_pageview: false, disable_session_recording: true, before_send: () => null });
          return !config.sessionReplay;                                      // a started replay recorder can't be unloaded: reload
        },
      };
    },
  };
}

/** Browser defaults. Read lazily so the module can be imported (and tested) without a DOM. */
function browserPorts(): PostHogConsentPorts {
  const page = globalThis as unknown as { document: Document; location: PostHogConsentPorts['location'] };
  return {
    loadSdk: ({ src, integrity }) => loadVerifiedSdk({ src, integrity, doc: page.document }),
    get location() { return page.location; },
    get doc() { return page.document; },
  };
}

export default createPostHogConsentAdapter({ ports: browserPorts() });
