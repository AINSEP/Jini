import type { AdminHttpError } from "@jini-ai/core/admin-runtime";

import type { RequestErrorGuard } from "./version-conflict.js";

type Empty = Record<string, never>;

/** The host's local browser adapter; the server owns production/launcher/peer admission. */
export interface LocalOwnerSessionPort<T> {
  signInLocalOwner: (required: Empty, optional?: Empty) => Promise<unknown>;
  me: () => Promise<T>;
}

/** The ports a session-bootstrap reader takes (structurally `@jini-ai/user-management`'s `SessionBootstrapPorts`). */
export interface InitialSessionPorts<T> {
  readonly me: (required: Empty, optional?: Empty) => Promise<T>;
  readonly bootstrap: (required: Empty, optional?: Empty) => Promise<unknown>;
  readonly admit: (required: Empty, optional?: Empty) => boolean;
  readonly isUnauthenticated: (required: { error: unknown }, optional?: Empty) => boolean;
}
/** The injected bootstrap reader (the host binds `@jini-ai/user-management`'s `readInitialSession`). */
export type ReadInitialSession = <T>(required: InitialSessionPorts<T>, optional?: { onBootstrapped?: () => void }) => Promise<T>;

export type ReadInitialAdminSession = <T>(
  required: { hostname: string; port: LocalOwnerSessionPort<T> },
  optional?: { onLocalSignIn?: () => void },
) => Promise<T>;

/** Avoid sending local-bootstrap requests from deployed browser origins. @complexity O(1). */
export function isLocalOwnerSignInHost({ hostname }: { hostname: string }, _optional = {}): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Preserve a valid session; bootstrap only an unauthenticated local browser on initial load.
 * The session hook retains this read across effect replays and never invokes it on later 401s.
 * A refused bootstrap preserves the original 401 so the hook settles on ordinary login.
 * The host injects the bootstrap reader and its request-error guard; a host binds once.
 * @complexity O(1) time/space: at most one bootstrap and two identity reads.
 */
export function createReadInitialAdminSession<E extends AdminHttpError>(
  { readInitialSession, isRequestError }: { readInitialSession: ReadInitialSession; isRequestError: RequestErrorGuard<E> },
  _optional: Empty = {},
): ReadInitialAdminSession {
  const isUnauthenticated = (required: { error: unknown }): boolean =>
    isRequestError(required) && required.error.status === 401 && required.error.code === "UNAUTHENTICATED";
  return <T,>(required: { hostname: string; port: LocalOwnerSessionPort<T> }, optional: { onLocalSignIn?: () => void } = {}) => {
    const { hostname, port } = required;
    return readInitialSession<T>({
      me: () => port.me(), bootstrap: () => port.signInLocalOwner({}), admit: () => isLocalOwnerSignInHost({ hostname }),
      isUnauthenticated,
    }, {
      // Settings readers may already have received a pre-cookie 401, just as on password login.
      ...(optional.onLocalSignIn ? { onBootstrapped: optional.onLocalSignIn } : {}),
    });
  };
}
