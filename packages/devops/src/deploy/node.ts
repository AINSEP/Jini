import type { LookupAddress, lookup } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Agent, type Dispatcher } from 'undici';
import { assertSafePublicUrl, createValidatingLookup } from '@jini-ai/platform';
import type { ReachabilityArgs } from './reachability.js';


function isLookupAddress(value: unknown): value is LookupAddress {
  if (value === null || typeof value !== 'object') return false;
  const hasAddress = 'address' in value && typeof value.address === 'string';
  return hasAddress && 'family' in value && typeof value.family === 'number';
}

/**
 * Socket-level lookup for deployment probes: platform's validating lookup (private-address
 * refusal) narrowed to the shapes Node's `net.connect` accepts — a single address string, or the
 * `{ address, family }[]` list returned for `all: true` lookups. Anything else is refused rather
 * than forwarded untyped to the socket.
 */
export function createReachabilityLookup(_required: Record<string, never>, { lookupImpl }: { lookupImpl?: typeof lookup } = {}): LookupFunction {
  const validatingLookup = createValidatingLookup(lookupImpl);
  return (hostname, options, callback) => {
    validatingLookup(hostname, options, (error, address, family) => {
      if (error) { callback(error, ''); return; }
      if (typeof address === 'string') { callback(null, address, family); return; }
      if (Array.isArray(address) && address.every(isLookupAddress)) { callback(null, address, family); return; }
      callback(new Error('DNS lookup returned an invalid address'), '');
    });
  };
}

export function createReachabilityDispatcher(_required: Record<string, never>, { lookupImpl }: { lookupImpl?: typeof lookup } = {}): Agent {
  return new Agent({ connect: { lookup: createReachabilityLookup({}, lookupImpl ? { lookupImpl } : {}) } });
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
