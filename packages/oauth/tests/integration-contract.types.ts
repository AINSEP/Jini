import type { Clock } from '@jini-ai/core/primitives';
/** Compile-only coverage of the added entry points and their shared port types. */
import { createIssuerBoundDiscoveryPolicy } from '../src/discovery-policy.js';
import { createDnsPinnedOAuthTransport } from '../src/dns-pinned-transport.js';
import { createPendingAuthorizationStore, createPkcePair, buildOAuthAuthorizationUrl } from '../src/index.js';
import type {
  OAuthDiscoveryPolicy, DnsPinnedOAuthTransport, DnsPinnedOAuthTransportDeps,
  OAuthEmptyArgs, PendingAuthorizationScheduler, PendingAuthorizationCache,
} from '../src/index.js';

type Assert<T extends true> = T;
type Equal<A, B> = [A, B] extends [B, A] ? true : false;
export type IntegrationAssertions = [
  Assert<Equal<ReturnType<typeof createIssuerBoundDiscoveryPolicy>, OAuthDiscoveryPolicy>>,
  Assert<Equal<ReturnType<typeof createDnsPinnedOAuthTransport>, DnsPinnedOAuthTransport>>,
  Assert<Equal<Parameters<typeof createDnsPinnedOAuthTransport>[0], DnsPinnedOAuthTransportDeps>>,
  Assert<Equal<Parameters<PendingAuthorizationCache<{ createdAt: number }>['size']>[0], OAuthEmptyArgs>>,
  Assert<Equal<Parameters<PendingAuthorizationCache<{ createdAt: number }>['stop']>[0], OAuthEmptyArgs>>,
  Assert<Equal<Extract<keyof Parameters<typeof createPkcePair>[0], 'byteLength'>, never>>,
  Assert<Equal<Extract<keyof Parameters<typeof buildOAuthAuthorizationUrl>[0], 'scope' | 'resource'>, never>>,
];

export function rejectedInputs(requiredArgs: {
  deps: DnsPinnedOAuthTransportDeps;
  clock: Clock;
  scheduler: PendingAuthorizationScheduler;
}): void {
  const { deps, clock, scheduler } = requiredArgs;
  // @ts-expect-error the empty required argument object is explicit
  createIssuerBoundDiscoveryPolicy();
  // @ts-expect-error DNS is a required effect port
  createDnsPinnedOAuthTransport({ guard: deps.guard, fetchFn: deps.fetchFn,
    addressPolicy: deps.addressPolicy, dispatcherFactory: deps.dispatcherFactory });
  const cache = createPendingAuthorizationStore<{ createdAt: number }>({ clock }, { scheduler, expiry: ({ value, ttlMs }) => value.createdAt + ttlMs });
  // @ts-expect-error TTL is an optional setting in argument two
  createPendingAuthorizationStore({ clock, ttlMs: 100 }, { scheduler, expiry: ({ ttlMs }) => ttlMs });
  // @ts-expect-error empty required arguments are explicit
  cache.size();
  // @ts-expect-error state is named
  cache.consume('state');
  // @ts-expect-error the DNS hostname is named
  void deps.dns.resolve('auth.example.com');
}
