import { describe, expect, it, vi } from 'vitest';
import {
  buildFocusGuardScript,
  buildSandboxedDocument,
  buildStorageShimScript,
  injectBaseHref,
  isFullHtmlDocument,
  wrapFragmentAsDocument,
} from '../sandboxed-document.js';

describe('isFullHtmlDocument', () => {
  it('recognizes a doctype document', () => {
    expect(isFullHtmlDocument('<!doctype html><html></html>')).toBe(true);
  });

  it('recognizes an <html>-first document (no doctype)', () => {
    expect(isFullHtmlDocument('<html><body>hi</body></html>')).toBe(true);
  });

  it('is case-insensitive and tolerates leading whitespace', () => {
    expect(isFullHtmlDocument('  \n<!DOCTYPE HTML><html></html>')).toBe(true);
  });

  it('treats a bare fragment as not-a-full-document', () => {
    expect(isFullHtmlDocument('<div>hello</div>')).toBe(false);
  });
});

describe('wrapFragmentAsDocument', () => {
  it('wraps a bare fragment in a minimal document shell', () => {
    const result = wrapFragmentAsDocument('<h1>Hi</h1>');
    expect(result).toContain('<!doctype html>');
    expect(result).toContain('<body><h1>Hi</h1></body>');
  });

  it('leaves an already-full document untouched', () => {
    const doc = '<!doctype html><html><body>x</body></html>';
    expect(wrapFragmentAsDocument(doc)).toBe(doc);
  });
});

describe('injectBaseHref', () => {
  it('injects into an existing <head>', () => {
    const result = injectBaseHref('<html><head><title>t</title></head></html>', 'https://example.com/');
    expect(result).toBe(
      '<html><head><base href="https://example.com/"><title>t</title></head></html>',
    );
  });

  it('synthesizes a <head> when there is <html> but no <head>', () => {
    const result = injectBaseHref('<html><body>x</body></html>', 'https://example.com/');
    expect(result).toBe(
      '<html><head><base href="https://example.com/"></head><body>x</body></html>',
    );
  });

  it('prepends when there is neither <html> nor <head>', () => {
    expect(injectBaseHref('hi', 'https://example.com/')).toBe(
      '<base href="https://example.com/">hi',
    );
  });

  it('escapes attribute-breaking characters in the href', () => {
    const result = injectBaseHref('<head></head>', 'https://example.com/?a=1&b="2"');
    expect(result).toContain('href="https://example.com/?a=1&amp;b=&quot;2&quot;"');
  });
});

/** Strip the `<script ...>` wrapper so the body can be evaluated directly against fake globals. */
function extractScriptBody(scriptTag: string): string {
  const openEnd = scriptTag.indexOf('>');
  const closeStart = scriptTag.lastIndexOf('</script>');
  return scriptTag.slice(openEnd + 1, closeStart);
}

function runScript(body: string, sandbox: Record<string, unknown>) {
  const paramNames = Object.keys(sandbox);
  const fn = new Function(...paramNames, body);
  fn(...paramNames.map((name) => sandbox[name]));
}

