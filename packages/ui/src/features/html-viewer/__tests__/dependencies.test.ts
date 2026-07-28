// @vitest-environment node
//
// All of createBrowserFullscreenPort's tests (including the "document is
// present" cases, via a hand-built fake below) run under this single `node`
// environment rather than splitting across a jsdom file + a separate
// `@vitest-environment node` companion. Splitting was tried first, but
// @vitest/coverage-v8 does not reliably merge branch-hit counts for one
// source file instrumented under two different test environments in the
// same run — the SSR guard's "document is undefined" branch tested for
// real in isolation (its own single-environment run shows it covered)
// silently reported as uncovered once merged with a jsdom sibling file.
// Keeping everything in one environment sidesteps that merge gap entirely
// rather than leaving a real, tested branch looking untested.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@injini/renderers-react', async () => {
  const actual = await vi.importActual<typeof import('@injini/renderers-react')>('@injini/renderers-react');
  return { ...actual, openSandboxedPreviewInNewTab: vi.fn() };
});

import { openSandboxedPreviewInNewTab } from '@injini/renderers-react';
import {
  createBrowserFullscreenPort,
  createBrowserNewTabPreviewPort,
  createDefaultHtmlViewerDependencies,
  defaultHtmlViewerDependencies,
} from '../dependencies.js';

/** A minimal fake `document` — a real `EventTarget` (for genuine add/removeEventListener/dispatchEvent semantics) plus the two Fullscreen API members this port reads. */
function makeFakeDocument(initial: {
  fullscreenElement?: unknown;
  exitFullscreen?: () => Promise<void>;
} = {}) {
  const target = new EventTarget() as EventTarget & {
    fullscreenElement: unknown;
    exitFullscreen?: () => Promise<void>;
  };
  target.fullscreenElement = initial.fullscreenElement ?? null;
  if (initial.exitFullscreen) target.exitFullscreen = initial.exitFullscreen;
  return target;
}

describe('createBrowserFullscreenPort', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests fullscreen on an element that supports it', async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const el = { requestFullscreen } as unknown as HTMLElement;
    await createBrowserFullscreenPort().requestFullscreen(el);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the element has no requestFullscreen', async () => {
    const el = {} as HTMLElement;
    await expect(createBrowserFullscreenPort().requestFullscreen(el)).resolves.toBeUndefined();
  });

  it('every method degrades safely with no global document at all (the real SSR case)', async () => {
    const port = createBrowserFullscreenPort();
    expect(port.fullscreenElement()).toBeNull();
    await expect(port.exitFullscreen()).resolves.toBeUndefined();
    const unsubscribe = port.subscribeFullscreenChange(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });

  it('reports the current fullscreenElement once a document exists', () => {
    const port = createBrowserFullscreenPort();
    const fakeEl = {} as Element;
    vi.stubGlobal('document', makeFakeDocument({ fullscreenElement: fakeEl }));
    expect(port.fullscreenElement()).toBe(fakeEl);
  });

  it('normalizes an undefined fullscreenElement to null', () => {
    const port = createBrowserFullscreenPort();
    vi.stubGlobal('document', makeFakeDocument({ fullscreenElement: undefined }));
    expect(port.fullscreenElement()).toBeNull();
  });

  it('exits fullscreen only when something is currently fullscreen', async () => {
    const port = createBrowserFullscreenPort();
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal('document', makeFakeDocument({ fullscreenElement: null, exitFullscreen }));
    await port.exitFullscreen();
    expect(exitFullscreen).not.toHaveBeenCalled();

    vi.stubGlobal('document', makeFakeDocument({ fullscreenElement: {} as Element, exitFullscreen }));
    await port.exitFullscreen();
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('subscribes to and unsubscribes from fullscreenchange', () => {
    const fakeDoc = makeFakeDocument();
    vi.stubGlobal('document', fakeDoc);
    const port = createBrowserFullscreenPort();
    const onChange = vi.fn();
    const unsubscribe = port.subscribeFullscreenChange(onChange);
    fakeDoc.dispatchEvent(new Event('fullscreenchange'));
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
    fakeDoc.dispatchEvent(new Event('fullscreenchange'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('createBrowserNewTabPreviewPort', () => {
  it('delegates to @injini/renderers-react openSandboxedPreviewInNewTab', () => {
    createBrowserNewTabPreviewPort().openInNewTab('<p>hi</p>', 'My Title');
    expect(openSandboxedPreviewInNewTab).toHaveBeenCalledWith('<p>hi</p>', 'My Title');
  });
});

describe('createDefaultHtmlViewerDependencies / defaultHtmlViewerDependencies', () => {
  it('builds a dependencies bag with both ports', () => {
    const deps = createDefaultHtmlViewerDependencies();
    expect(typeof deps.fullscreen.requestFullscreen).toBe('function');
    expect(typeof deps.newTabPreview.openInNewTab).toBe('function');
  });

  it('exposes a module-level singleton', () => {
    expect(typeof defaultHtmlViewerDependencies.fullscreen.requestFullscreen).toBe('function');
    expect(typeof defaultHtmlViewerDependencies.newTabPreview.openInNewTab).toBe('function');
  });
});
