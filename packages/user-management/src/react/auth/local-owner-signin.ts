/** The host's local browser adapter; the server owns production/launcher/peer admission. */
export interface LocalOwnerSessionPort<T> {
  signInLocalOwner: (required: Record<string, never>, optional?: Record<string, never>) => Promise<unknown>;
  me: () => Promise<T>;
}

/** `@jini-ai/user-management/session-bootstrap`'s `readInitialSession`, injected by the host so this
 * browser entry does not reach the session-bootstrap entry's module. */
export type LocalOwnerReadInitialSession = <T>(required: {
  me: () => Promise<T>; bootstrap: () => Promise<unknown>; admit: () => boolean; isUnauthenticated: (required: { error: unknown }) => boolean;
}, optional?: { onBootstrapped?: () => void }) => Promise<T>;

/** The host's API error class: an instance carries the HTTP status and the canonical error code. */
export type LocalOwnerApiErrorClass = abstract new (...args: never[]) => { status: number; code?: string | undefined };

/** Avoid sending local-bootstrap requests from deployed browser origins. @complexity O(1). */
export function isLocalOwnerSignInHost({ hostname }: { hostname: string }, _optional: Record<string, never> = {}): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** The host injects its API error class (so only ITS 401 `UNAUTHENTICATED` starts a bootstrap) and `readInitialSession`.
 * @complexity O(1) to build. */
export function createLocalOwnerSignIn({ apiErrorClass, readInitialSession }: { apiErrorClass: LocalOwnerApiErrorClass; readInitialSession: LocalOwnerReadInitialSession }, _optional: Record<string, never> = {}): {
  readInitialAdminSession<T>(required: { hostname: string; port: LocalOwnerSessionPort<T> }, optional?: { onLocalSignIn?: () => void }): Promise<T>;
} {
  /** Preserve a valid session; bootstrap only an unauthenticated local browser on initial load.
   * The session hook retains this read across effect replays and never invokes it on later 401s.
   * A refused bootstrap preserves the original 401 so the hook settles on ordinary login.
   * @complexity O(1) time/space: at most one bootstrap and two identity reads.
   */
  function readInitialAdminSession<T>(
    required: { hostname: string; port: LocalOwnerSessionPort<T> },
    optional: { onLocalSignIn?: () => void } = {},
  ): Promise<T> {
    const { hostname, port } = required;
    return readInitialSession<T>({
      me: () => port.me(), bootstrap: () => port.signInLocalOwner({}), admit: () => isLocalOwnerSignInHost({ hostname }),
      isUnauthenticated: ({ error }) => error instanceof apiErrorClass && error.status === 401 && error.code === "UNAUTHENTICATED",
    }, {
      // Settings readers may already have received a pre-cookie 401, just as on password login.
      ...(optional.onLocalSignIn ? { onBootstrapped: optional.onLocalSignIn } : {}),
    });
  }
  return { readInitialAdminSession };
}
