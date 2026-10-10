import type { LookupAddress, lookup } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Agent, type Dispatcher } from 'undici';
import { assertSafePublicUrl, createValidatingLookup } from '@jini-ai/platform';
import type { ReachabilityArgs } from './reachability.js';


function isLookupAddress(value: unknown): value is LookupAddress {
  return value !== null && typeof value === 'object' && 'address' in value &&
    typeof value.address === 'string' && 'family' in value && typeof value.family === 'number';
}

export function createReachabilityDispatcher(_required: Record<string, never>, { lookupImpl }: { lookupImpl?: typeof lookup } = {}): Agent {
  const validatingLookup = createValidatingLookup(lookupImpl);
  const connectionLookup: LookupFunction = (hostname, options, callback) => {
    validatingLookup(hostname, options, (error, address, family) => {
      if (error) { callback(error, ''); return; }
      if (typeof address === 'string') { callback(null, address, family); return; }
      if (Array.isArray(address) && address.every(isLookupAddress)) { callback(null, address, family); return; }
      callback(new Error('DNS lookup returned an invalid address'), '');
    });
  };
  return new Agent({ connect: { lookup: connectionLookup } });
}

/**
 * Node default for deployment probes: URL rejection plus connection-time DNS validation.
 * The address validated by platform's lookup is the address the socket connects to; a
 * preflight DNS check would permit rebinding between validation and connection (SEC-003).
 * Share the lazily-created dispatcher within these ports to retain connection pooling. A host/test
 * lookup override owns a separate dispatcher and never changes another host's policy.
 * Native fetch remains a framework ABI, including undici's dispatcher extension.
 * Attach the dispatcher as a runtime extension so the @types/node bundled
 * undici-types Dispatcher version need not match the runtime undici Agent.
 * Native fetch uses that Agent's dispatch method; no port casts are needed.
 */
export function createNodeReachabilityPorts(
  _required: Record<string, never>,
  options: { fetch?: typeof globalThis.fetch; lookupImpl?: typeof lookup; dispatcher?: Dispatcher } = {},
): Pick<ReachabilityArgs, 'fetch' | 'guard'> & { close(): Promise<void> } {
  let dispatcher: Dispatcher | undefined = options.dispatcher;
  return {
    close: async () => { if (!options.dispatcher) await dispatcher?.close(); },
    guard: { assertSafeUrl: ({ raw }) => assertSafePublicUrl(raw) },
    fetch: ({ url }, { init } = {}) => {
      dispatcher ??= createReachabilityDispatcher({}, options.lookupImpl ? { lookupImpl: options.lookupImpl } : {});
      const guardedInit: RequestInit = { ...init };
      Object.defineProperty(guardedInit, 'dispatcher', {
        value: dispatcher, enumerable: true, configurable: true, writable: true,
      });
      return (options.fetch ?? globalThis.fetch)(url, guardedInit);
    },
  };
}
