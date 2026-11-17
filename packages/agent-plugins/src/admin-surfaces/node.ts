/**
 * @file The per-request registry of sign-in links the host issued while running one admin-surface
 * action, so the admin route can hand the HOST PAGE exactly those links to open. Bind `record` to the
 * connections port's `onSignInIssued`, and wrap each action dispatch in `collect`.
 *
 * Why: a plugin's frame is sandboxed without `allow-popups`, so it cannot open a sign-in itself, and the
 * host page must never open a URL a plugin made up (an open redirect or phishing page under the
 * operator's trust). AsyncLocalStorage keeps concurrent requests apart. Only https links, and plain-http
 * links the host admits as its own sign-in links, are kept.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/** One link the host page may offer: the host's own authorization URL and when its attempt expires. */
export interface HostSignInLink {
  readonly authorizationUrl: string;
  readonly expiresAt: string;
}

export interface IssuedSignInCollector {
  /** Called by the connections port for each issued sign-in; outside a collection it is a no-op. */
  record(required: HostSignInLink, optional?: Record<string, never>): void;
  /** Runs one action and returns what it issued. */
  collect<T>(required: { readonly run: () => Promise<T> }, optional?: Record<string, never>): Promise<{ readonly value: T; readonly signIns: readonly HostSignInLink[] }>;
}

/**
 * @param admitHttp - Whether a plain-http link is the host's own sign-in link (which follows the site's
 *   scheme). Every other link must be https.
 * @complexity O(1) per record; collect adds O(1) around the run.
 */
export function createIssuedSignInCollector(
  { admitHttp }: { admitHttp: (required: { url: URL }) => boolean },
  _optional = {},
): IssuedSignInCollector {
  const current = new AsyncLocalStorage<HostSignInLink[]>();
  return {
    record({ authorizationUrl, expiresAt }) {
      const url = URL.parse(authorizationUrl);
      if (url && (url.protocol === 'https:' || (url.protocol === 'http:' && admitHttp({ url })))) current.getStore()?.push({ authorizationUrl, expiresAt });
    },
    async collect({ run }) {
      const signIns: HostSignInLink[] = [];
      const value = await current.run(signIns, run);
      return { value, signIns };
    },
  };
}
