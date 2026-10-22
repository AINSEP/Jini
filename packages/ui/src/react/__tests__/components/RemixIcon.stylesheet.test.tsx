// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Covers `RemixIcon`'s stylesheet self-injection, kept apart from `RemixIcon.test.tsx` (which
 * covers the rendered element) because every assertion here depends on module-level state —
 * `injected`/`warned` latch on first use, so each case needs a freshly evaluated module.
 *
 * The load-bearing cases are the two that pin *existing* host behaviour: a pre-existing
 * `data-jini-remixicon` element must still suppress the default injection entirely. Two
 * downstream apps rely on exactly that, both installing their override at module top level
 * before `createRoot(...).render(...)` but disagreeing on element type — one a `<style>` with
 * inlined CSS text, the other a `<link>` at a served URL. The marker lookup is a bare attribute
 * selector and so is tag-agnostic; the two suppression cases below cover one shape each, on
 * purpose. Those apps are symlinked against this source rather than a published version, so a
 * regression here reaches them immediately.
 */
const MARKER = 'data-jini-remixicon';

async function loadFresh() {
  vi.resetModules();
  return import('../../components/RemixIcon.js');
}

function markedElements(): Element[] {
  return Array.from(document.querySelectorAll(`[${MARKER}]`));
}

beforeEach(() => {
  for (const el of markedElements()) el.remove();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('font recovery through the real component lifecycle', () => {
  it('recovers a failed host style font once across several icon mounts', async () => {
    vi.useFakeTimers();
    const override = document.createElement('style');
    override.setAttribute(MARKER, '');
    override.textContent = '@font-face { font-family: "remixicon"; src: url("/admin/assets/icons.woff2") format("woff2"); }';
    document.head.appendChild(override);
    const applied: FontFace[] = [];
    let probes = 0;
    let replacements = 0;
    const fonts = {
      async load() { probes++; throw new Error('server restarting'); },
      check: () => false,
      add: (face: FontFace) => { applied.push(face); },
    };
    const original = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
    class FakeFontFace {
      readonly status = 'loaded';
      constructor(readonly family: string, readonly source: string) { replacements++; }
      async load() { return this; }
    }
    vi.stubGlobal('FontFace', FakeFontFace);
    try {
      const { RemixIcon } = await loadFresh();
      render(<><RemixIcon name="group-line" /><RemixIcon name="settings-line" /></>);
      await Promise.resolve(); await Promise.resolve();
      expect(probes).toBe(1);
      expect(replacements).toBe(0);
      expect(applied).toEqual([]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(replacements).toBe(1);
      expect(applied).toHaveLength(1);
      expect(applied[0]?.family).toBe('remixicon');
      expect((applied[0] as unknown as FakeFontFace).source).toContain('jini-font-retry=1');
      expect(markedElements()).toEqual([override]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      if (original) Object.defineProperty(document, 'fonts', original);
      else Reflect.deleteProperty(document, 'fonts');
    }
  });
});

describe('default self-injection', () => {
  it('injects one marked stylesheet link on first mount when no host override exists', async () => {
    const { RemixIcon } = await loadFresh();
    render(<RemixIcon name="settings-line" />);

    const marked = markedElements();
    expect(marked).toHaveLength(1);
    expect(marked[0]?.tagName).toBe('LINK');
    expect(marked[0]?.getAttribute('rel')).toBe('stylesheet');
    expect((marked[0] as HTMLLinkElement).href).toContain('remixicon.css');
  });

  it('injects only once across many mounts', async () => {
    const { RemixIcon } = await loadFresh();
    render(<RemixIcon name="a-line" />);
    render(<RemixIcon name="b-line" />);
    render(<RemixIcon name="c-line" />);

    expect(markedElements()).toHaveLength(1);
  });

  it('stays out of the way when a host override already holds the marker', async () => {
    // The `<style>` shape: CSS text run through the host bundler's own pipeline and inlined.
    const override = document.createElement('style');
    override.setAttribute(MARKER, '');
    override.textContent = '.ri-settings-line::before { content: "x"; }';
    document.head.appendChild(override);

    const { RemixIcon } = await loadFresh();
    render(<RemixIcon name="settings-line" />);

    const marked = markedElements();
    expect(marked).toHaveLength(1);
    expect(marked[0]).toBe(override);
    expect(document.querySelector('link[rel="stylesheet"]')).toBeNull();
  });

  it('does nothing outside a DOM rather than throwing', async () => {
    const { installRemixIconStylesheet } = await loadFresh();
    const realDocument = globalThis.document;
    vi.stubGlobal('document', undefined);
    expect(installRemixIconStylesheet({ href: '/x.css' })).toBe(false);
    vi.stubGlobal('document', realDocument);
  });
});

describe('unresolvable default stylesheet', () => {
  it('refuses to inject a data: URL, leaving the marker free for a later override', async () => {
    // Stands in for the `iife` case by its *result*, not its mechanism. Rollup rewrites the
    // source text at build time, so no unit test can reproduce the transform — it can only hand
    // `resolveDefaultStylesheetHref` the shape that transform produces (a `data:` URL, whose own
    // relative `@font-face` src has no location to resolve against) and assert the guard fires.
    // That this *is* the shape Rollup emits was established live downstream, not here.
    class DataUrl {
      readonly protocol = 'data:';
      readonly href = 'data:text/css;base64,LnJpLXt9';
    }
    vi.stubGlobal('URL', DataUrl);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { RemixIcon, installRemixIconStylesheet } = await loadFresh();
    render(<RemixIcon name="settings-line" />);

    expect(markedElements()).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('@jini-ai/ui/remixicon.css');

    vi.unstubAllGlobals();
    expect(installRemixIconStylesheet({ href: '/late.css' })).toBe(true);
    expect(markedElements()).toHaveLength(1);
  });

  it('warns once, not once per mount', async () => {
    class DataUrl {
      readonly protocol = 'data:';
      readonly href = 'data:text/css;base64,LnJpLXt9';
    }
    vi.stubGlobal('URL', DataUrl);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { RemixIcon } = await loadFresh();
    render(<RemixIcon name="a-line" />);
    render(<RemixIcon name="b-line" />);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('drops the dead link and names the fix when the default 404s', async () => {
    // The Vite dev pre-bundling case: the href looks well formed, so this can only be caught
    // asynchronously, once the browser reports the load failure. Dispatched by hand here —
    // jsdom does not fetch stylesheets, so this asserts the handler's behaviour given the event,
    // not that a real browser fires it for that case.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { RemixIcon, installRemixIconStylesheet } = await loadFresh();
    render(<RemixIcon name="settings-line" />);

    const link = markedElements()[0];
    expect(link).toBeDefined();
    link?.dispatchEvent(new Event('error'));

    expect(markedElements()).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('@jini-ai/ui/remixicon.css');

    // A host can still recover after the failure — the marker is no longer held hostage.
    expect(installRemixIconStylesheet({ href: '/recovered.css' })).toBe(true);
  });
});

describe('installRemixIconStylesheet', () => {
  it('installs a marked link at the given href and suppresses the default', async () => {
    const { RemixIcon, installRemixIconStylesheet, REMIXICON_STYLESHEET_MARKER } = await loadFresh();
    expect(REMIXICON_STYLESHEET_MARKER).toBe(MARKER);

    expect(installRemixIconStylesheet({ href: '/site-chat/remixicon.css' })).toBe(true);
    render(<RemixIcon name="settings-line" />);

    const marked = markedElements();
    expect(marked).toHaveLength(1);
    expect((marked[0] as HTMLLinkElement).getAttribute('href')).toBe('/site-chat/remixicon.css');
  });

  it('is idempotent — a second call adds nothing and reports that it no-opped', async () => {
    const { installRemixIconStylesheet } = await loadFresh();

    expect(installRemixIconStylesheet({ href: '/one.css' })).toBe(true);
    expect(installRemixIconStylesheet({ href: '/two.css' })).toBe(false);

    const marked = markedElements();
    expect(marked).toHaveLength(1);
    expect((marked[0] as HTMLLinkElement).getAttribute('href')).toBe('/one.css');
  });

  it('yields to a host override that is already present', async () => {
    const override = document.createElement('style');
    override.setAttribute(MARKER, '');
    document.head.appendChild(override);

    const { installRemixIconStylesheet } = await loadFresh();
    expect(installRemixIconStylesheet({ href: '/ignored.css' })).toBe(false);
    expect(markedElements()).toEqual([override]);
  });
});

describe('font recovery wiring for marked stylesheets', () => {
  function stubFonts() {
    const probes: string[] = [];
    const fonts = { async load(font: string) { probes.push(font); return [{}]; }, check: () => true, add: () => {} };
    const original = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
    vi.stubGlobal('FontFace', class { readonly status = 'loaded'; });
    return { probes, restore: () => { if (original) Object.defineProperty(document, 'fonts', original); else Reflect.deleteProperty(document, 'fonts'); } };
  }

  it('starts recovery for an installed link only once its stylesheet has loaded', async () => {
    const { probes, restore } = stubFonts();
    try {
      const { installRemixIconStylesheet } = await loadFresh();
      expect(installRemixIconStylesheet({ href: '/assets/remixicon.css' })).toBe(true);
      const link = markedElements()[0] as HTMLLinkElement;
      await Promise.resolve();
      expect(probes).toEqual([]);
      const faceRule = { type: 5, style: { getPropertyValue: (name: string) => (name === 'font-family' ? '"remixicon"' : 'url("/assets/remixicon.woff2")') } };
      Object.defineProperty(link, 'sheet', { configurable: true, value: { href: 'http://localhost/assets/remixicon.css', cssRules: [faceRule] } });
      link.dispatchEvent(new Event('load'));
      await Promise.resolve();
      expect(probes).toEqual(['16px "remixicon"']);
    } finally {
      restore();
    }
  });

  it('honours a marker on a non-stylesheet element without attempting font recovery on it', async () => {
    const { probes, restore } = stubFonts();
    const marker = document.createElement('meta');
    marker.setAttribute(MARKER, '');
    document.head.appendChild(marker);
    try {
      const { RemixIcon } = await loadFresh();
      render(<RemixIcon name="settings-line" />);
      await Promise.resolve();
      expect(markedElements()).toEqual([marker]);
      expect(probes).toEqual([]);
    } finally {
      restore();
    }
  });
});

describe('default stylesheet resolution failures', () => {
  it('injects nothing and warns when the module URL cannot be resolved at all', async () => {
    vi.stubGlobal('URL', class { constructor() { throw new TypeError('Invalid URL'); } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { RemixIcon } = await loadFresh();
    render(<RemixIcon name="settings-line" />);
    expect(markedElements()).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('defeated the default stylesheet');
  });

  it('warns once even if the failed default link reports its error again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { RemixIcon } = await loadFresh();
    render(<RemixIcon name="settings-line" />);
    const link = markedElements()[0];
    link?.dispatchEvent(new Event('error'));
    link?.dispatchEvent(new Event('error'));
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
