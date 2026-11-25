/** Fake of the generic OAuth (PKCE) port for xAI route tests: records its calls and replays what a test scripted, with no network, socket or disk.
 * It implements the interface only; it never imports `@jini-ai/agent-runtime`. */
import type { OAuthCallbackListener, OAuthCallbackOutcome, OAuthPendingAuthorizations, OAuthPkceFlowPort, StoredOAuthToken } from '../oauth-port.js';

export interface FakeOAuthPkceFlowPort extends OAuthPkceFlowPort {
  /** Delivers the outcome to the callback of the listener the route opened, as the loopback redirect would. */
  fireCallback(outcome: OAuthCallbackOutcome): Promise<void>;
  /** How many opened listeners were stopped. */
  readonly listenerStops: number;
}

/** The token store, the pending states and the listener are in memory; `begin` and `complete` run the dance against them. */
export function fakeOAuthPkceFlowPort(): FakeOAuthPkceFlowPort {
  const tokens = new Map<string, StoredOAuthToken>();
  const states = new WeakMap<OAuthPendingAuthorizations, Set<string>>();
  const callbacks: ((outcome: OAuthCallbackOutcome) => Promise<void> | void)[] = [];
  let stops = 0;
  const key = (required: { dataDir: string; fileName: string }): string => `${required.dataDir}\0${required.fileName}`;
  const statesOf = (pending: OAuthPendingAuthorizations): Set<string> => states.get(pending) ?? new Set<string>();
  return {
    begin(required) {
      const state = `fake-state-${statesOf(required.pending).size + 1}`;
      statesOf(required.pending).add(state);
      return { authorizeUrl: `${required.config.authorizationEndpoint}?state=${state}`, state };
    },
    async complete(required) {
      if (!statesOf(required.pending).delete(required.state)) throw new Error(`${required.config.providerId} OAuth state not found or expired`);
      return { access_token: 'fake-access-token', token_type: 'Bearer' };
    },
    tokens: {
      async get(required) { return tokens.get(key(required)) ?? null; },
      async set(required) { tokens.set(key(required), required.token); },
      async clear(required) { tokens.delete(key(required)); },
    },
    async resolveBearer(required) {
      const stored = tokens.get(key({ dataDir: required.dataDir, fileName: required.tokenFileName }));
      return stored ? { accessToken: stored.accessToken, source: 'stored' } : null;
    },
    async startCallbackListener(required): Promise<OAuthCallbackListener> {
      callbacks.push(required.onCallback);
      return { address: { host: required.host, port: required.port }, async stop() { stops += 1; } };
    },
    createPendingCache() {
      const set = new Set<string>();
      const pending: OAuthPendingAuthorizations = {
        consume: ({ state }) => (set.delete(state) ? { state } : null),
        size: () => set.size,
        stop: () => set.clear(),
      };
      states.set(pending, set);
      return pending;
    },
    async fireCallback(outcome) { for (const callback of callbacks) await callback(outcome); },
    get listenerStops() { return stops; },
  };
}
