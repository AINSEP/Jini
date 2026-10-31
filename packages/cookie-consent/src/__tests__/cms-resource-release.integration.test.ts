// @vitest-environment jsdom
/** Contract between the real CMS resource gate and the browser bundle Tovu serves.
 * CONSENT_CLIENT_SOURCE=1 tests its production source entry when rebuilding is prohibited. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { gateConsentHtml } from '../../../cms/src/consent/html/gate.js';
import { config } from '../../../cms/src/consent/__tests__/fixtures.js';
import { renderBanner } from '../render/index.js';

const SRC = 'https://www.youtube.com/embed/dQw4w9WgXcQ';
const PAGE = `<!doctype html><html><head><title>Hero</title></head><body><main>
<iframe id="hero" src="${SRC}" title="Hero video" allow="autoplay" loading="lazy"></iframe>
<iframe id="second" src="${SRC}?start=30" title="Second video"></iframe>
</main></body></html>`;

beforeEach(() => {
  for (const part of document.cookie.split(';')) document.cookie = `${part.split('=')[0]!.trim()}=; Path=/; Max-Age=0`;
});
afterEach(() => {
  delete window.jiniConsent;
  delete window.jiniConsentQueue;
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

async function loadPage({ html = PAGE }: { html?: string } = {}, _options = {}) {
  const gated = gateConsentHtml({ html, config, record: null, regionMode: 'opt-in', gpc: false, endpoint: '/legacy-consent' });
  const page = new DOMParser().parseFromString(gated, 'text/html');
  // Test the gate's resource output with the replacement runtime. Legacy UI/CSP belong to
  // the old engine and cannot be installed alongside the new banner's config and lifecycle.
  page.querySelectorAll('#jini-consent, #jini-consent-config, [data-jini-consent-runtime], [data-jini-consent-style], meta[http-equiv="Content-Security-Policy"]').forEach(node => node.remove());
  const rendered = renderBanner({ mode: 'jini', client: { contract: 1, policy: '1', regionMode: 'opt-in' }, copy: {} }, { evidence: { mode: 'local' } });
  document.head.innerHTML = page.head.innerHTML + rendered.head;
  document.body.innerHTML = page.body.innerHTML + rendered.body;
  delete window.jiniConsent;
  delete window.jiniConsentQueue;
  if (process.env.CONSENT_CLIENT_SOURCE !== '1') {
    window.eval(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/client.min.js'), 'utf8'));
  } else {
    // Re-evaluate the actual published entry for a fresh page; no consent implementation is mocked.
    vi.resetModules();
    await import('../client.min.js');
  }
  return window.jiniConsent!;
}

async function click({ action }: { action: 'accept' | 'reject' }, _options = {}) {
  document.querySelector<HTMLButtonElement>(`#jini-consent [data-consent-action="${action}"]`)!.click();
  // The real banner binding settles its set() promise before hiding the banner.
  await vi.waitFor(() => expect(document.getElementById('jini-consent')!.hidden).toBe(true));
}

test('Accept releases real gate iframe templates immediately, in authored order, once', async () => {
  const api = await loadPage();
  expect(document.querySelector('iframe')).toBeNull();
  expect(document.querySelectorAll('template[data-jini-consent-resource][data-category="marketing"]')).toHaveLength(2);
  const released: string[] = [];
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node instanceof HTMLIFrameElement) released.push(node.id);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  try {
    await click({ action: 'accept' });
    const hero = document.querySelector<HTMLIFrameElement>('#hero');
    expect(hero?.getAttribute('src')).toBe(SRC);
    expect(hero?.getAttribute('title')).toBe('Hero video');
    expect(hero?.getAttribute('allow')).toBe('autoplay');
    expect(hero?.getAttribute('loading')).toBe('lazy');
    expect([...document.querySelectorAll('iframe')].map(node => node.id)).toEqual(['hero', 'second']);
    expect(document.querySelector('template[data-jini-consent-resource]')).toBeNull();
    await api.set({ action: 'accept' });
    expect(document.querySelector('#hero')).toBe(hero);
    expect(document.querySelectorAll('iframe')).toHaveLength(2);
    expect(released).toEqual(['hero', 'second']);
  } finally { observer.disconnect(); }
});

test('Reject keeps real gate iframe templates inert', async () => {
  await loadPage();
  await click({ action: 'reject' });
  expect(window.jiniConsent!.get().allowed.marketing).toBe(false);
  expect(document.querySelector('iframe')).toBeNull();
  expect(document.querySelectorAll('template[data-jini-consent-resource]')).toHaveLength(2);
});

test('a returning visitor is released at boot using the cookie written by real Accept', async () => {
  await loadPage();
  await click({ action: 'accept' });
  expect(document.cookie).toContain('jini_choices=');
  const api = await loadPage();
  expect(api.get().allowed.marketing).toBe(true);
  expect(document.querySelector<HTMLIFrameElement>('#hero')?.getAttribute('src')).toBe(SRC);
  expect(document.querySelectorAll('iframe')).toHaveLength(2);
  expect(document.querySelector('template[data-jini-consent-resource]')).toBeNull();
});

test('an unknown category stays blocked even after Accept', async () => {
  await loadPage({ html: PAGE.replace('id="hero"', 'id="hero" data-consent-category="unknown"') });
  await click({ action: 'accept' });
  expect(document.querySelector('#hero')).toBeNull();
  expect(document.querySelector<HTMLIFrameElement>('#second')?.getAttribute('src')).toBe(SRC + '?start=30');
  expect(document.querySelector('template[data-category="blocked"]')).not.toBeNull();
});

test('resource subtrees retain the gate strictest-category boundary', async () => {
  const html = PAGE.replace('<main>', '<main data-consent-category="functional">').replace('id="hero"', 'id="hero" data-consent-category="marketing"');
  const api = await loadPage({ html });
  expect(document.querySelector('template[data-category="marketing"]')).not.toBeNull();
  await api.set({ action: 'save' }, { choices: { functional: true, marketing: false } });
  expect(document.querySelector('iframe')).toBeNull();
  await click({ action: 'accept' });
  expect(document.querySelector<HTMLIFrameElement>('#hero')?.getAttribute('src')).toBe(SRC);
});
