import type { FetchQueryEnvironmentPort } from './cache.js';

/** Browser-only adapter: subscriptions are owned by the provider effect, never module scope. */
export const browserFetchQueryEnvironment: FetchQueryEnvironmentPort = {
  isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  subscribeOnline: ({ listener }) => {
    const online = () => listener(true);
    const offline = () => listener(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  },
  subscribeFocus: ({ listener }) => {
    const onVisibility = () => { if (document.visibilityState === 'visible') listener(); };
    window.addEventListener('focus', listener);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', listener);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  },
};
