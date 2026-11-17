/** Fakes of the provider-HTTP and xAI OAuth ports for route tests (R7): each records its calls and replays what a test
 * scripted, with no network, socket or disk. They implement the interfaces only; they never import `@jini-ai/agent-runtime`. */
import type { BaseUrlGuardPort, BaseUrlValidationResult } from '../agent-runtime.js';
import type { ProviderToolTurnPort, ProviderTurnEventRecord } from '../provider-http.js';
import type {
  OAuthCallbackListener, OAuthCallbackOutcome, OAuthPendingAuthorizations, OAuthPkceProviderConfig, StoredOAuthToken, XaiOAuthPort,
} from '../xai-oauth.js';

export interface FakeProviderCall { readonly member: string; readonly required: unknown; readonly optional: unknown }
export interface FakeProviderToolTurnPort extends ProviderToolTurnPort { readonly calls: FakeProviderCall[] }

export interface FakeProviderToolTurnScript {
  /** Events every runner reports through `onEvent`, in order. */
  readonly events?: readonly (ProviderTurnEventRecord & Record<string, unknown>)[];
  /** When set with an `executeTool` in the optional bag, the runner executes this call once after the events. */
  readonly toolCall?: unknown;
}

/** Every runner records its call, replays `events`, runs `toolCall` through the caller's `executeTool`, and ends with zero tool turns. */
export function fakeProviderToolTurnPort(script: FakeProviderToolTurnScript = {}): FakeProviderToolTurnPort {
  const calls: FakeProviderCall[] = [];
  const run = async (member: string, required: { onEvent(event: ProviderTurnEventRecord): void }, optional: { executeTool?(call: unknown): Promise<unknown> } | undefined): Promise<void> => {
    calls.push({ member, required, optional });
    for (const event of script.events ?? []) required.onEvent(event);
    if (script.toolCall !== undefined && optional?.executeTool) await optional.executeTool(script.toolCall);
  };
  const finished = { finishReason: 'stop', toolTurns: 0 };
  return {
    calls,
    async anthropic(required, optional) { await run('anthropic', required, optional); return { stopReason: 'end_turn', toolTurns: 0 }; },
    async openai(required, optional) { await run('openai', required, optional); return finished; },
    async azure(required, optional) { await run('azure', required, optional); return finished; },
    async google(required, optional) { await run('google', required, optional); return finished; },
    async ollama(required, optional) { await run('ollama', required, optional); return finished; },
  };
}

export interface FakeBaseUrlGuard extends BaseUrlGuardPort { readonly calls: { readonly baseUrl: string }[] }

/** A guard that passes every URL except the ones a test seeded with a verdict. */
export function fakeBaseUrlGuard(verdicts: Readonly<Record<string, BaseUrlValidationResult>> = {}): FakeBaseUrlGuard {
  const calls: { baseUrl: string }[] = [];
  return {
    calls,
    validate(required) { calls.push({ baseUrl: required.baseUrl }); return verdicts[required.baseUrl] ?? { parsed: new URL(required.baseUrl) }; },
  };
}

export interface FakeXaiOAuthPort extends XaiOAuthPort {
  /** Delivers the outcome to the callback of the listener the route opened, as the loopback redirect would. */
  fireCallback(outcome: OAuthCallbackOutcome): Promise<void>;
  /** How many opened listeners were stopped. */
  readonly listenerStops: number;
}

const FAKE_CONFIG: OAuthPkceProviderConfig = {
  providerId: 'xai', issuer: 'https://auth.fake.test', authorizationEndpoint: 'https://auth.fake.test/authorize',
  tokenEndpoint: 'https://auth.fake.test/token', clientId: 'fake-client', scope: 'openid',
};

/** The token store, the pending states and the listener are in memory; `begin` and `complete` run the dance against them. */
export function fakeXaiOAuthPort(): FakeXaiOAuthPort {
  const tokens = new Map<string, StoredOAuthToken>();
  const states = new WeakMap<OAuthPendingAuthorizations, Set<string>>();
  const callbacks: ((outcome: OAuthCallbackOutcome) => Promise<void> | void)[] = [];
  let stops = 0;
  const key = (required: { dataDir: string; fileName: string }): string => `${required.dataDir}\0${required.fileName}`;
  const statesOf = (pending: OAuthPendingAuthorizations): Set<string> => states.get(pending) ?? new Set<string>();
  return {
    config: FAKE_CONFIG,
    redirect: { host: '127.0.0.1', port: 56121, path: '/callback' },
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
