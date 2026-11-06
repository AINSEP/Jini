/** Smoke test of the shipped artifact: dist/client.min.js, not the source. CI builds before it tests
 * (`pnpm -r run build`); locally run `npm run build` first. */
import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { JSDOM, ResourceLoader, VirtualConsole } from 'jsdom';
import { describe, expect, test, vi } from 'vitest';
import { renderBanner } from '../render/index.js';

const BUNDLE = new URL('../../dist/client.min.js', import.meta.url);
const EXTENSIONS = new URL('../../dist/extensions.min.js', import.meta.url);
const FRAME_URL = 'https://docs.google.com/forms/d/e/Public_123/viewform?embedded=true';

/** Observe resource attempts without allowing the smoke page to make external requests. */
class BlockResources extends ResourceLoader {
  readonly frames: string[] = [];
  override fetch(url: string, options: Parameters<ResourceLoader['fetch']>[1]) {
    if (options.element?.tagName === 'IFRAME') this.frames.push(url);
    return null;
  }
}

/** A page as a host would serve it: rendered head/body, one inert analytics tag, one queued live adapter. */
function page({ extensionsFirst = false, frame = false }: { extensionsFirst?: boolean; frame?: boolean } = {}) {
  const { head, body } = renderBanner({ mode: 'jini', client: { contract: 1, policy: 'p1', regionMode: 'opt-in' }, copy: {} }, { evidence: { mode: 'local' } });
  const html = `<!doctype html><html><head>${head}</head><body>${body}
<script type="text/plain" data-consent-category="analytics">window.inertRan = (window.inertRan || 0) + 1;</script>
<script>window.grants = []; window.jiniConsentQueue = [{ id: 'fake', kind: 'consent-adapter', category: 'analytics',
  grant: function () { window.grants.push('grant'); return { revoke: function () { window.grants.push('revoke'); return true; } }; } }];</script>
${frame ? `<iframe data-src="${FRAME_URL}" data-jini-consent='["functional"]' title="Contact form" loading="lazy"></iframe>
<p data-form-fallback>If this form does not open, <a href="https://docs.google.com/forms/d/e/Public_123/viewform">open it on Google</a> or contact the site owner.</p>` : ''}
</body></html>`;
  // location.reload() is "not implemented" in jsdom; record it instead of printing it.
  const reloads: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error: Error) => { if (/navigation/.test(error.message)) reloads.push('reload'); else throw error; });
  const resources = new BlockResources();
  const dom = new JSDOM(html, { url: 'https://site.example/', runScripts: 'dangerously', virtualConsole, resources });
  const win = Object.assign(dom.window, { reloads }) as unknown as Window & typeof globalThis & { grants: string[]; inertRan?: number; reloads: string[]; eval(code: string): unknown };
  // jsdom has no fetch; every target browser does. Local evidence never calls it.
  win.fetch = (() => Promise.reject(new Error('no network in the smoke test'))) as typeof fetch;
  const ready = vi.fn();
  win.document.addEventListener('jini:consent-ready', ready);
  if (extensionsFirst) win.eval(readFileSync(EXTENSIONS, 'utf8'));
  win.eval(readFileSync(BUNDLE, 'utf8'));
  if (!extensionsFirst) win.eval(readFileSync(EXTENSIONS, 'utf8'));
  return Object.assign(win, { ready, frameRequests: resources.frames });
}
const click = (win: Window, selector: string) => (win.document.querySelector(selector) as HTMLElement).click();
const settle = () => new Promise(r => setTimeout(r, 20));

