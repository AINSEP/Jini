import { describe, it, expect, vi } from 'vitest';
import { installLazyChatLoader, loadChatAssets } from '../../browser/lazy-loader.js';

function setup(options: { resume?: boolean; deepLink?: boolean; preload?: boolean; load?: () => Promise<void> } = {}) {
  const button = document.createElement('button');
  document.body.replaceChildren(button);
  let loads = 0;
  let opens = 0;
  const loader = installLazyChatLoader({ button, resume: options.resume ?? false, deepLink: options.deepLink ?? false, preload: options.preload ?? false,
    loadingLabel: 'Loading chat', retryLabel: 'Retry chat',
    load: async () => { loads++; await options.load?.(); }, open: () => { opens++; } });
  return { button, loader, counts: () => ({ loads, opens }) };
}
describe('lazy visitor loader', () => {
  it('restores the placeholder label after loading and hands focus to the mounted widget', async () => {
    const button = document.createElement('button');
    button.setAttribute('aria-label', 'Chat with this site');
    button.innerHTML = '<span>Chat</span>';
    document.body.replaceChildren(button);
    const open = vi.fn();
    const loader = installLazyChatLoader({ button, resume: false, deepLink: false,
      loadingLabel: 'Loading chat…', retryLabel: 'Retry', load: async () => {}, open });
    const pending = loader.activate({});
    expect(button.getAttribute('aria-label')).toBe('Loading chat…');
    await pending;
    expect(button.getAttribute('aria-label')).toBe('Chat with this site');
    expect(button.innerHTML).toBe('<span>Chat</span>');
    expect(button.hasAttribute('aria-busy')).toBe(false);
    expect(button.hidden).toBe(true);
    expect(open).toHaveBeenCalledWith({ focus: true });
    loader.dispose({});
  });
  it('does not fetch for a closed conversation; first click loads once and opens', async () => {
    const fixture = setup();
    expect(fixture.counts()).toEqual({ loads: 0, opens: 0 });
    fixture.button.click();
    await fixture.loader.activate({});
    expect(fixture.counts()).toEqual({ loads: 1, opens: 1 });
    expect(fixture.button.hidden).toBe(true);
    fixture.loader.dispose({});
  });
  for (const key of ['Enter', ' ']) it(`activates from ${JSON.stringify(key)} without duplicate requests`, async () => {
    const fixture = setup();
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    fixture.button.dispatchEvent(event);
    fixture.button.click();
    await fixture.loader.activate({});
    expect(event.defaultPrevented).toBe(true);
    expect(fixture.counts()).toEqual({ loads: 1, opens: 1 });
    fixture.loader.dispose({});
  });
  for (const option of ['resume', 'deepLink'] as const) it(`loads immediately for ${option}`, async () => {
    const fixture = setup({ [option]: true });
    await fixture.loader.activate({});
    expect(fixture.counts()).toEqual({ loads: 1, opens: 1 });
    fixture.loader.dispose({});
  });
  it('preloads queued effects without opening, but an activation during preload opens once', async () => {
    const closed = setup({ preload: true });
    await closed.loader.activate({ open: false });
    expect(closed.counts()).toEqual({ loads: 1, opens: 0 });
    closed.loader.dispose({});
    const activated = setup({ preload: true });
    activated.button.click();
    await activated.loader.activate({});
    expect(activated.counts()).toEqual({ loads: 1, opens: 1 });
    activated.loader.dispose({});
  });
  it('keeps a failed load retryable and removes listeners on disposal', async () => {
    let attempts = 0;
    const fixture = setup({ load: async () => { if (++attempts === 1) throw new Error('offline'); } });
    await fixture.loader.activate({});
    expect(fixture.button.hidden).toBe(false);
    expect(fixture.button.getAttribute('aria-label')).toBe('Retry chat');
    await fixture.loader.activate({});
    expect(fixture.counts()).toEqual({ loads: 2, opens: 1 });
    fixture.loader.dispose({});
    fixture.button.click();
    await Promise.resolve();
    expect(fixture.counts()).toEqual({ loads: 2, opens: 1 });
  });
  it('loads the widget script only after CSS, and removes failed assets', async () => {
    document.head.replaceChildren();
    const pending = loadChatAssets({ document, scriptUrl: '/widget.js', styleUrl: '/widget.css' });
    expect(document.querySelector('script')).toBeNull();
    document.querySelector('link')!.dispatchEvent(new Event('load'));
    await Promise.resolve();
    expect(document.querySelector('script')!.getAttribute('src')).toBe('/widget.js');
    document.querySelector('script')!.dispatchEvent(new Event('error'));
    await expect(pending).rejects.toThrow('Chat assets could not be loaded');
    expect(document.head.children).toHaveLength(0);
  });
});


