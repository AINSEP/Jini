// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDesktopViewRelease } from '../use-desktop-view-release.hooks.js';

const release = () => window.dispatchEvent(new Event('jini:release-check', { cancelable: true }));

describe('admin release eligibility', () => {
  it('unguarded form routes, theme buffers and unknown surfaces refuse release', () => {
    const { rerender } = renderHook(({ routePath }) => useDesktopViewRelease({ routePath, signedIn: true }), { initialProps: { routePath: '/settings' } });
    for (const routePath of ['/settings', '/themes', '/themes/explorer', '/media', '/extensions/new', '/dashboard/new', '/unknown']) {
      rerender({ routePath });
      expect(release(), routePath).toBe(false);
    }
  });

  it('the verified dashboard can release while independent state guards retain their veto', () => {
    const { rerender, unmount } = renderHook(({ routePath }) => useDesktopViewRelease({ routePath, signedIn: true }), { initialProps: { routePath: '/' } });
    expect(release()).toBe(true);
    rerender({ routePath: '/dashboard?tab=activity' });
    expect(release()).toBe(true);
    const veto = (event: Event) => event.preventDefault();
    window.addEventListener('jini:release-check', veto);
    expect(release()).toBe(false);
    window.removeEventListener('jini:release-check', veto);
    rerender({ routePath: '/settings' });
    unmount();
    expect(release()).toBe(true);
  });

  it('release eligibility does not introduce browser reload prompts', () => {
    renderHook(() => useDesktopViewRelease({ routePath: '/settings', signedIn: true }));
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true);
  });

  it('the login form at the dashboard URL remains pinned', () => {
    renderHook(() => useDesktopViewRelease({ routePath: '/', signedIn: false }));
    expect(release()).toBe(false);
  });
});
