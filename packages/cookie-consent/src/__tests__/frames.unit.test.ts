// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { createCookieConsent } from '../client/index.js';

beforeEach(() => {
  for (const part of document.cookie.split('; ')) document.cookie = `${part.split('=')[0]}=; Path=/; Max-Age=0`;
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

test('declared frames use all effective permissions, activate once, and unload before withdrawal reload', async () => {
  document.body.innerHTML = `<iframe data-src="https://docs.google.com/forms/d/e/dummy/viewform?embedded=true" data-jini-consent='["functional","marketing"]'></iframe>`;
  const frame = document.querySelector('iframe')!;
  const reload = vi.fn(() => expect(frame.hasAttribute('src')).toBe(false));
  const api = createCookieConsent({ config: { contract: 1, policy: 'frames', regionMode: 'opt-in', banner: 'headless' },
    ports: { doc: document, fetch: vi.fn(), now: Date.now, gpc: () => false, reload, importModule: vi.fn() } });
  expect(frame.hasAttribute('src')).toBe(false);
  await api.set({ action: 'save' }, { choices: { functional: true } });
  expect(frame.hasAttribute('src')).toBe(false);
  await api.set({ action: 'save' }, { choices: { functional: true, marketing: true } });
  expect(frame.getAttribute('src')).toBe(frame.dataset.src);
  const mutations = vi.spyOn(frame, 'setAttribute');
  await api.set({ action: 'accept' });
  expect(mutations).not.toHaveBeenCalledWith('src', expect.anything());
  await api.set({ action: 'reject' });
  expect(frame.hasAttribute('src')).toBe(false);
  expect(reload).toHaveBeenCalledTimes(1);
  await api.set({ action: 'accept' });
  expect(frame.hasAttribute('src')).toBe(false);
});

test('unknown or malformed declarations stay inert and ordinary delivered frames are untouched', async () => {
  document.body.innerHTML = `<iframe id="unknown" data-src="/unknown" data-jini-consent='["unknown"]'></iframe><iframe id="broken" data-src="/broken" data-jini-consent='broken'></iframe><iframe id="off" src="/off"></iframe>`;
  const api = createCookieConsent({ config: { contract: 1, policy: 'frames', regionMode: 'opt-in', banner: 'headless' },
    ports: { doc: document, fetch: vi.fn(), now: Date.now, gpc: () => false, reload: vi.fn(), importModule: vi.fn() } });
  await api.set({ action: 'accept' });
  expect(document.querySelector('#unknown')?.hasAttribute('src')).toBe(false);
  expect(document.querySelector('#broken')?.hasAttribute('src')).toBe(false);
  expect(document.querySelector('#off')?.getAttribute('src')).toBe('/off');
});

test('a mixed script and frame withdrawal finishes cleanup before one shared reload', async () => {
  document.body.innerHTML = `<iframe data-src="/form" data-jini-consent='["functional"]'></iframe>`;
  const frame = document.querySelector('iframe')!;
  const reload = vi.fn(() => {
    expect(frame.hasAttribute('src')).toBe(false);
    expect(document.querySelector('script[src="/feature.js"]')).toBeNull();
  });
  const api = createCookieConsent({ config: { contract: 1, policy: 'mixed', regionMode: 'opt-in', banner: 'headless', scripts: [{ src: '/feature.js', consent: ['functional'] }] },
    ports: { doc: document, fetch: vi.fn(), now: Date.now, gpc: () => false, reload, importModule: vi.fn() } });
  await api.set({ action: 'accept' });
  expect(frame.getAttribute('src')).toBe('/form');
  expect(document.querySelector('script[src="/feature.js"]')).not.toBeNull();
  await api.set({ action: 'reject' });
  expect(reload).toHaveBeenCalledTimes(1);
});
