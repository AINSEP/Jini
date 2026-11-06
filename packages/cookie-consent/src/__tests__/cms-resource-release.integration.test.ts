// @vitest-environment jsdom
/** Contract between provider-authored inert resources and the browser assets Tovu serves.
 * CONSENT_CLIENT_SOURCE=1 tests its production source entry when rebuilding is prohibited. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { renderBanner } from '../render/index.js';

const SRC = 'https://www.youtube.com/embed/dQw4w9WgXcQ';
const PAGE = `<!doctype html><html><head><title>Hero</title></head><body><main>
<template data-jini-consent-resource data-category="marketing"><iframe id="hero" src="${SRC}" title="Hero video" allow="autoplay" loading="lazy"></iframe></template>
<template data-jini-consent-resource data-category="marketing"><iframe id="second" src="${SRC}?start=30" title="Second video"></iframe></template>
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
  // Providers author inert templates themselves. The host never classifies or rewrites page HTML.
  const page = new DOMParser().parseFromString(html, 'text/html');
  const rendered = renderBanner({ mode: 'jini', client: { contract: 1, policy: '1', regionMode: 'opt-in' }, copy: {} }, { evidence: { mode: 'local' } });
  document.head.innerHTML = page.head.innerHTML + rendered.head;
  document.body.innerHTML = page.body.innerHTML + rendered.body;
  delete window.jiniConsent;
  delete window.jiniConsentQueue;
  if (process.env.CONSENT_CLIENT_SOURCE !== '1') {
    window.eval(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/client.min.js'), 'utf8'));
    window.eval(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/extensions.min.js'), 'utf8'));
  } else {
    // Re-evaluate the actual published entry for a fresh page; no consent implementation is mocked.
    vi.resetModules();
    await import('../client.min.js');
    await import('../extensions.min.js');
  }
  return window.jiniConsent!;
}

async function click({ action }: { action: 'accept' | 'reject' }, _options = {}) {
  document.querySelector<HTMLButtonElement>(`#jini-consent [data-consent-action="${action}"]`)!.click();
  // The real banner binding settles its set() promise before hiding the banner.
  await vi.waitFor(() => expect(document.getElementById('jini-consent')!.hidden).toBe(true));
}

test('Accept releases provider-authored iframe templates immediately, in authored order, once', async () => {
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

test('Reject keeps provider-authored iframe templates inert', async () => {
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
  await loadPage({ html: PAGE.replace('data-category="marketing"', 'data-category="unknown"') });
  await click({ action: 'accept' });
  expect(document.querySelector('#hero')).toBeNull();
  expect(document.querySelector<HTMLIFrameElement>('#second')?.getAttribute('src')).toBe(SRC + '?start=30');
  expect(document.querySelector('template[data-category="unknown"]')).not.toBeNull();
});

test('a provider-authored marketing resource stays denied inside a functional container', async () => {
  const html = PAGE.replace('<main>', '<main data-consent-category="functional">');
  const api = await loadPage({ html });
  expect(document.querySelector('template[data-category="marketing"]')).not.toBeNull();
  await api.set({ action: 'save' }, { choices: { functional: true, marketing: false } });
  expect(document.querySelector('iframe')).toBeNull();
  await click({ action: 'accept' });
  expect(document.querySelector<HTMLIFrameElement>('#hero')?.getAttribute('src')).toBe(SRC);
});
