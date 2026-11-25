// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BEFORE_LINK_NAVIGATION_EVENT, NAVIGATION_EVENT, installInternalLinkInterceptor, subscribeToRoute } from '../navigation.js';

function at(url: string) { window.history.replaceState(null, '', url); }

/** Appends `<a>` with the given attributes to the body and returns it. */
function link(attrs: Record<string, string>): HTMLAnchorElement {
  const anchor = document.createElement('a');
  for (const [name, value] of Object.entries(attrs)) anchor.setAttribute(name, value);
  anchor.textContent = 'link';
  document.body.append(anchor);
  return anchor;
}

/**
 * Dispatches a bubbling, cancelable click on `target` and reports whether the interceptor (or an
 * earlier handler) prevented it. A window-level bubble listener — which runs after the document
 * listener — records that and then cancels the click, so jsdom never attempts its unimplemented
 * default link navigation.
 */
function click(target: EventTarget, init: MouseEventInit = {}): { readonly defaultPrevented: boolean } {
  let defaultPrevented = false;
  const record = (e: Event) => { defaultPrevented = e.defaultPrevented; e.preventDefault(); };
  window.addEventListener('click', record);
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }));
  window.removeEventListener('click', record);
  return { defaultPrevented };
}

let teardown: () => void = () => undefined;
let navigations = 0;
const countNavigation = () => { navigations += 1; };

beforeEach(() => {
  at('/admin/start');
  navigations = 0;
  window.addEventListener(NAVIGATION_EVENT, countNavigation);
  teardown = installInternalLinkInterceptor({ window, document });
});

afterEach(() => {
  teardown();
  window.removeEventListener(NAVIGATION_EVENT, countNavigation);
  document.body.replaceChildren();
  at('/');
});

