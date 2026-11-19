export interface SessionBootstrapPorts<T> {
  /** Reads the ordinary identity; rejects when unauthenticated. */
  readonly me: (required: Record<string, never>, optional?: Record<string, never>) => Promise<T>;
  /** Performs one guarded bootstrap; rejects when refused. */
  readonly bootstrap: (required: Record<string, never>, optional?: Record<string, never>) => Promise<unknown>;
  /** The host's admission policy for attempting bootstrap. */
  readonly admit: (required: Record<string, never>, optional?: Record<string, never>) => boolean;
  /** True only for the host's unauthenticated error. */
  readonly isUnauthenticated: (required: { error: unknown }, optional?: Record<string, never>) => boolean;
}

/**
 * Keeps an existing identity, otherwise attempts one admitted bootstrap, never retried.
 * A refused bootstrap or failed identity reread preserves the original error so ordinary
 * login remains in charge; its own error goes to `onBootstrapFailed`, never dropped. Notification follows only a successful identity reread.
 * At most one bootstrap and two identity reads; no transport is chosen here.
 */
export async function readInitialSession<T>(
  required: SessionBootstrapPorts<T>,
  optional: { onBootstrapped?: () => void; onBootstrapFailed?: (required: { error: unknown }) => void } = {},
): Promise<T> {
  try { return await required.me({}); }
  catch (error) {
    if (!required.isUnauthenticated({ error }) || !required.admit({})) throw error;
    let session: T;
    try {
      await required.bootstrap({});
      session = await required.me({});
    } catch (bootstrapError) {
      optional.onBootstrapFailed?.({ error: bootstrapError });
      throw error;
    }
    optional.onBootstrapped?.();
    return session;
  }
}