function makeFakeEventTarget() {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  return {
    addEventListener(type: string, handler: (event: unknown) => void) {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    dispatch(type: string, event: unknown) {
      for (const handler of listeners.get(type) ?? []) handler(event);
    },
  };
}

describe('buildStorageShimScript', () => {
  it('emits a script tagged for identification', () => {
    const script = buildStorageShimScript();
    expect(script).toContain('<script data-jini-sandbox-shim>');
    expect(script).toContain('</script>');
  });

  it('leaves a working localStorage untouched', () => {
    const realStore = { getItem: () => 'x', length: 1 };
    const fakeDoc = makeFakeEventTarget();
    const windowObj: Record<string, unknown> = { localStorage: realStore, sessionStorage: realStore };
    runScript(extractScriptBody(buildStorageShimScript()), {
      window: windowObj,
      document: fakeDoc,
      location: { href: 'https://x.test/' },
      history: { replaceState: vi.fn() },
    });
    expect(windowObj.localStorage).toBe(realStore);
  });

  it('replaces a throwing localStorage with a working in-memory store', () => {
    const windowObj: Record<string, unknown> = {};
    Object.defineProperty(windowObj, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    const fakeDoc = makeFakeEventTarget();
    runScript(extractScriptBody(buildStorageShimScript()), {
      window: windowObj,
      document: fakeDoc,
      location: { href: 'https://x.test/' },
      history: { replaceState: vi.fn() },
    });
    const shimmed = windowObj.localStorage as Storage;
    expect(shimmed.getItem('missing')).toBeNull();
    shimmed.setItem('k', 'v');
    expect(shimmed.getItem('k')).toBe('v');
    expect(shimmed.length).toBe(1);
    expect(shimmed.key(0)).toBe('k');
    shimmed.removeItem('k');
    expect(shimmed.getItem('k')).toBeNull();
    shimmed.setItem('a', '1');
    shimmed.clear();
    expect(shimmed.length).toBe(0);
  });

  it('scrolls to top and clears the hash for a bare "#" click', () => {
    const fakeDoc = makeFakeEventTarget();
    const scrollTo = vi.fn();
    const replaceState = vi.fn();
    const link = { getAttribute: (name: string) => (name === 'href' ? '#' : null) };
    const target = Object.assign(Object.create(Element.prototype), { closest: () => link }) as Element;
    runScript(extractScriptBody(buildStorageShimScript()), {
      window: { scrollTo },
      document: fakeDoc,
      location: { href: 'https://x.test/', hash: '' },
      history: { replaceState },
      Element,
    });
    const preventDefault = vi.fn();
    fakeDoc.dispatch('click', { target, preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    expect(replaceState).toHaveBeenCalled();
  });

  it('scrolls a same-page anchor target into view and sets the hash', () => {
    const fakeDoc = makeFakeEventTarget();
    const scrollIntoView = vi.fn();
    const el = { scrollIntoView };
    const link = { getAttribute: (name: string) => (name === 'href' ? '#section' : null) };
    const target = Object.assign(Object.create(Element.prototype), { closest: () => link }) as Element;
    const locationObj = { href: 'https://x.test/', hash: '' };
    runScript(extractScriptBody(buildStorageShimScript()), {
      window: {},
      document: { ...fakeDoc, getElementById: () => el },
      location: locationObj,
      history: { replaceState: vi.fn() },
      Element,
    });
    const preventDefault = vi.fn();
    fakeDoc.dispatch('click', { target, preventDefault });
    expect(scrollIntoView).toHaveBeenCalled();
    expect(locationObj.hash).toBe('#section');
  });

  it('opens a safe target="_blank" http(s) link via window.open', () => {
    const fakeDoc = makeFakeEventTarget();
    const open = vi.fn();
    const link = {
      getAttribute: (name: string) =>
        name === 'href' ? 'https://example.com/page' : name === 'target' ? '_blank' : null,
    };
    const target = Object.assign(Object.create(Element.prototype), { closest: () => link }) as Element;
    runScript(extractScriptBody(buildStorageShimScript()), {
      window: { open },
      document: fakeDoc,
      location: { href: 'https://x.test/' },
      history: { replaceState: vi.fn() },
      Element,
      URL,
    });
    const preventDefault = vi.fn();
    fakeDoc.dispatch('click', { target, preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith('https://example.com/page', '_blank', 'noopener,noreferrer');
  });

  it('refuses to open an unsafe scheme (e.g. javascript:) target="_blank" link', () => {
    const fakeDoc = makeFakeEventTarget();
    const open = vi.fn();
    const link = {
      getAttribute: (name: string) =>
        name === 'href' ? 'javascript:alert(1)' : name === 'target' ? '_blank' : null,
    };
    const target = Object.assign(Object.create(Element.prototype), { closest: () => link }) as Element;
    const preventDefault = vi.fn();
    runScript(extractScriptBody(buildStorageShimScript()), {
      window: { open },
      document: fakeDoc,
      location: { href: 'https://x.test/' },
      history: { replaceState: vi.fn() },
      Element,
      URL,
    });
    fakeDoc.dispatch('click', { target, preventDefault });
    // preventDefault still fires (it's a recognized target="_blank" link) —
    // only the actual window.open call is withheld for the unsafe scheme.
    expect(preventDefault).toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('ignores clicks that do not resolve to a link element', () => {
    const fakeDoc = makeFakeEventTarget();
    const target = Object.assign(Object.create(Element.prototype), { closest: () => null }) as Element;
    runScript(extractScriptBody(buildStorageShimScript()), {
      window: {},
      document: fakeDoc,
      location: { href: 'https://x.test/' },
      history: { replaceState: vi.fn() },
      Element,
    });
    // Should not throw even though nothing matched.
    expect(() => fakeDoc.dispatch('click', { target, preventDefault: vi.fn() })).not.toThrow();
    expect(() => fakeDoc.dispatch('click', { target: null, preventDefault: vi.fn() })).not.toThrow();
  });
});

describe('buildFocusGuardScript', () => {
  it('emits a script tagged for identification', () => {
    const script = buildFocusGuardScript();
    expect(script).toContain('<script data-jini-focus-guard>');
  });

  it('suppresses window.focus() with no recent trusted input', () => {
    const fakeDoc = makeFakeEventTarget();
    const nativeFocus = vi.fn();
    const windowObj: Record<string, unknown> = { focus: nativeFocus };
    const HTMLElementFake = function HTMLElementFake() {} as unknown as { prototype: { focus?: unknown } };
    HTMLElementFake.prototype = {};
    runScript(extractScriptBody(buildFocusGuardScript()), {
      window: windowObj,
      document: fakeDoc,
      HTMLElement: HTMLElementFake,
      Date,
    });
    (windowObj.focus as () => void)();
    expect(nativeFocus).not.toHaveBeenCalled();
  });

  it('allows window.focus() shortly after a trusted keydown', () => {
    const fakeDoc = makeFakeEventTarget();
    const nativeFocus = vi.fn();
    const windowObj: Record<string, unknown> = { focus: nativeFocus };
    const HTMLElementFake = function HTMLElementFake() {} as unknown as { prototype: { focus?: unknown } };
    HTMLElementFake.prototype = {};
    runScript(extractScriptBody(buildFocusGuardScript()), {
      window: windowObj,
      document: fakeDoc,
      HTMLElement: HTMLElementFake,
      Date,
    });
    fakeDoc.dispatch('keydown', { isTrusted: true });
    (windowObj.focus as () => void)();
    expect(nativeFocus).toHaveBeenCalledTimes(1);
  });

  it('ignores an untrusted (synthetic) pointerdown', () => {
    const fakeDoc = makeFakeEventTarget();
    const nativeFocus = vi.fn();
    const windowObj: Record<string, unknown> = { focus: nativeFocus };
    const HTMLElementFake = function HTMLElementFake() {} as unknown as { prototype: { focus?: unknown } };
    HTMLElementFake.prototype = {};
    runScript(extractScriptBody(buildFocusGuardScript()), {
      window: windowObj,
      document: fakeDoc,
      HTMLElement: HTMLElementFake,
      Date,
    });
    fakeDoc.dispatch('pointerdown', { isTrusted: false });
    (windowObj.focus as () => void)();
    expect(nativeFocus).not.toHaveBeenCalled();
  });

  it('gates HTMLElement.prototype.focus the same way', () => {
    const fakeDoc = makeFakeEventTarget();
    const nativeElementFocus = vi.fn();
    const windowObj: Record<string, unknown> = {};
    const HTMLElementFake = function HTMLElementFake() {} as unknown as { prototype: { focus: unknown } };
    HTMLElementFake.prototype = { focus: nativeElementFocus };
    runScript(extractScriptBody(buildFocusGuardScript()), {
      window: windowObj,
      document: fakeDoc,
      HTMLElement: HTMLElementFake,
      Date,
    });
    const el = Object.create(HTMLElementFake.prototype) as { focus(): void };
    el.focus();
    expect(nativeElementFocus).not.toHaveBeenCalled();
    fakeDoc.dispatch('pointerdown', { isTrusted: true });
    el.focus();
    expect(nativeElementFocus).toHaveBeenCalledTimes(1);
  });
});

describe('buildSandboxedDocument', () => {
  it('wraps a fragment and injects the storage shim by default', () => {
    const { html, isFullDocument } = buildSandboxedDocument('<p>hi</p>');
    expect(isFullDocument).toBe(false);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('data-jini-sandbox-shim');
    expect(html).not.toContain('data-jini-focus-guard');
  });

  it('reports isFullDocument true for an already-full document, unwrapped', () => {
    const { isFullDocument, html } = buildSandboxedDocument(
      '<!doctype html><html><body>hi</body></html>',
    );
    expect(isFullDocument).toBe(true);
    expect(html).toContain('<body>hi</body>');
  });

  it('injects the base href when provided', () => {
    const { html } = buildSandboxedDocument('<p>hi</p>', { baseHref: 'https://cdn.test/' });
    expect(html).toContain('<base href="https://cdn.test/">');
  });

  it('omits the storage shim when storageShim is false', () => {
    const { html } = buildSandboxedDocument('<p>hi</p>', { storageShim: false });
    expect(html).not.toContain('data-jini-sandbox-shim');
  });

  it('injects the focus guard only when requested', () => {
    const { html } = buildSandboxedDocument('<p>hi</p>', { focusGuard: true });
    expect(html).toContain('data-jini-focus-guard');
  });

  it('composes base href, shim, and focus guard together in one document', () => {
    const { html } = buildSandboxedDocument('<p>hi</p>', {
      baseHref: 'https://cdn.test/',
      focusGuard: true,
    });
    expect(html).toContain('<base href="https://cdn.test/">');
    expect(html).toContain('data-jini-sandbox-shim');
    expect(html).toContain('data-jini-focus-guard');
  });
});
