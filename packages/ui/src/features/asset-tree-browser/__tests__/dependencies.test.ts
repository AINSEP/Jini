// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBrowserAssetTreeClipboardPort,
  createBrowserAssetTreeDependencies,
  createBrowserAssetTreeDomBridgePort,
  createFakeAssetTreeDependencies,
} from '../dependencies.js';

describe('createBrowserAssetTreeClipboardPort', () => {
  const originalClipboard = navigator.clipboard;
  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
  });

  it('delegates to the real copyToClipboard implementation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const port = createBrowserAssetTreeClipboardPort();
    await expect(port.copyToClipboard({ text: 'hello' })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });
});

describe('createBrowserAssetTreeDomBridgePort', () => {
  it('getViewportHeight reads the real window height', () => {
    const dom = createBrowserAssetTreeDomBridgePort();
    expect(dom.getViewportHeight()).toBe(window.innerHeight);
  });

  it('subscribeOutsideDismiss fires onDismiss on an outside pointerdown and on Escape', () => {
    const dom = createBrowserAssetTreeDomBridgePort();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onDismiss = vi.fn();
    const unsubscribe = dom.subscribeOutsideDismiss({ current: container }, onDismiss);

    // jsdom in this package's pinned version has no `PointerEvent`
    // constructor — a plain bubbling `Event` of type `pointerdown` is enough
    // to exercise the real listener `subscribeOutsideClickOrEscape` installs.
    container.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onDismiss).toHaveBeenCalledTimes(2);

    unsubscribe();
    document.body.removeChild(container);
  });

  it('subscribeGlobalPaste forwards non-empty pasted files', () => {
    const dom = createBrowserAssetTreeDomBridgePort();
    const onFiles = vi.fn();
    const unsubscribe = dom.subscribeGlobalPaste(onFiles);
    const file = new File(['x'], 'x.png');
    const event = new Event('paste') as unknown as ClipboardEvent & { clipboardData: DataTransfer };
    Object.defineProperty(event, 'clipboardData', { value: { files: [file], items: [] } });
    window.dispatchEvent(event);
    expect(onFiles).toHaveBeenCalledWith([file]);
    unsubscribe();
  });

  it('subscribeGlobalPaste ignores a paste landing on a text-entry target', () => {
    const dom = createBrowserAssetTreeDomBridgePort();
    const onFiles = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    const unsubscribe = dom.subscribeGlobalPaste(onFiles);
    const file = new File(['x'], 'x.png');
    const event = new Event('paste') as unknown as ClipboardEvent & { clipboardData: DataTransfer };
    Object.defineProperty(event, 'clipboardData', { value: { files: [file], items: [] } });
    Object.defineProperty(event, 'target', { value: input });
    window.dispatchEvent(event);
    expect(onFiles).not.toHaveBeenCalled();
    unsubscribe();
    document.body.removeChild(input);
  });

  it('subscribeGlobalPaste is silent when the paste carries no files', () => {
    const dom = createBrowserAssetTreeDomBridgePort();
    const onFiles = vi.fn();
    const unsubscribe = dom.subscribeGlobalPaste(onFiles);
    const event = new Event('paste') as unknown as ClipboardEvent & { clipboardData: DataTransfer | null };
    Object.defineProperty(event, 'clipboardData', { value: null });
    window.dispatchEvent(event);
    expect(onFiles).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe('createBrowserAssetTreeDependencies', () => {
  it('binds real clipboard and dom bridge ports', () => {
    const deps = createBrowserAssetTreeDependencies();
    expect(deps.clipboard).toBeDefined();
    expect(deps.dom).toBeDefined();
    expect(deps.dom.getViewportHeight()).toBe(window.innerHeight);
  });
});

describe('createFakeAssetTreeDependencies', () => {
  it('defaults to a successful copy and inert DOM subscriptions', async () => {
    const deps = createFakeAssetTreeDependencies();
    await expect(deps.clipboard.copyToClipboard({ text: 'x' })).resolves.toBe(true);
    expect(deps.dom.getViewportHeight()).toBe(768);
    expect(() => deps.dom.subscribeOutsideDismiss(undefined, () => {})()).not.toThrow();
    expect(() => deps.dom.subscribeGlobalPaste(() => {})()).not.toThrow();
  });

  it('honors an overridden copyToClipboardResult', async () => {
    const deps = createFakeAssetTreeDependencies({ copyToClipboardResult: false });
    await expect(deps.clipboard.copyToClipboard({ text: 'x' })).resolves.toBe(false);
  });
});
