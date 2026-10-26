/** @file Browser runtime (dist/client.min.js). It owns the cookie, the adapter lifecycle, inert tags and
 * receipts. Denial is applied before any network; a durable grant runs only once its receipt exists; a
 * response never sets a cookie, so a slow Accept can't overwrite a newer Reject. No polling, and no reload
 * unless something already ran that cannot be stopped (a raw inert script, or an adapter that can't revoke). */
import { ADAPTER_KIND, CONFIG_ID, CONSENT_COOKIE, OPEN_EVENT, OPTIONAL, READY_EVENT, REGION_COOKIE, STATE_EVENT,
  type AdapterContribution, type ClientConfig, type ConsentAction, type ConsentAdapter, type ConsentState, type Contribution,
  type Evidence, type Flags, type JiniConsentApi, type LazyAdapter, type Optional, type PageConfig, type PluginRegistry,
  type RawContribution, type Revoker, type StoragePrefixes, type StoredChoice } from '../contract.js';
import { choicesFor, DAY_MS, effective, parseStored, RECEIPT_ID, regionFrom } from '../policy.js';
import { ADAPTER_SLOT, createPluginRegistry } from '../plugins.js';
import { activateInert, installOpeners, purge, readCookie, writeCookie } from './dom.js';

export interface ClientPorts {
  doc: Document; fetch: typeof fetch; now: () => number; gpc: () => boolean; reload: () => void;
  importModule: (src: string) => Promise<{ default: ConsentAdapter }>;
}
export interface ClientOptions { plugins?: PluginRegistry; evidence?: Evidence | undefined }
type Run = { ctl: AbortController; result: Promise<Revoker | null> };
type Slot = { entry: AdapterContribution; adapter?: ConsentAdapter | undefined; run?: Run | undefined };
const isLive = (e: AdapterContribution): e is ConsentAdapter => typeof (e as ConsentAdapter).grant === 'function';
const within = (p: Promise<unknown>, ms: number) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);
const quiet = (fn: () => void) => { try { fn(); } catch { /* a broken plugin or listener never blocks consent */ } };

