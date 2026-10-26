// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ADAPTER_KIND, CONSENT_COOKIE, type ClientConfig, type ConsentAdapter, type ConsentState, type Evidence, type StoredChoice } from '../contract.js';
import { boot, browserPorts, createCookieConsent, type ClientPorts } from '../client/index.js';
import { bindBanner } from '../client/dom.js';
import { parseStored } from '../policy.js';
import { renderBanner } from '../render/index.js';
import { readConsent } from '../server/index.js';

const NOW = 1_800_000_000_000;
const RECEIPT = 'receipt-accept-000001';
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };
const ok = (id: string) => ({ ok: true, json: async () => ({ id }) }) as unknown as Response;
const never = <T>() => new Promise<T>(() => undefined);
const cookieChoice = () => {
  const raw = document.cookie.split('; ').find(p => p.startsWith(`${CONSENT_COOKIE}=`));
  return raw ? parseStored({ raw: decodeURIComponent(raw.slice(CONSENT_COOKIE.length + 1)) }) : null;
};
const writeChoice = (s: StoredChoice) => { document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(s))}; Path=/`; };

function makePorts(over: Partial<ClientPorts> = {}) {
  return {
    doc: document, fetch: vi.fn(async () => ok(RECEIPT)), now: () => NOW, gpc: () => false,
    reload: vi.fn(), importModule: vi.fn(never), ...over,
  } as ClientPorts & { reload: ReturnType<typeof vi.fn>; fetch: ReturnType<typeof vi.fn>; importModule: ReturnType<typeof vi.fn> };
}
const config = (over: Partial<ClientConfig> = {}): ClientConfig => ({ contract: 1, policy: 'p1', regionMode: 'opt-in', banner: 'headless', ...over });
const DURABLE: Evidence = { mode: 'durable', endpoint: '/_consent', waitMs: 20 };
const adapter = (over: Partial<ConsentAdapter> = {}) =>
  ({ id: 'stats', kind: ADAPTER_KIND, category: 'analytics', grant: vi.fn(() => ({ revoke: () => true })), ...over }) as ConsentAdapter & { grant: ReturnType<typeof vi.fn> };

beforeEach(() => {
  for (const part of document.cookie.split('; ')) if (part) document.cookie = `${part.split('=')[0]}=; Path=/; Max-Age=0`;
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  for (const attr of ['data-consent', 'data-consent-region', 'data-consent-gpc', 'data-consent-open']) document.documentElement.removeAttribute(attr);
  delete window.jiniConsent;
  delete window.jiniConsentQueue;
});
afterEach(() => { vi.restoreAllMocks(); });

describe('grant and withdraw', () => {
  test('accept runs a live adapter; reject is applied before any await and needs no reload', async () => {
    const ports = makePorts();
    const api = createCookieConsent({ config: config(), ports });
    const stats = adapter();
    api.plugins.registerPlugin(stats as never);
    expect(stats.grant).not.toHaveBeenCalled();
    await api.set({ action: 'accept' });
    await flush();
    expect(stats.grant).toHaveBeenCalledTimes(1);
    expect(document.documentElement.getAttribute('data-consent')).toBe('set');

    const rejecting = api.set({ action: 'reject' });
    expect(api.get().allowed.analytics).toBe(false);          // synchronous: before the promise settles
    expect(cookieChoice()?.a).toBe('reject');
    await rejecting;
    await flush();
    expect(ports.reload).not.toHaveBeenCalled();
    expect(ports.fetch).not.toHaveBeenCalled();                // local evidence: no network at all
    expect(api.get().receipt).toBe('local');
  });

  test('withdrawal beats a delayed adapter import: vendor code never runs', async () => {
    let deliver!: (m: { default: ConsentAdapter }) => void;
    const ports = makePorts({ importModule: vi.fn(() => new Promise(resolve => { deliver = resolve; })) });
    const api = createCookieConsent({ config: config({ plugins: [{ id: 'slow', kind: ADAPTER_KIND, category: 'analytics', src: '/slow.mjs' }] }), ports });
    await api.set({ action: 'accept' });
    expect(ports.importModule).toHaveBeenCalledWith('/slow.mjs');
    const withdrawn = api.set({ action: 'reject' });
    const grant = vi.fn(() => ({ revoke: () => true }));
    deliver({ default: adapter({ id: 'slow', grant }) });
    await withdrawn;
    await flush();
    expect(grant).not.toHaveBeenCalled();
    expect(ports.reload).not.toHaveBeenCalled();
  });

  test('a hung adapter import or a hung grant never blocks Reject', async () => {
    const ports = makePorts();
    const api = createCookieConsent({ config: config({ plugins: [{ id: 'hung', kind: ADAPTER_KIND, category: 'analytics', src: '/hung.mjs' }] }), ports });
    api.plugins.registerPlugin(adapter({ id: 'stuck', category: 'marketing', grant: vi.fn(never) }) as never);
    await api.set({ action: 'accept' });
    const outcome = await Promise.race([api.set({ action: 'reject' }).then(() => 'rejected'), new Promise(r => setTimeout(() => r('blocked'), 50))]);
    expect(outcome).toBe('rejected');
    expect(api.get().allowed).toEqual({ necessary: true, functional: false, analytics: false, marketing: false });
  });

  test('an adapter that cannot revoke cleanly, or throws, forces one reload; storage is purged', async () => {
    document.cookie = '_stats_id=1; Path=/';
    localStorage.setItem('_stats_queue', 'x');
    localStorage.setItem('keep', 'y');
    const ports = makePorts();
    const api = createCookieConsent({ config: config(), ports });
    api.plugins.registerPlugin(adapter({ grant: vi.fn(() => ({ revoke: () => false })), storage: { cookies: ['_stats_'], local: ['_stats_'] } }) as never);
    api.plugins.registerPlugin(adapter({ id: 'thrower', category: 'marketing', grant: vi.fn(() => { throw new Error('vendor bug'); }) }) as never);
    await api.set({ action: 'accept' });
    await flush();
    await api.set({ action: 'reject' });
    await flush();
    expect(ports.reload).toHaveBeenCalledTimes(1);
    expect(document.cookie).not.toContain('_stats_id');
    expect(localStorage.getItem('_stats_queue')).toBeNull();
    expect(localStorage.getItem('keep')).toBe('y');
  });

  test('a grant that saw the abort and returned null needs no reload', async () => {
    const ports = makePorts();
    const api = createCookieConsent({ config: config(), ports });
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    api.plugins.registerPlugin(adapter({ grant: vi.fn(async ({ signal }) => { await gate; return signal.aborted ? null : { revoke: () => true }; }) }) as never);
    await api.set({ action: 'accept' });
    await flush();
    await api.set({ action: 'reject' });
    release();
    await flush();
    expect(ports.reload).not.toHaveBeenCalled();
  });

  test('unregistering a running adapter stops it; a denied adapter is purged at registration', async () => {
    document.cookie = '_old_id=1; Path=/';
    const ports = makePorts();
    const api = createCookieConsent({ config: config(), ports });
    api.plugins.registerPlugin(adapter({ id: 'old', storage: { cookies: ['_old_'] } }) as never);
    expect(document.cookie).not.toContain('_old_id');
    const revoke = vi.fn(() => true);
    const dispose = api.plugins.registerPlugin(adapter({ id: 'live', grant: vi.fn(() => ({ revoke })) }) as never);
    await api.set({ action: 'accept' });
    await flush();
    dispose();
    await flush();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(ports.reload).not.toHaveBeenCalled();
  });

  test('a throwing listener or onState never blocks consent', async () => {
    const ports = makePorts();
    const api = createCookieConsent({ config: config(), ports });
    api.plugins.registerPlugin(adapter({ onState: () => { throw new Error('bad onState'); } }) as never);
    const off = api.subscribe({ listener: () => { throw new Error('bad listener'); } });
    const seen: ConsentState[] = [];
    api.subscribe({ listener: s => seen.push(s) });
    document.addEventListener('jini:consent', () => undefined);
    await api.set({ action: 'reject' });
    off();
    expect(seen.at(-1)?.action).toBe('reject');
  });
});

describe('durable evidence', () => {
  test('a grant waits for its receipt; the cookie then carries the receipt id', async () => {
    let answer!: (r: Response) => void;
    const ports = makePorts({ fetch: vi.fn(() => new Promise<Response>(r => { answer = r; })) });
    const api = createCookieConsent({ config: config(), ports }, { evidence: DURABLE });
    const stats = adapter();
    api.plugins.registerPlugin(stats as never);
    await api.set({ action: 'accept' });                       // waitMs elapses: still no receipt
    expect(api.get().choices.analytics).toBe(true);
    expect(api.get().allowed.analytics).toBe(false);
    expect(api.get().receipt).toBe('pending');
    await flush();
    expect(stats.grant).not.toHaveBeenCalled();
    const body = JSON.parse(ports.fetch.mock.calls[0]![1].body as string);
    expect(body).toMatchObject({ policy: 'p1', action: 'accept', gpc: false });

    answer(ok(RECEIPT));
    await flush();
    expect(api.get().allowed.analytics).toBe(true);
    expect(api.get().receipt).toBe('stored');
    expect(cookieChoice()).toMatchObject({ a: 'accept', r: RECEIPT });
    expect(cookieChoice()?.q).toBeUndefined();
    expect(stats.grant).toHaveBeenCalledTimes(1);
  });

  test('a late Accept receipt can never re-grant after a newer Reject', async () => {
    let lateAccept!: (r: Response) => void;
    const fetch = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>(r => { lateAccept = r; }))
      .mockImplementation(async () => ok('receipt-reject-000001'));
    const ports = makePorts({ fetch });
    const api = createCookieConsent({ config: config(), ports }, { evidence: DURABLE });
    const stats = adapter();
    api.plugins.registerPlugin(stats as never);
    await api.set({ action: 'accept' });
    await api.set({ action: 'reject' });
    lateAccept(ok(RECEIPT));
    await flush();
    expect(api.get().action).toBe('reject');
    expect(api.get().allowed.analytics).toBe(false);
    expect(stats.grant).not.toHaveBeenCalled();
    expect(cookieChoice()).toMatchObject({ a: 'reject', r: 'receipt-reject-000001' });
    expect(JSON.parse(fetch.mock.calls[1]![1].body as string).previousId).toBeUndefined();
    // The next page load agrees.
    const next = createCookieConsent({ config: config(), ports: makePorts() }, { evidence: DURABLE });
    expect(next.get().allowed.analytics).toBe(false);
  });

  test('a newer choice from another tab beats this tab\'s late receipt and is adopted', async () => {
    let late!: (r: Response) => void;
    const ports = makePorts({ fetch: vi.fn(() => new Promise<Response>(r => { late = r; })) });
    const api = createCookieConsent({ config: config(), ports }, { evidence: DURABLE });
    await api.set({ action: 'accept' });
    writeChoice({ v: 1, p: 'p1', c: { functional: false, analytics: false, marketing: false }, t: NOW + 5, a: 'reject', r: 'receipt-othertab-0001' });
    late(ok(RECEIPT));
    await flush();
    expect(api.get().action).toBe('reject');
    expect(cookieChoice()?.r).toBe('receipt-othertab-0001');
  });

  test('a failed receipt keeps the choice pending and is retried on the next page load', async () => {
    const failing = makePorts({ fetch: vi.fn(async () => ({ ok: false, json: async () => ({}) }) as unknown as Response) });
    const api = createCookieConsent({ config: config(), ports: failing }, { evidence: DURABLE });
    await api.set({ action: 'accept' });
    await flush();
    expect(cookieChoice()?.q).toBe(1);
    expect(api.get().allowed.analytics).toBe(false);
    const retry = makePorts();
    const next = createCookieConsent({ config: config(), ports: retry }, { evidence: DURABLE });
    await flush();
    expect(retry.fetch).toHaveBeenCalledTimes(1);
    expect(next.get().allowed.analytics).toBe(true);
  });

  test('an invalid receipt id from the server is not trusted', async () => {
    const ports = makePorts({ fetch: vi.fn(async () => ok('../../x')) });
    const api = createCookieConsent({ config: config(), ports }, { evidence: DURABLE });
    await api.set({ action: 'accept' });
    await flush();
    expect(api.get().allowed.analytics).toBe(false);
  });

  test('a previous receipt id is sent so the server can retire it', async () => {
    writeChoice({ v: 1, p: 'p1', c: { functional: true, analytics: true, marketing: true }, t: NOW - 10, a: 'accept', r: RECEIPT });
    const ports = makePorts({ fetch: vi.fn(async () => ok('receipt-withdraw-0001')) });
    const api = createCookieConsent({ config: config(), ports }, { evidence: DURABLE });
    await api.set({ action: 'withdraw' });
    await flush();
    expect(JSON.parse(ports.fetch.mock.calls[0]![1].body as string).previousId).toBe(RECEIPT);
  });
});

describe('GPC and region in the browser', () => {
  test('GPC clamps an Accept; nothing can lift it', async () => {
    const api = createCookieConsent({ config: config(), ports: makePorts({ gpc: () => true }) });
    await api.set({ action: 'accept' });
    expect(api.get().allowed).toEqual({ necessary: true, functional: true, analytics: false, marketing: false });
    await api.set({ action: 'save' }, { choices: { analytics: true, marketing: true } });
    expect(api.get().allowed.marketing).toBe(false);
    expect(document.documentElement.hasAttribute('data-consent-gpc')).toBe(true);
  });

  test('region auto: no region cookie = strict; the server-set "us" cookie = opt-out defaults', () => {
    const strict = createCookieConsent({ config: config({ regionMode: 'auto' }), ports: makePorts() });
    expect(strict.get().region).toBe('opt-in');
    expect(strict.get().allowed.analytics).toBe(false);
    document.cookie = 'jini_region=us; Path=/';
    const us = createCookieConsent({ config: config({ regionMode: 'auto' }), ports: makePorts() }, { evidence: DURABLE });
    expect(us.get().region).toBe('opt-out');
    expect(us.get().allowed.analytics).toBe(true);
    expect(document.documentElement.getAttribute('data-consent-region')).toBe('opt-out');
  });

  test('effective() parity: the server read and the browser agree on the same cookie', () => {
    const cases: StoredChoice[] = [
      { v: 1, p: 'p1', c: { functional: true, analytics: true, marketing: true }, t: NOW - 5, a: 'accept', r: RECEIPT },
      { v: 1, p: 'p1', c: { functional: true, analytics: true, marketing: false }, t: NOW - 5, a: 'save', q: 1 },
      { v: 1, p: 'p0', c: { functional: true, analytics: true, marketing: true }, t: NOW - 5, a: 'accept', r: RECEIPT },
      { v: 1, p: 'p1', c: { functional: true, analytics: false, marketing: false }, t: NOW - 5, a: 'do-not-sell', r: RECEIPT },
    ];
    for (const stored of cases) for (const gpc of [false, true]) for (const region of [null, 'us']) {
      document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(stored))}; Path=/`;
      document.cookie = region ? `jini_region=${region}; Path=/` : 'jini_region=; Path=/; Max-Age=0';
      const browser = createCookieConsent({ config: config({ regionMode: 'auto' }), ports: makePorts({ gpc: () => gpc }) }, { evidence: DURABLE }).get();
      const server = readConsent({ cookieHeader: document.cookie, policy: 'p1', regionMode: 'auto' }, { secGpc: gpc ? '1' : null, nowMs: NOW });
      expect(server).toEqual(browser);
    }
  });
});

