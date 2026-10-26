/** Smoke test of the shipped artifact: dist/client.min.js, not the source. CI builds before it tests
 * (`pnpm -r run build`); locally run `npm run build` first. */
import { existsSync, readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { describe, expect, test } from 'vitest';
import { renderBanner } from '../render/index.js';

const BUNDLE = new URL('../../dist/client.min.js', import.meta.url);

/** A page as a host would serve it: rendered head/body, one inert analytics tag, one queued live adapter. */
function page() {
  const { head, body } = renderBanner({ mode: 'jini', client: { contract: 1, policy: 'p1', regionMode: 'opt-in' }, copy: {} }, { evidence: { mode: 'local' } });
  const html = `<!doctype html><html><head>${head}</head><body>${body}
<script type="text/plain" data-consent-category="analytics">window.inertRan = (window.inertRan || 0) + 1;</script>
<script>window.grants = []; window.jiniConsentQueue = [{ id: 'fake', kind: 'consent-adapter', category: 'analytics',
  grant: function () { window.grants.push('grant'); return { revoke: function () { window.grants.push('revoke'); return true; } }; } }];</script>
</body></html>`;
  // location.reload() is "not implemented" in jsdom; record it instead of printing it.
  const reloads: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error: Error) => { if (/navigation/.test(error.message)) reloads.push('reload'); else throw error; });
  const dom = new JSDOM(html, { url: 'https://site.example/', runScripts: 'dangerously', virtualConsole });
  const win = Object.assign(dom.window, { reloads }) as unknown as Window & typeof globalThis & { grants: string[]; inertRan?: number; reloads: string[]; eval(code: string): unknown };
  // jsdom has no fetch; every target browser does. Local evidence never calls it.
  win.fetch = (() => Promise.reject(new Error('no network in the smoke test'))) as typeof fetch;
  win.eval(readFileSync(BUNDLE, 'utf8'));
  return win;
}
const click = (win: Window, selector: string) => (win.document.querySelector(selector) as HTMLElement).click();
const settle = () => new Promise(r => setTimeout(r, 20));

describe('dist/client.min.js', () => {
  test('is built', () => {
    expect(existsSync(BUNDLE), 'run `npm run build` in packages/cookie-consent first').toBe(true);
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
  });

  test('Accept grants the adapter, runs the inert tag, writes the cookie and closes the banner', async () => {
    const win = page();
    click(win, '#jini-consent .jini-consent-actions [data-consent-action="accept"]');
    await settle();
    expect(win.jiniConsent?.get().allowed.analytics).toBe(true);
    expect(win.grants).toEqual(['grant']);
    expect(win.inertRan).toBe(1);
    expect(win.document.cookie).toContain('jini_consent=');
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
});
