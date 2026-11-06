// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { allows, validateScripts } from '../policy.js';
import { createCookieConsent } from '../client/index.js';

test('declarations use all effective permissions and reject unknown purposes', () => {
  const state = { allowed: { necessary: true, functional: true, analytics: false, marketing: true } };
  expect(allows({ state })).toBe(true);
  expect(allows({ state, consent: ['functional', 'marketing'] })).toBe(true);
  expect(allows({ state, consent: ['analytics', 'marketing'] })).toBe(false);
  expect(allows({ state, consent: ['unknown'] as never })).toBe(false);
  expect(validateScripts({ scripts: [{ src: '/menu.js' }, { src: 'https://example.com/pixel.js' }] }).problems).toEqual([]);
  expect(validateScripts({ scripts: [{ src: '/bad.js', consent: ['unknown'] }, { src: 'javascript:bad()' }] }).scripts).toEqual([]);
});

test('declared scripts start in order once; withdrawal while loading cancels the queue and reloads', async () => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.cookie = 'jini_choices=; Max-Age=0; Path=/';
  const reload = vi.fn();
  const api = createCookieConsent({ config: { contract: 1, policy: 'scripts', regionMode: 'opt-in', banner: 'headless', scripts: [
    { src: '/menu.js' }, { src: '/stats.js', consent: ['analytics'] }, { src: '/pixel.js', consent: ['analytics', 'marketing'] },
  ] }, ports: { doc: document, fetch: vi.fn(), now: Date.now, gpc: () => false, reload, importModule: vi.fn() } });
  const sources = () => [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src'));
  expect(sources()).toEqual(['/menu.js']);
  document.querySelector('script')!.dispatchEvent(new Event('load'));
  await api.set({ action: 'save' }, { choices: { analytics: true } });
  await Promise.resolve();
  expect(api.allows({ consent: ['analytics', 'marketing'] })).toBe(false);
  expect(sources()).toEqual(['/menu.js', '/stats.js']);
  await api.set({ action: 'reject' });
  expect(reload).toHaveBeenCalled();
  await api.set({ action: 'accept' });
  expect(sources().filter(s => s === '/stats.js')).toHaveLength(0);
});