describe('inert tags', () => {
  test('allowed inert scripts and iframes go live in order; revoking a raw script reloads', async () => {
    document.body.innerHTML = '<script type="text/plain" data-consent-category="analytics" data-type="module" nonce="n1" id="a">window.ranA = 1</script>'
      + '<script type="text/plain" data-consent-category="marketing" data-src="https://ads.example/tag.js" id="m"></script>'
      + '<script type="text/plain" data-consent-category="unknown" id="u"></script>'
      + '<iframe data-consent-category="functional" data-src="https://video.example/embed" id="f"></iframe>';
    const ports = makePorts();
    const api = createCookieConsent({ config: config(), ports });
    expect(document.getElementById('a')!.getAttribute('type')).toBe('text/plain');
    await api.set({ action: 'save' }, { choices: { analytics: true, functional: true } });
    const live = document.getElementById('a') as HTMLScriptElement;
    expect(live.type).toBe('module');
    expect(live.text).toBe('window.ranA = 1');
    expect(live.hasAttribute('data-consent-category')).toBe(false);
    expect(document.getElementById('m')!.getAttribute('type')).toBe('text/plain');
    expect(document.getElementById('u')!.getAttribute('type')).toBe('text/plain');
    expect(document.getElementById('f')!.getAttribute('src')).toBe('https://video.example/embed');
    await api.set({ action: 'accept' });
    expect((document.getElementById('m') as HTMLScriptElement).src).toBe('https://ads.example/tag.js');
    expect(ports.reload).not.toHaveBeenCalled();
    await api.set({ action: 'reject' });
    await flush();
    expect(ports.reload).toHaveBeenCalledTimes(1);
  });
});