describe('installInternalLinkInterceptor intercepts plain clicks on internal links', () => {
  it('canceling an internal link preflight keeps the route and emits no navigation event', () => {
    const anchor = link({ href: '/admin/settings' });
    const initialUrl = window.location.href;
    const historyLength = window.history.length;
    const historyState = window.history.state;
    let allowed = false;
    let preflights = 0;
    const onBefore = (event: Event) => {
      preflights += 1;
      if (!allowed) event.preventDefault();
    };
    window.addEventListener(BEFORE_LINK_NAVIGATION_EVENT, onBefore);
    try {
      expect(click(anchor).defaultPrevented).toBe(true);
      expect(preflights).toBe(1);
      expect(window.location.href).toBe(initialUrl);
      expect(window.history.length).toBe(historyLength);
      expect(window.history.state).toBe(historyState);
      expect(navigations).toBe(0);

      allowed = true;
      expect(click(anchor).defaultPrevented).toBe(true);
      expect(preflights).toBe(2);
      expect(window.location.pathname).toBe('/admin/settings');
      expect(window.history.length).toBe(historyLength + 1);
      expect(navigations).toBe(1);
    } finally {
      window.removeEventListener(BEFORE_LINK_NAVIGATION_EVENT, onBefore);
    }
  });

  it('modified clicks and hash-only changes do not ask the leave guard', () => {
    let preflights = 0;
    const onBefore = () => { preflights += 1; };
    window.addEventListener(BEFORE_LINK_NAVIGATION_EVENT, onBefore);
    try {
      expect(click(link({ href: '/admin/settings' }), { metaKey: true }).defaultPrevented).toBe(false);
      expect(preflights).toBe(0);
      expect(click(link({ href: '#frag' })).defaultPrevented).toBe(false);
      expect(preflights).toBe(0);
      expect(click(link({ href: '/admin/start#frag' })).defaultPrevented).toBe(true);
      expect(window.location.pathname).toBe('/admin/start');
      expect(window.location.hash).toBe('#frag');
      expect(navigations).toBe(1);
      expect(preflights).toBe(0);
    } finally {
      window.removeEventListener(BEFORE_LINK_NAVIGATION_EVENT, onBefore);
    }
  });

  it('turns a plain left click on an /admin link into an SPA navigation', () => {
    const event = click(link({ href: '/admin/settings' }));
    expect(event.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe('/admin/settings');
    expect(navigations).toBe(1);
  });

  it('finds the anchor from a click on a descendant element', () => {
    const anchor = link({ href: '/admin/posts' });
    const inner = document.createElement('span');
    anchor.append(inner);
    click(inner);
    expect(window.location.pathname).toBe('/admin/posts');
  });

  it('navigates to the root route for a link to exactly the base', () => {
    click(link({ href: '/admin' }));
    expect(window.location.pathname).toBe('/admin/');
  });

  it('carries the query and hash through to the navigation', () => {
    click(link({ href: '/admin/settings?tab=seo#seo-defaults' }));
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/admin/settings?tab=seo#seo-defaults');
  });

  it('resolves a relative href against the current location', () => {
    at('/admin/collections/');
    click(link({ href: 'recipes' }));
    expect(window.location.pathname).toBe('/admin/collections/recipes');
  });

  it('treats target="_self" as in-place navigation', () => {
    click(link({ href: '/admin/settings', target: '_self' }));
    expect(window.location.pathname).toBe('/admin/settings');
  });

  it('treats an empty target attribute as in-place navigation', () => {
    click(link({ href: '/admin/settings', target: '' }));
    expect(window.location.pathname).toBe('/admin/settings');
  });

  it('honours a custom base', () => {
    teardown();
    teardown = installInternalLinkInterceptor({ window, document }, { base: '/cms' });
    at('/cms/');
    click(link({ href: '/cms/media' }));
    expect(window.location.pathname).toBe('/cms/media');
  });
});

describe('installInternalLinkInterceptor leaves everything else to the browser', () => {
  function expectUntouched(event: { readonly defaultPrevented: boolean }) {
    expect(event.defaultPrevented).toBe(false);
    expect(window.location.pathname).toBe('/admin/start');
    expect(navigations).toBe(0);
  }

  it('ignores a click another handler already prevented', () => {
    const anchor = link({ href: '/admin/settings' });
    anchor.addEventListener('click', (e) => e.preventDefault());
    click(anchor);
    expect(window.location.pathname).toBe('/admin/start');
    expect(navigations).toBe(0);
  });

  it('ignores a non-primary button', () => {
    expectUntouched(click(link({ href: '/admin/settings' }), { button: 1 }));
  });

  it.each(['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const)('ignores a click with %s held', (modifier) => {
    expectUntouched(click(link({ href: '/admin/settings' }), { [modifier]: true }));
  });

  it('ignores a click outside any anchor', () => {
    const div = document.createElement('div');
    document.body.append(div);
    expectUntouched(click(div));
  });

  it('ignores a click whose target is not an Element', () => {
    expectUntouched(click(document));
  });

  it('ignores a download link', () => {
    expectUntouched(click(link({ href: '/admin/export', download: '' })));
  });

  it('ignores a link with an explicit non-self target', () => {
    expectUntouched(click(link({ href: '/admin/settings', target: '_blank' })));
  });

  it('ignores an anchor without an href', () => {
    expectUntouched(click(link({})));
  });

  it('ignores an in-page fragment link', () => {
    const event = click(link({ href: '#section' }));
    expect(event.defaultPrevented).toBe(false);
    expect(navigations).toBe(0);
  });

  it('ignores a cross-origin link', () => {
    expectUntouched(click(link({ href: 'https://elsewhere.example/admin/settings' })));
  });

  it('ignores a same-origin link outside the base', () => {
    expectUntouched(click(link({ href: '/blog/post' })));
  });

  it('ignores a path that merely starts with the base string', () => {
    expectUntouched(click(link({ href: '/administrator' })));
  });

  it('stops intercepting after teardown', () => {
    teardown();
    teardown = () => undefined;
    expectUntouched(click(link({ href: '/admin/settings' })));
  });
});

describe('subscribeToRoute', () => {
  it('fires on popstate and on navigation events until unsubscribed', () => {
    let calls = 0;
    const unsubscribe = subscribeToRoute({ window, onChange: () => { calls += 1; } });
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.dispatchEvent(new Event(NAVIGATION_EVENT));
    unsubscribe();
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.dispatchEvent(new Event(NAVIGATION_EVENT));
    expect(calls).toBe(2);
  });
});
