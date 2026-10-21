import { describe, expect, it, vi } from 'vitest';
import { installLazyChatLoader } from '../../browser/lazy-loader.js';

function install(open: (args: { focus?: boolean }) => void) {
  const button = document.createElement('button');
  button.setAttribute('aria-label', 'Chat');
  document.body.replaceChildren(button);
  const load = vi.fn(async () => {});
  const loader = installLazyChatLoader({ button, resume: false, deepLink: false, loadingLabel: 'Loading', retryLabel: 'Retry', load, open });
  return { button, load, loader };
}

describe('lazy loader retry and activation keys', () => {
  it('retries a failed open without evaluating the chat script a second time', async () => {
    const open = vi.fn().mockImplementationOnce(() => { throw new Error('mount failed'); });
    const { button, load, loader } = install(open);
    await loader.activate({});
    expect(button.dataset.loadFailed).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Retry');
    await loader.activate({});
    expect(load).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(2);
    expect(button.hidden).toBe(true);
  });

  it('activates from Enter or Space but not from other keys', async () => {
    const open = vi.fn();
    const { button, load } = install(open);
    const other = new KeyboardEvent('keydown', { key: 'a', cancelable: true });
    button.dispatchEvent(other);
    await Promise.resolve();
    expect(other.defaultPrevented).toBe(false);
    expect(load).not.toHaveBeenCalled();
    const space = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
    button.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith({ focus: true }));
  });

  it('never opens a widget whose loader was disposed while its script was still loading', async () => {
    const button = document.createElement('button');
    button.setAttribute('aria-label', 'Chat');
    document.body.replaceChildren(button);
    let finishLoad!: () => void;
    const open = vi.fn();
    const loader = installLazyChatLoader({ button, resume: false, deepLink: false, loadingLabel: 'Loading', retryLabel: 'Retry',
      load: () => new Promise<void>(resolve => { finishLoad = resolve; }), open });
    const pending = loader.activate({});
    await vi.waitFor(() => expect(finishLoad).toBeTypeOf('function'));
    loader.dispose({});
    finishLoad();
    await pending;
    expect(open).not.toHaveBeenCalled();
    expect(button.hidden).toBe(false);
    expect(button.getAttribute('aria-label')).toBe('Chat');
  });

  it('does nothing once disposed', async () => {
    const { load, loader } = install(vi.fn());
    loader.dispose({});
    await loader.activate({});
    expect(load).not.toHaveBeenCalled();
  });
});
