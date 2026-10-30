/** @file DOM helpers for the browser client: cookies, storage purge, inert tags and the Jini banner binding.
 * The Jini banner is a client of the public API, exactly like an owner's own ("My own") banner. */
import { OPEN_EVENT, OPTIONAL, type Choices, type ConsentAction, type ConsentState, type Flags, type JiniConsentApi, type Optional, type StoragePrefixes } from '../contract.js';

const INERT = 'script[type="text/plain"][data-consent-category],iframe[data-consent-category][data-src]';
const SKIP: ReadonlySet<string> = new Set(['type', 'data-src', 'data-type', 'data-consent-category']);
// Not <html>: the client sets html[data-consent-open] while the banner shows, and every click's closest() would hit it.
const OPENERS = ':not(html)[data-consent-open],a[href="#privacy-choices"]';

/** @complexity O(cookie header). Malformed escapes read as "no value", never throw. */
export function readCookie(doc: Document, name: string): string | null {
  const part = doc.cookie.split(/;\s*/).find(p => p.startsWith(name + '='));
  try { return part ? decodeURIComponent(part.slice(name.length + 1)) : null; } catch { return null; }
}

export function writeCookie(doc: Document, { name, value, maxAgeS }: { name: string; value: string; maxAgeS: number }, { domain }: { domain?: string | undefined } = {}): void {
  const secure = doc.defaultView?.location.protocol === 'https:' ? '; Secure' : '';
  const domainAttribute = domain ? '; Domain=' + domain : '';
  doc.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${Math.floor(maxAgeS)}; SameSite=Lax${secure}${domainAttribute}`;
}

/** Vendors set cookies on the registrable domain, so expire on the host and each parent domain. */
function expireEverywhere(doc: Document, name: string): void {
  const parts = (doc.defaultView?.location.hostname ?? '').split('.');
  doc.cookie = `${name}=; Path=/; Max-Age=0`;
  for (let i = 0; i < parts.length - 1; i++) doc.cookie = `${name}=; Path=/; Max-Age=0; Domain=.${parts.slice(i).join('.')}`;
}

/** Expire prefixed cookies and local-storage keys; storage access can throw in sandboxes. @complexity O(cookies + keys). */
export function purge(doc: Document, storage?: StoragePrefixes): void {
  if (!storage) return;
  for (const part of doc.cookie.split(/;\s*/)) {
    const name = part.split('=')[0]!;
    if (storage.cookies?.some(p => name.startsWith(p))) expireEverywhere(doc, name);
  }
  try {
    const local = doc.defaultView!.localStorage;
    for (const key of Object.keys(local)) if (storage.local?.some(p => key.startsWith(p))) local.removeItem(key);
  } catch { /* no storage: nothing to purge */ }
}

// MOVED-FROM: @jini-ai/cms consent/html/client.ts template release (ordered, each template consumed once).
// Follow-up (P4): delete the cms runtime once the consumer inserts this client.
/** Allowed inert tags become live, in authored order (async=false). Unknown labels stay inert.
 * @complexity O(inert tags). */
export function activateInert(doc: Document, { allowed, ran }: { allowed: Choices; ran: Set<Optional> }): void {
  doc.querySelectorAll<HTMLElement>(INERT).forEach(node => {
    const category = node.dataset.consentCategory as Optional;
    if (!OPTIONAL.includes(category) || !allowed[category]) return;
    ran.add(category);
    if (node.tagName === 'IFRAME') { node.setAttribute('src', node.dataset.src!); node.removeAttribute('data-src'); return; }
    node.replaceWith(liveScript(doc, node as HTMLScriptElement));
  });
}

function liveScript(doc: Document, inert: HTMLScriptElement): HTMLScriptElement {
  const s = doc.createElement('script');
  for (const { name, value } of Array.from(inert.attributes)) if (!SKIP.has(name)) s.setAttribute(name, value);
  if (inert.nonce) s.nonce = inert.nonce;              // owner-set CSPs keep working
  if (inert.dataset.type) s.type = inert.dataset.type;
  if (inert.dataset.src) s.src = inert.dataset.src; else s.text = inert.text;
  s.async = false;
  return s;
}

/** Footer links and the reopen button work for every banner mode, including "My own". */
export function installOpeners({ api, doc }: { api: JiniConsentApi; doc: Document }): void {
  doc.addEventListener('click', event => {
    if (!(event.target as Element).closest?.(OPENERS)) return;
    event.preventDefault();
    api.open();
  });
}

function readPicked(root: HTMLElement): Partial<Flags> {
  const picked: Partial<Flags> = {};
  for (const c of OPTIONAL) {
    const box = root.querySelector<HTMLInputElement>(`input[name="${c}"]`);
    if (box) picked[c] = box.checked;
  }
  return picked;
}

function syncInputs(root: HTMLElement, s: ConsentState): void {
  for (const c of OPTIONAL) {
    const box = root.querySelector<HTMLInputElement>(`input[name="${c}"]`);
    if (!box) continue;
    box.checked = s.choices[c];
    box.disabled = s.gpc && c !== 'functional';        // GPC-clamped categories cannot be ticked
  }
}

/** A durable grant that is still waiting for its receipt keeps the banner open with its alert. */
export const waiting = (s: ConsentState) => OPTIONAL.some(c => s.choices[c] && !s.allowed[c]);

/** Wire #jini-consent (renderBanner's markup) to the public API. @complexity O(1) per click. */
export function bindBanner({ api, doc }: { api: JiniConsentApi; doc: Document }): void {
  const root = doc.getElementById('jini-consent');
  if (!root) return;
  const alert = root.querySelector<HTMLElement>('[data-consent-error]');
  const show = (open: boolean) => { root.hidden = !open; api.setOpen({ open }); };
  const settle = (s: ConsentState) => {
    if (alert) alert.hidden = !waiting(s);
    if (!waiting(s)) show(false);
  };
  root.addEventListener('click', event => {
    const action = (event.target as Element).closest?.('[data-consent-action]')?.getAttribute('data-consent-action');
    if (!action) return;
    event.preventDefault();
    void api.set({ action: action as ConsentAction }, { choices: readPicked(root) }).then(settle);
  });
  root.addEventListener('keydown', event => { if (event.key === 'Escape' && api.get().status === 'set') show(false); });
  doc.addEventListener(OPEN_EVENT, () => { syncInputs(root, api.get()); show(true); root.querySelector('button')?.focus(); });
  api.subscribe({ listener: s => { syncInputs(root, s); if (alert && !alert.hidden && !waiting(s)) settle(s); } });
  syncInputs(root, api.get());
  show(api.get().status === 'pending');
}
