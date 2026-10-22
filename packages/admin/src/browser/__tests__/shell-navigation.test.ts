// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createAdminShellNavigation } from '../shell-navigation.js';

afterEach(() => {
  window.history.replaceState(null, '', '/');
  document.body.innerHTML = '';
});

it('reads a base-stripped snapshot including query and excluding fragment', () => {
  window.history.replaceState(null, '', '/console/records/r1?tab=history#heading');
  const port = createAdminShellNavigation({ location: window.location, window, document });
  expect(port.readRoute({ base: '/console' })).toBe('/records/r1?tab=history');
});

it('notifies for pushes and browser back/forward, then unsubscribes', () => {
  const port = createAdminShellNavigation({ location: window.location, window, document });
  const onChange = vi.fn();
  const unsubscribe = port.subscribe({ base: '/console', onChange });
  port.navigate({ base: '/console', routePath: '/records?sort=title' });
  expect(window.location.pathname).toBe('/console/records');
  expect(port.readRoute({ base: '/console' })).toBe('/records?sort=title');
  expect(onChange).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new PopStateEvent('popstate'));
  expect(onChange).toHaveBeenCalledTimes(2);
  unsubscribe();
  port.navigate({ base: '/console', routePath: '/other' }, { replace: true });
  expect(onChange).toHaveBeenCalledTimes(2);
});

it('intercepts only unmodified links within the explicit admin mount', () => {
  window.history.replaceState(null, '', '/console/');
  const port = createAdminShellNavigation({ location: window.location, window, document });
  const uninstall = port.installLinkInterceptor({ base: '/console' });
  const anchor = document.createElement('a');
  anchor.href = '/console/records?tab=history#heading';
  document.body.append(anchor);
  const modified = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
  anchor.dispatchEvent(modified);
  expect(modified.defaultPrevented).toBe(false);
  const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
  anchor.dispatchEvent(plain);
  expect(plain.defaultPrevented).toBe(true);
  expect(window.location.pathname + window.location.search + window.location.hash).toBe('/console/records?tab=history#heading');
  uninstall();
  const after = new MouseEvent('click', { bubbles: true, cancelable: true });
  anchor.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
});