/** @example createCookieConsent({ config, ports: browserPorts(window) }, { evidence: { mode: 'local' } }) */
export function createCookieConsent({ config, ports }: { config: ClientConfig; ports: ClientPorts }, options: ClientOptions = {}): JiniConsentApi {
  const { doc } = ports;
  const plugins = options.plugins ?? createPluginRegistry({}, { slots: [ADAPTER_SLOT] });
  const durable = durableEvidence(options);
  const slots = new Map<string, Slot>();
  const listeners = new Set<(s: ConsentState) => void>();
  const ran = new Set<Optional>();                                    // categories whose raw inert tags executed
  const anonymous = config.banner === 'off';
  const maxAgeMs = (config.maxAgeDays ?? 180) * DAY_MS;
  const region = regionFrom({ configured: config.regionMode, hint: anonymous ? null : readCookie(doc, REGION_COOKIE) });
  const fromCookie = () => anonymous ? null : parseStored({ raw: readCookie(doc, CONSENT_COOKIE) });
  let stored = fromCookie();
  let state = compute();

  function compute(): ConsentState {
    return effective({ stored, policy: config.policy, region, gpc: ports.gpc(), nowMs: ports.now() }, { maxAgeMs, durable: !!durable, anonymous });
  }
  function persist(): void {
    writeCookie(doc, { name: CONSENT_COOKIE, value: JSON.stringify(stored), maxAgeS: maxAgeMs / 1000 }, { domain: config.cookieDomain });
  }

  /** Off-mode adapters load for identity cleanup even at none; only permitted levels grant.
   * Abort is checked after the import and handed to grant(), so a withdrawal during either wait wins. */
  function start(slot: Slot): void {
    const ctl = new AbortController();
    const load = Promise.resolve(slot.adapter ?? ports.importModule((slot.entry as LazyAdapter).src).then(m => (slot.adapter = m.default)));
    const result = load.then(adapter => {
      quiet(() => adapter.onState?.({ state }));
      if (ctl.signal.aborted || anonymous && state.analyticsLevel === 'none') return null;                              // withdrawn first: nothing ran
      return Promise.resolve().then(() => adapter.grant({ config: slot.entry.config ?? adapter.config, state, signal: ctl.signal }))
        .then(r => (r === null ? null : r ?? {}), () => ({}));         // a grant that threw may have run code
    }, () => null);                                                     // import failed: nothing ran
    slot.run = { ctl, result };
  }
  /** Detached from set(): a hung import can never delay a withdrawal. Resolves true when a reload is needed. */
  async function stop(slot: Slot): Promise<boolean> {
    const run = slot.run!;
    slot.run = undefined;
    run.ctl.abort();
    const revoker = await run.result;
    if (!revoker) return false;
    const clean = revoker.revoke ? await Promise.resolve().then(() => revoker.revoke!()).catch(() => false) : false;
    if (!anonymous) purge(doc, slot.adapter?.storage ?? slot.entry.storage);
    return !clean;
  }
  function reconcile(next: ConsentState): void {
    const stops: Promise<boolean>[] = [];
    for (const slot of slots.values()) {
      const allowed = anonymous ? next.analyticsLevel === 'anonymous' : next.allowed[slot.entry.category];
      if (allowed) {
        if (!slot.run) start(slot);
      }
      else if (slot.run) stops.push(stop(slot));
      quiet(() => slot.adapter?.onState?.({ state: next }));
    }
    // Raw tags cannot promise anonymous behavior; only declared adapters can.
    if (!anonymous) activateInert(doc, { allowed: next.allowed, ran });
    const rawRevoked = OPTIONAL.some(c => ran.has(c) && !next.allowed[c]);
    void Promise.all(stops).then(dirty => { if (rawRevoked || dirty.includes(true)) ports.reload(); });
  }
  function apply(): ConsentState {
    const next = (state = compute());
    const html = doc.documentElement;
    html.setAttribute('data-consent', next.status);
    html.setAttribute('data-consent-region', next.region);
    html.toggleAttribute('data-consent-gpc', next.gpc);
    reconcile(next);                                                    // stops start before any listener runs
    listeners.forEach(fn => quiet(() => fn(next)));
    doc.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: next }));
    return next;
  }

  async function confirm(choice: StoredChoice, previousId?: string): Promise<void> {
    if (!durable) return;
    const body = JSON.stringify({ policy: choice.p, choices: choice.c, action: choice.a, gpc: ports.gpc(), previousId });
    const res = await ports.fetch(durable.endpoint, { method: 'POST', credentials: 'same-origin', keepalive: true,
      headers: { 'content-type': 'application/json' }, body }).catch(() => null);
    const out = res?.ok ? ((await res.json().catch(() => null)) as { id?: unknown } | null) : null;
    // Superseded in this tab, or another tab wrote a newer choice (adopt it): the late receipt is ignored.
    if (stored !== choice || adopt()) return;
    if (typeof out?.id !== 'string' || !RECEIPT_ID.test(out.id)) return; // failed: q stays, retried at the next boot
    stored = { v: 1, p: choice.p, c: choice.c, t: choice.t, a: choice.a, r: out.id };
    persist();
    apply();                                                            // the receipt is what lets durable grants run
  }

  async function set({ action }: { action: ConsentAction }, { choices: picked = {} }: { choices?: Partial<Flags> } = {}): Promise<ConsentState> {
    if (anonymous) return apply();
    const previousId = stored?.r;
    stored = { v: 1, p: config.policy, c: choicesFor({ action, picked }), t: ports.now(), a: action, ...(durable ? { q: 1 as const } : {}) };
    persist();
    const now = apply();                                                // denial is live here, before any network
    const sent = confirm(stored, previousId);
    if (durable && OPTIONAL.some(c => now.choices[c] && !now.allowed[c])) await within(sent, durable.waitMs ?? 1500);
    return state;
  }

  function addSlot(entry: AdapterContribution): void {
    if (anonymous && (!entry.supportsAnonymous || entry.category !== 'analytics')) return;
    const slot: Slot = { entry, adapter: isLive(entry) ? entry : undefined };
    slots.set(entry.id, slot);
    if (anonymous || state.allowed[entry.category]) start(slot);
    else purge(doc, entry.storage);                     // leftovers of an expired or withdrawn choice
    quiet(() => slot.adapter?.onState?.({ state }));                    // lazy adapters get state once loaded
  }
  function syncSlots(items: readonly Contribution[]): void {
    const ids = new Set(items.map(i => i.id));
    for (const [id, slot] of slots) {
      if (ids.has(id)) continue;
      slots.delete(id);
      if (slot.run) void stop(slot).then(dirty => { if (dirty) ports.reload(); });
    }
    for (const item of items as readonly AdapterContribution[]) if (!slots.has(item.id)) addSlot(item);
  }
  /** Another tab chose: adopt its cookie exactly as a page load would. Page-visible events only, no polling.
   * Returns true when the cookie held a different choice. */
  function adopt(): boolean {
    const latest = fromCookie();
    if (latest?.t === stored?.t && latest?.a === stored?.a && latest?.r === stored?.r) return false;
    stored = latest;
    apply();
    return true;
  }

  const api: JiniConsentApi = {
    contract: 1, plugins, set,
    get: () => state,
    subscribe: ({ listener }) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    open: () => { doc.dispatchEvent(new CustomEvent(OPEN_EVENT)); },
    setOpen: ({ open }) => { doc.documentElement.toggleAttribute('data-consent-open', open); },
  };
  plugins.subscribe({ kind: ADAPTER_KIND, listener: syncSlots });
  syncSlots(plugins.list({ kind: ADAPTER_KIND }));                     // registered before this client existed
  config.plugins?.forEach(item => plugins.registerPlugin(item, { source: 'page' }));
  apply();
  doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') adopt(); });
  doc.defaultView?.addEventListener('pageshow', () => adopt());
  if (stored?.q && stored.p === config.policy) void confirm(stored);   // durable retry of an earlier failed receipt
  return api;
}

