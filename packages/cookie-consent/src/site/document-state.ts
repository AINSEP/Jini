import type { ConsentConfig, DeclaredScript } from '@jini-ai/core/contracts/site/cookie-consent';

/** One published construction snapshot per site (per consent deps), shared by every app built over
 * them: an export, an inspection or a theme override never resets what live visitors are served.
 * Refreshed by publication. No per-page reads. */
export type DocumentState = {
  policy?: ConsentConfig;
  pending?: Promise<void> | undefined;
  scripts: Promise<readonly DeclaredScript[]>;
  client?: { body: Uint8Array; src: string };
  nextReadAt: number;
  now: () => number;
  schedule: (run: () => void, delayMs: number) => () => void;
  refresh?: () => Promise<void>;
};

/** One read per minute per mounted site, including a retry after an unavailable publication. */
export async function documentPolicy({ state }: { state: DocumentState | undefined }, _optional = {}): Promise<ConsentConfig | null> {
  if (!state) return null;
  if (state.now() >= state.nextReadAt) {
    // The refresh logs its own failure; visitors keep the last good policy.
    void state.refresh?.().catch(() => undefined);
  }
  if (state.policy) return state.policy;
  await briefPendingRead({ state });
  return state.policy ?? null;
}

/** Wait at most 250 ms for a read in flight; with none, resolve at once. A late success still lands. */
export async function briefPendingRead({ state }: { state: DocumentState }, _optional = {}): Promise<void> {
  let timer: (() => void) | undefined;
  // The refresh logs its own failure; a failed or slow read leaves the last good policy in use.
  try { await Promise.race([state.pending?.catch(() => undefined), new Promise(resolve => { timer = state.schedule(() => resolve(undefined), 250); })]); }
  finally { timer?.(); }
}

/** Read the policy and plugin declarations together. Each keeps its last good value on failure.
 * @complexity O(1): one policy read and one declaration load at a time. */
export function refreshDocumentState({ state, readPolicy, readDeclarations, policyFailure, declarationFailure }: {
  state: DocumentState; readPolicy: () => Promise<ConsentConfig>;
  readDeclarations: () => Promise<{ scripts: readonly DeclaredScript[] }>;
  policyFailure: (error: unknown) => void; declarationFailure: () => void;
}, _optional = {}): Promise<void> {
  if (state.pending) return state.pending;
  state.nextReadAt = state.now() + 60_000;
  const policy = readPolicy().then(config => { state.policy = config; }, error => {
    policyFailure(error);
    throw error;
  });
  const lastGoodScripts = state.scripts;
  state.scripts = readDeclarations().then(loaded => loaded.scripts, () => {
    declarationFailure();
    return lastGoodScripts;
  });
  state.pending = Promise.allSettled([policy, state.scripts]).then(([read]) => {
    if (read.status === 'rejected') throw read.reason;
  }).finally(() => { state.pending = undefined; });
  return state.pending;
}

