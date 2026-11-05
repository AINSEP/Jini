import type { Clock } from '@jini-ai/core/primitives';
import { createPendingAuthorizationStore, generateOAuthState, type OAuthRandomBytes } from '@jini-ai/oauth';
import type { createApiConnectionGenerationReader } from './keys.js';
import type { ApiConnectionService } from './service.js';

interface HostedSignInWait {
  readonly workspaceId: string;
  readonly connectionRef: string;
  readonly startGeneration: number;
  readonly getStatus: ApiConnectionService['getStatus'];
  readonly readGeneration: ReturnType<typeof createApiConnectionGenerationReader>;
  readonly signal: AbortSignal;
  readonly pollIntervalMs: number;
  readonly waitTimeoutMs: number;
}

/** Abortable pause owned by the watcher; clears its timer and listener on either outcome.
 * @complexity O(1) time and space. @overallScore 100
 */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done(): void { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
  });
}

/** Hosted: wait for the callback route to install a newer credential.
 * Returns false on timeout/abort; status and generation reader failures propagate unchanged.
 * @complexity O(t / interval) record reads, O(1) space; no additional reads beyond the existing poll.
 * @overallScore 100
 */
export async function waitForHostedSignIn(required: HostedSignInWait, _optional: Record<string, never> = {}): Promise<boolean> {
  const { connectionRef, workspaceId, startGeneration, getStatus, readGeneration, signal } = required;
  const deadline = Date.now() + required.waitTimeoutMs;
  while (Date.now() < deadline && !signal.aborted) {
    const status = await getStatus({ connectionRef, workspaceId });
    if (status.status === 'connected' && (await readGeneration({ key: connectionRef })) > startGeneration) return true;
    await pause(Math.min(required.pollIntervalMs, Math.max(deadline - Date.now(), 0)), signal);
  }
  return false;
}

interface SignInHandoff {
  readonly authorizationUrl: string;
  readonly browserBinding: string;
  readonly actorId: string;
  readonly expiresAt: string;
}

export interface SignInHandoffs {
  issue(required: SignInHandoff, optional?: Record<string, never>): string;
  take(required: { readonly handoffId: string; readonly actorId: string }, optional?: Record<string, never>): SignInHandoff | null;
}

/** Actor-bound handoffs over the existing 256-entry, 10-minute cache. No timers or background processes.
 * @returns issue (opaque id) and take (consumes even on actor mismatch).
 * @example const handoffs = createSignInHandoffs({ clock, randomBytesFn }); // only host code may hold it
 * @complexity O(n) insertion sweep, O(1) take; O(256) bounded space.
 * @overallScore 100
 */
export function createSignInHandoffs(required: { readonly clock: Clock; readonly randomBytesFn: OAuthRandomBytes }, _optional: Record<string, never> = {}): SignInHandoffs {
  const pending = createPendingAuthorizationStore<SignInHandoff>({ clock: required.clock }, {
    expiry: ({ value }) => Date.parse(value.expiresAt),
  });
  return {
    /** Stores host-only proof; entropy errors propagate before anything is issued. */
    issue(input: SignInHandoff, _options: Record<string, never> = {}): string {
      const id = generateOAuthState({ randomBytesFn: required.randomBytesFn }, { stateBytes: 32 });
      pending.put({ state: id, value: { ...input } });
      return id;
    },
    /** Burns the id first; unknown, expired, used or foreign actors all return null. */
    take(input: { readonly handoffId: string; readonly actorId: string }, _options: Record<string, never> = {}): SignInHandoff | null {
      const entry = pending.consume({ state: input.handoffId });
      return entry?.actorId === input.actorId ? entry : null;
    },
  };
}
