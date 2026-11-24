import { useEffect } from 'react';

// Only reviewed read-only surfaces. Forms, media, extensions and theme buffers stay pinned.
const RELEASABLE_ROUTES = ['/', '/dashboard'];

/** Veto desktop release outside reviewed routes; each state owner may independently veto too.
 * Route location is relative to /admin. No browser reload/close prompts are added. O(1). */
export function useDesktopViewRelease({ routePath, signedIn }: { routePath: string; signedIn: boolean }, _options = {}): void {
  useEffect(() => {
    const onReleaseCheck = (event: Event) => {
      const path = routePath.split(/[?#]/, 1)[0];
      if (!signedIn || !RELEASABLE_ROUTES.includes(path ?? '')) event.preventDefault();
    };
    window.addEventListener('jini:release-check', onReleaseCheck);
    return () => window.removeEventListener('jini:release-check', onReleaseCheck);
  }, [routePath, signedIn]);
}
