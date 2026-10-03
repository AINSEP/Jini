import { expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { installAppWindowNavigationPolicy, installRendererNavigationPolicy, installGuestWindowOpenPolicy } from '../index.js';
import type { ElectronNavigableContents, WindowOpenResponse } from '../index.js';

function webContents() {
  let popup: ((details: { url: string }) => WindowOpenResponse) | undefined;
  const emitter = new EventEmitter();
  const contents = {
    setWindowOpenHandler(handler: (details: { url: string }) => WindowOpenResponse) { popup = handler; },
    on: emitter.on.bind(emitter),
  } satisfies ElectronNavigableContents;
  return {
    contents,
    popup: (url: string) => popup?.({ url }),
    navigate(url: string) { let prevented = false; emitter.emit('will-navigate', { preventDefault() { prevented = true; } }, url); return prevented; },
    redirect(url: string, isMainFrame: boolean) { let prevented = false; emitter.emit('will-redirect', { url, isMainFrame, preventDefault() { prevented = true; } }); return prevented; },
  };
}

// REGRESSION: fails if contents.on returns to a one-object registration ABI.
it('registers native navigation and redirect callbacks and preserves the initial origin boundary', () => {
  const native = webContents();
  const opened: string[] = [];
  installAppWindowNavigationPolicy({ contents: native.contents, appOrigin: 'https://host.example', openExternal: ({ url }) => opened.push(url) });
  expect(native.popup('https://host.example/page')).toEqual({ action: 'allow' });
  expect(native.popup('https://host.example@evil.example/')).toEqual({ action: 'deny' });
  expect(native.navigate('https://host.example/page')).toBe(false);
  expect(native.navigate('https://evil.example/')).toBe(true);
  expect(native.redirect('https://elsewhere.example/', false)).toBe(false);
  expect(native.redirect('https://elsewhere.example/', true)).toBe(true);
  expect(native.navigate('file:///etc/passwd')).toBe(true);
  expect(opened).toEqual(['https://host.example@evil.example/', 'https://evil.example/', 'https://elsewhere.example/']);
});

// REGRESSION: fails if native setWindowOpenHandler receives an object rather than a callable.
it('supports the native popup-only guest surface and still denies when handoff throws', () => {
  const native = webContents();
  installGuestWindowOpenPolicy({ contents: { setWindowOpenHandler: native.contents.setWindowOpenHandler }, isSupervisedGuestUrl: () => false, openExternal: () => { throw new Error('OS unavailable'); } });
  expect(native.popup('https://external.example/')).toEqual({ action: 'deny' });
  expect(native.popup('javascript:alert(1)')).toEqual({ action: 'deny' });
});

// REGRESSION: fails if renderer navigation stops accepting native WebContents registrations.
it('retains exact renderer matching and blocks other file URLs with native callbacks', () => {
  const native = webContents();
  const opened: string[] = [];
  installRendererNavigationPolicy({ contents: native.contents, rendererFileUrl: 'file:///app/index.html', openExternal: ({ url }) => opened.push(url) });
  expect(native.navigate('file:///app/index.html?mode=1#page')).toBe(false);
  expect(native.navigate('file:///app/other.html')).toBe(true);
  expect(native.redirect('https://external.example/', true)).toBe(true);
  expect(opened).toEqual(['https://external.example/']);
});
