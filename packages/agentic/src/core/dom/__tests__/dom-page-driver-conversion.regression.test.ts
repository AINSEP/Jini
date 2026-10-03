import { afterEach, expect, it, vi } from 'vitest';
import { createDomPageDriver } from '../dom-page-driver.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('uses required root and page ports with live DOM identity or an optional pinned page', async () => {
  const root = document.createElement('main');
  root.innerHTML = '<section data-agent-page="overview"><button data-agent-element="save" data-agent-role="button">Save</button></section>';
  const navigate = vi.fn((_required: Record<string, never>) => {
    root.querySelector('section')!.setAttribute('data-agent-page', 'settings');
  });
  const pages = { settings: { label: 'Settings', navigate } };
  const driver = createDomPageDriver({ root, pages });
  const pinned = createDomPageDriver({ root, pages }, { currentPage: 'fixed' });

  expect(await driver.listPages({})).toEqual([{ id: 'settings', label: 'Settings' }]);
  expect(await driver.findElements({})).toEqual([{
    handle: 'save', role: 'button', label: 'Save', labelTruncated: false, page: 'overview',
  }]);
  expect((await pinned.findElements({}))[0]!.page).toBe('fixed');
  await expect(driver.navigate({ page: 'settings' })).resolves.toBeUndefined();
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledWith({});
  expect((await driver.findElements({}))[0]!.page).toBe('settings');
  expect((await pinned.findElements({}))[0]!.page).toBe('fixed');
  await expect(driver.navigate({ page: 'constructor' })).rejects.toThrow('"constructor" is not a published page');
  expect(navigate).toHaveBeenCalledTimes(1);
});

it('settles after two frames and cancels the timeout without producing a value', async () => {
  vi.useFakeTimers();
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  const driver = createDomPageDriver({ root: document.createElement('main'), pages: {} });
  const completed = vi.fn();
  const pending = driver.settle!({}).then(completed);

  frames.shift()!(0);
  await Promise.resolve();
  expect(completed).not.toHaveBeenCalled();
  frames.shift()!(16);
  await pending;
  expect(completed).toHaveBeenCalledTimes(1);
  expect(completed).toHaveBeenCalledWith(undefined);
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps the 120 ms ceiling when animation frames are suspended', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', () => 1);
  const driver = createDomPageDriver({ root: document.createElement('main'), pages: {} });
  const completed = vi.fn();
  const pending = driver.settle!({}).then(completed);

  await vi.advanceTimersByTimeAsync(119);
  expect(completed).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(completed).toHaveBeenCalledTimes(1);
  expect(completed).toHaveBeenCalledWith(undefined);
});

it('uses one macrotask when animation frames are unavailable', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', undefined);
  const driver = createDomPageDriver({ root: document.createElement('main'), pages: {} });
  const completed = vi.fn();
  const pending = driver.settle!({}).then(completed);

  expect(completed).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(0);
  await pending;
  expect(completed).toHaveBeenCalledTimes(1);
  expect(completed).toHaveBeenCalledWith(undefined);
});