it('keeps the visible retry control when opening a mounted widget throws', async () => {
  const button = document.createElement('button');
  button.textContent = 'Open chat';
  document.body.replaceChildren(button);
  let attempts = 0;
  let loads = 0;
  const loader = installLazyChatLoader({ button, resume: false, deepLink: false,
    loadingLabel: 'Loading chat', retryLabel: 'Retry chat', load: async () => { loads++; },
    open: () => { if (++attempts <= 2) throw new Error('Mount failed'); } });
  const pending = loader.activate({});
  expect(button.textContent).toBe('Loading chat');
  await pending;
  expect(button.hidden).toBe(false);
  expect(button.textContent).toBe('Retry chat');
  expect(button.dataset.loadFailed).toBe('true');
  await loader.activate({});
  expect(button.hidden).toBe(false);
  expect(button.textContent).toBe('Retry chat');
  await loader.activate({});
  expect(button.hidden).toBe(true);
  expect(attempts).toBe(3);
  expect(loads).toBe(1);
  expect(button.dataset.loadFailed).toBeUndefined();
  loader.dispose({});
});

it('waits for widget mount after the classic script loads', async () => {
  document.head.replaceChildren();
  const mount = document.createElement('div');
  let ready = false;
  const pending = loadChatAssets({ document, mount, scriptUrl: '/widget.js', styleUrl: '/widget.css' }).then(() => { ready = true; });
  document.querySelector('link')!.dispatchEvent(new Event('load'));
  await Promise.resolve();
  document.querySelector('script')!.dispatchEvent(new Event('load'));
  await Promise.resolve();
  expect(ready).toBe(false);
  mount.dataset.chatMounted = 'true';
  mount.dispatchEvent(new Event('jini-chat-mounted'));
  await pending;
  expect(ready).toBe(true);
});

it('removes assets and reports an evaluated script that never mounts', async () => {
  vi.useFakeTimers();
  document.head.replaceChildren();
  try {
    const pending = loadChatAssets({ document, mount: document.createElement('div'), scriptUrl: '/widget.js', styleUrl: '/widget.css' });
    const rejected = expect(pending).rejects.toThrow('Chat widget did not mount');
    document.querySelector('link')!.dispatchEvent(new Event('load'));
    await Promise.resolve();
    document.querySelector('script')!.dispatchEvent(new Event('load'));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(document.head.children).toHaveLength(0);
  } finally { vi.useRealTimers(); }
});

for (const deepLink of [false, true]) it(`distinguishes restored focus from explicit deep-link intent ${deepLink}`, async () => {
  const button = document.createElement('button');
  document.body.replaceChildren(button);
  const focuses: boolean[] = [];
  const loader = installLazyChatLoader({ button, resume: !deepLink, deepLink, loadingLabel: 'Loading', retryLabel: 'Retry',
    load: async () => {}, open: ({ focus }) => { focuses.push(focus ?? false); } });
  await loader.activate({ open: false, focus: false });
  expect(focuses).toEqual([deepLink]);
  loader.dispose({});
});


it('does not reopen a ready widget when only preloading is requested', async () => {
  const f = setup();
  try {
    await f.loader.activate({});
    await f.loader.activate({ open: false });
    expect(f.counts()).toEqual({ loads: 1, opens: 1 });
    await f.loader.activate({});
    expect(f.counts()).toEqual({ loads: 1, opens: 2 });
  } finally { f.loader.dispose({}); }
});