describe('dist/client.min.js', () => {
  test('is built', () => {
    expect(existsSync(BUNDLE), 'run `npm run build` in packages/cookie-consent first').toBe(true);
    const size = gzipSync(readFileSync(BUNDLE), { level: 9 }).length;
    expect(size).toBeLessThanOrEqual(4608);
    // Catch growth locally before esbuild/zlib version differences exhaust the build budget in CI.
    expect(4608 - size, `client.min.js is ${size} B gzipped; keep at least 32 B headroom under the 4608 B budget`).toBeGreaterThanOrEqual(32);
  });

  test('optional features stay within the same asset budget', () => {
    expect(existsSync(EXTENSIONS)).toBe(true);
    expect(gzipSync(readFileSync(EXTENSIONS), { level: 9 }).length).toBeLessThanOrEqual(4608);
  });

  test('boots from the page config, shows the banner and drains the queue without granting', () => {
    const win = page();
    expect(win.jiniConsent?.get().status).toBe('pending');
    expect(win.document.documentElement.getAttribute('data-consent')).toBe('pending');
    expect(win.document.documentElement.getAttribute('data-consent-region')).toBe('opt-in');
    expect((win.document.getElementById('jini-consent') as HTMLElement).hidden).toBe(false);
    expect(win.jiniConsent?.plugins.list({ kind: 'consent-adapter' }).map(p => p.id)).toEqual(['fake']);
    expect(win.grants).toEqual([]);
    expect(win.inertRan).toBeUndefined();
    expect(win.ready).toHaveBeenCalledTimes(1);
    expect((win.ready.mock.calls[0]![0] as CustomEvent).detail).toBe(win.jiniConsent);
  });

  test('extensions arriving before the core bind the same banner once READY fires', async () => {
    const win = page({ extensionsFirst: true });
    click(win, '#jini-consent [data-consent-action="accept"]');
    await settle();
    expect(win.jiniConsent?.get().allowed.analytics).toBe(true);
    expect(win.grants).toEqual(['grant']);
    expect(win.inertRan).toBe(1);
    expect((win.document.getElementById('jini-consent') as HTMLElement).hidden).toBe(true);
  });

  test('Accept grants the adapter, runs the inert tag, writes the cookie and closes the banner', async () => {
    const win = page();
    click(win, '#jini-consent .jini-consent-actions [data-consent-action="accept"]');
    await settle();
    expect(win.jiniConsent?.get().allowed.analytics).toBe(true);
    expect(win.grants).toEqual(['grant']);
    expect(win.inertRan).toBe(1);
    expect(win.document.cookie).toContain('jini_choices=');
    expect((win.document.getElementById('jini-consent') as HTMLElement).hidden).toBe(true);
  });

  test('Reject grants nothing; reopening and rejecting after Accept revokes the adapter', async () => {
    const rejected = page();
    click(rejected, '#jini-consent [data-consent-action="reject"]');
    await settle();
    expect(rejected.jiniConsent?.get()).toMatchObject({ status: 'set', action: 'reject' });
    expect(rejected.grants).toEqual([]);
    expect(rejected.inertRan).toBeUndefined();
    expect(rejected.reloads).toEqual([]);

    const changed = page();
    click(changed, '[data-consent-action="accept"]');
    await settle();
    // The raw inert tag already ran and cannot be stopped, so withdrawing analytics asks for a reload.
    click(changed, '.jini-consent-reopen');
    expect((changed.document.getElementById('jini-consent') as HTMLElement).hidden).toBe(false);
    click(changed, '#jini-consent .jini-consent-actions [data-consent-action="reject"]');
    await settle();
    expect(changed.grants).toEqual(['grant', 'revoke']);
    expect(changed.reloads).toEqual(['reload']);
    expect(changed.jiniConsent?.get().allowed.analytics).toBe(false);
  });

  test('declared form frames make no requests before functional permission, activate once and unload on withdrawal', async () => {
    const win = page({ frame: true });
    try {
      const frame = win.document.querySelector('iframe')!;
      const fallback = win.document.querySelector<HTMLElement>('[data-form-fallback]')!;
      await settle();
      expect(frame.hasAttribute('src')).toBe(false);
      expect(win.frameRequests).toEqual([]);
      expect(fallback.hidden).toBe(false);
      expect(fallback.textContent).toContain('If this form does not open, open it on Google or contact the site owner.');
      expect(fallback.querySelector('a')?.href).toBe('https://docs.google.com/forms/d/e/Public_123/viewform');

      await win.jiniConsent!.set({ action: 'save' }, { choices: { functional: true } });
      expect(frame.getAttribute('src')).toBe(FRAME_URL);
      expect(win.frameRequests).toEqual([FRAME_URL]);
      win.eval(readFileSync(EXTENSIONS, 'utf8'));
      await win.jiniConsent!.set({ action: 'save' }, { choices: { functional: true } });
      expect(win.frameRequests).toEqual([FRAME_URL]);

      await win.jiniConsent!.set({ action: 'withdraw' });
      expect(frame.hasAttribute('src')).toBe(false);
      expect(win.reloads).toEqual(['reload']);
      expect(fallback.hidden).toBe(false);
    } finally { win.close(); }
  });
});

test('duplicate extensions never start a declared script twice', async () => {
  const rendered = renderBanner({ mode: 'headless', client: { contract: 1, policy: 'p1', regionMode: 'opt-in', scripts: [{ src: '/stats.js', consent: ['analytics'] }] }, copy: {} });
  const dom = new JSDOM(`<html><head>${rendered.head}</head><body>${rendered.body}</body></html>`, { url: 'https://site.example/', runScripts: 'outside-only' });
  try {
    const win = dom.window as unknown as Window & typeof globalThis;
    win.fetch = vi.fn() as typeof fetch;
    win.eval(readFileSync(BUNDLE, 'utf8'));
    win.eval(readFileSync(EXTENSIONS, 'utf8'));
    await win.jiniConsent!.set({ action: 'accept' });
    expect(win.document.querySelectorAll('script[src="/stats.js"]')).toHaveLength(1);
    win.eval(readFileSync(EXTENSIONS, 'utf8'));
    expect(win.document.querySelectorAll('script[src="/stats.js"]')).toHaveLength(1);
  } finally { dom.window.close(); }
});