describe('boot, queue and banner', () => {
  const page = (mode: 'jini' | 'headless') => {
    const out = renderBanner({ mode, client: { contract: 1, policy: 'p1', regionMode: 'opt-in' }, copy: { title: 'Cookies here' } }, { evidence: { mode: 'local' } });
    document.head.innerHTML = out.head;
    document.body.innerHTML = `${out.body}<a href="#privacy-choices" id="footer">Your privacy choices</a>`;
  };

  test('boot installs window.jiniConsent, drains the pre-boot queue and drives the Jini banner', async () => {
    page('jini');
    const grant = vi.fn(() => ({ revoke: () => true }));
    window.jiniConsentQueue = [{ id: 'queued', kind: ADAPTER_KIND, category: 'analytics', grant }] as never;
    const ready = vi.fn();
    document.addEventListener('jini:consent-ready', ready);
    const api = boot(window, { ports: makePorts(), bindBanner })!;
    expect(window.jiniConsent).toBe(api);
    expect(boot(window)).toBe(api);                            // idempotent
    expect(ready).toHaveBeenCalledTimes(1);
    const banner = document.getElementById('jini-consent')!;
    expect(banner.hidden).toBe(false);
    expect(document.documentElement.hasAttribute('data-consent-open')).toBe(true);

    banner.querySelector<HTMLInputElement>('input[name="analytics"]')!.checked = true;
    banner.querySelector<HTMLButtonElement>('[data-consent-action="save"]')!.click();
    await flush();
    expect(api.get().action).toBe('save');
    expect(api.get().allowed).toEqual({ necessary: true, functional: false, analytics: true, marketing: false });
    expect(grant).toHaveBeenCalledTimes(1);
    expect(banner.hidden).toBe(true);
    expect(document.documentElement.hasAttribute('data-consent-open')).toBe(false);

    window.jiniConsentQueue!.push({ id: 'late', kind: ADAPTER_KIND, category: 'analytics', grant } as never);
    await flush();
    expect(grant).toHaveBeenCalledTimes(2);

    document.getElementById('footer')!.click();                // footer link reopens
    expect(banner.hidden).toBe(false);
    expect(banner.querySelector<HTMLInputElement>('input[name="analytics"]')!.checked).toBe(true);
    banner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(banner.hidden).toBe(true);
    banner.querySelector<HTMLButtonElement>('[data-consent-action="reject"]')!.click();
    await flush();
    expect(api.get().allowed.analytics).toBe(false);
  });

  test('while the banner is open, other clicks keep their default (links navigate, preferences expand)', () => {
    page('jini');
    document.body.insertAdjacentHTML('beforeend', '<a href="/blog" id="nav">Blog</a>');
    boot(window, { ports: makePorts(), bindBanner });
    expect(document.documentElement.hasAttribute('data-consent-open')).toBe(true);
    const clicks = [document.getElementById('nav')!, document.querySelector('#jini-consent summary')!].map(el => {
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      el.dispatchEvent(click);
      return click.defaultPrevented;
    });
    expect(clicks).toEqual([false, false]);
  });

  test('a durable grant without a receipt keeps the banner open with its alert until the receipt lands', async () => {
    page('jini');
    const node = document.getElementById('jini-consent-config')!;
    node.textContent = JSON.stringify({ ...JSON.parse(node.textContent!), evidence: DURABLE });
    let answer!: (r: Response) => void;
    const api = boot(window, { ports: makePorts({ fetch: vi.fn(() => new Promise<Response>(r => { answer = r; })) }), bindBanner })!;
    const banner = document.getElementById('jini-consent')!;
    banner.querySelector<HTMLButtonElement>('[data-consent-action="accept"]')!.click();
    await new Promise(r => setTimeout(r, 40));
    expect(banner.hidden).toBe(false);
    expect(banner.querySelector<HTMLElement>('[data-consent-error]')!.hidden).toBe(false);
    answer(ok(RECEIPT));
    await flush();
    expect(api.get().receipt).toBe('stored');
    expect(banner.hidden).toBe(true);
  });

  test('a "My own" banner drives the same API; a GPC visitor gets locked boxes in the Jini banner', async () => {
    page('headless');
    expect(document.getElementById('jini-consent')).toBeNull();
    const api = boot(window, { ports: makePorts() })!;
    const opened = vi.fn();
    document.addEventListener('jini:consent-open', opened);
    document.getElementById('footer')!.click();
    expect(opened).toHaveBeenCalled();                           // earlier tests' boots also listen on this document
    await api.set({ action: 'do-not-sell' });
    expect(api.get().allowed).toEqual({ necessary: true, functional: true, analytics: false, marketing: false });

    delete window.jiniConsent;
    page('jini');
    boot(window, { ports: makePorts({ gpc: () => true }), bindBanner });
    expect(document.querySelector<HTMLInputElement>('input[name="marketing"]')!.disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[name="functional"]')!.disabled).toBe(false);
  });

  test('a missing or broken config installs nothing (fail closed)', () => {
    expect(boot(window)).toBeUndefined();
    document.head.innerHTML = '<script type="application/json" id="jini-consent-config">{broken</script>';
    expect(boot(window)).toBeUndefined();
    expect(window.jiniConsent).toBeUndefined();
    expect(() => bindBanner({ api: createCookieConsent({ config: config(), ports: makePorts() }), doc: document })).not.toThrow();
  });

  test('cross-tab: a choice made in another tab is adopted when this page becomes visible', async () => {
    const api = createCookieConsent({ config: config(), ports: makePorts() });
    writeChoice({ v: 1, p: 'p1', c: { functional: true, analytics: true, marketing: true }, t: NOW - 1, a: 'accept' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(api.get().action).toBe('accept');
    window.dispatchEvent(new Event('pageshow'));
    expect(api.get().action).toBe('accept');
  });

  test('browserPorts reads GPC from navigator and binds fetch', () => {
    const ports = browserPorts(window);
    expect(ports.doc).toBe(document);
    expect(ports.gpc()).toBe(false);
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
    expect(ports.gpc()).toBe(true);
    expect(typeof ports.now()).toBe('number');
  });
});