function durableEvidence({ evidence }: ClientOptions, _optional = {}): Extract<Evidence, { mode: 'durable' }> | null {
  return evidence?.mode === 'durable' ? evidence : null;
}

export function browserPorts(win: Window & typeof globalThis): ClientPorts {
  return {
    doc: win.document, fetch: win.fetch.bind(win), now: Date.now, reload: () => win.location.reload(),
    gpc: () => (win.navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true || win.navigator.doNotTrack === '1',
    importModule: src => import(/* @vite-ignore */ src) as Promise<{ default: ConsentAdapter }>,
  };
}

export interface BootOptions {
  ports?: ClientPorts;
  /** The Jini banner binding; only the client-jini.min.js build passes it, so headless pages never download it. */
  bindBanner?: (required: { api: JiniConsentApi; doc: Document }) => void;
}

function readPage(doc: Document): PageConfig | null {
  try { return JSON.parse(doc.getElementById(CONFIG_ID)?.textContent ?? '') as PageConfig; } catch { return null; }
}

/** Reads #jini-consent-config, installs window.jiniConsent, drains and replaces the pre-boot queue.
 * A missing or broken config installs nothing, so nothing optional can run (fail closed). */
export function boot(win: Window & typeof globalThis = window, { ports = browserPorts(win), bindBanner }: BootOptions = {}): JiniConsentApi | undefined {
  if (win.jiniConsent) return win.jiniConsent;
  const page = readPage(win.document);
  if (!page) return undefined;
  const { evidence, ...config } = page;
  const api = createCookieConsent({ config, ports }, { evidence });
  // Before boot the queue is a plain array; an already-replaced queue object has nothing left to drain.
  const queued = Array.isArray(win.jiniConsentQueue) ? (win.jiniConsentQueue as RawContribution[]) : [];
  win.jiniConsent = api;
  win.jiniConsentQueue = { push: (...items) => items.forEach(item => api.plugins.registerPlugin(item, { source: 'queue' })) };
  win.jiniConsentQueue.push(...queued);
  installOpeners({ api, doc: win.document });
  if (config.banner === 'jini') bindBanner?.({ api, doc: win.document });
  win.document.dispatchEvent(new CustomEvent(READY_EVENT, { detail: api }));
  return api;
}
/** Delete only the caller's storage prefixes; blocked localStorage is tolerated.
 * @example purgeStorage({ doc: document, storage: { cookies: ['vendor_'], local: ['vendor_'] } })
 * @complexity O(cookies + local keys), O(keys) temporary space; no new identity or network. */
export function purgeStorage({ doc, storage }: { doc: Document; storage: StoragePrefixes }, _optional = {}): void {
  purge(doc, storage);
}
export { bindBanner, installOpeners } from './dom.js';
