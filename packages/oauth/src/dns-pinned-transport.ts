import { isIP, type LookupFunction } from 'node:net';
import type { OAuthEmptyArgs } from './args.js';
import { OAuthError } from './errors.js';
import type { OAuthFetch, OAuthHttpPorts } from './ports.js';

export interface OAuthDnsAddress { readonly address: string; readonly family: number }
// OAuth destinations are supplied by callers or remote metadata. A URL-only precheck can pass a
// public DNS answer and still connect to a rebound private/link-local address. Validate the actual
// connection-time answer and hand that same address to the socket, without another DNS lookup.
export interface OAuthDnsPort {
  resolve(requiredArgs: { hostname: string }, optionalArgs?: { family?: number }): Promise<readonly OAuthDnsAddress[]>;
}
export interface OAuthAddressPolicyPort {
  assertAllowed(requiredArgs: OAuthDnsAddress & { hostname: string }): void;
}
export interface OAuthDispatcherPort {
  readonly dispatcher: NonNullable<RequestInit['dispatcher']>;
  close(requiredArgs: OAuthEmptyArgs): Promise<void>;
}
/** A Node adapter constructs its Undici Agent with this connection-time lookup. */
export interface OAuthDispatcherFactoryPort {
  create(requiredArgs: { lookup: LookupFunction }): OAuthDispatcherPort;
}
export interface DnsPinnedOAuthTransportDeps extends OAuthHttpPorts {
  readonly dns: OAuthDnsPort;
  readonly addressPolicy: OAuthAddressPolicyPort;
  readonly dispatcherFactory: OAuthDispatcherFactoryPort;
}
/** HTTP and shutdown ports owned by one dispatcher instance. */
export interface DnsPinnedOAuthTransport extends OAuthHttpPorts {
  close(requiredArgs: OAuthEmptyArgs): Promise<void>;
}

/** The actual socket lookup validates and returns the same addresses, without a second lookup.
 * Fetch must honor Undici's dispatcher extension. Pooling and shutdown belong to this instance.
 * Request objects retain their method, headers, body and abort signal; init overrides still apply.
 * @complexity Each lookup takes O(n) time and space for n resolved addresses.
 */
export function createDnsPinnedOAuthTransport(requiredArgs: DnsPinnedOAuthTransportDeps): DnsPinnedOAuthTransport {
  const { dns, addressPolicy, dispatcherFactory, guard } = requiredArgs;
  // Node owns this positional ABI; it is not a public library operation.
  const lookup = ((hostname: string, options: { all?: boolean; family?: number } | number,
    callback: (error: Error | null, address?: string | readonly OAuthDnsAddress[], family?: number) => void) => {
    const family = typeof options === 'number' ? options : options.family;
    const all = typeof options === 'object' && options.all === true;
    void dns.resolve({ hostname }, family === undefined ? {} : { family }).then(addresses => {
      if (addresses.length === 0) throw new Error('OAuth DNS lookup returned no addresses');
      // Snapshot before validation so mutable adapter results cannot change the checked address.
      const pinned = addresses.map(address => ({ address: address.address, family: address.family }));
      for (const address of pinned) addressPolicy.assertAllowed({ hostname, ...address });
      return pinned;
    }).then(addresses => {
      if (all) callback(null, addresses);
      else callback(null, addresses[0]!.address, addresses[0]!.family);
    }, error => callback(error instanceof Error ? error : new Error(String(error))));
  }) as unknown as LookupFunction;
  const port = dispatcherFactory.create({ lookup });
  const fetchFn: OAuthFetch = async ({ url }, init = {}) => {
    const raw = url instanceof Request ? url.url : String(url);
    const endpoint = guard.assertSafeUrl({ raw, label: 'OAuth outbound endpoint' });
    // Node skips lookup for IP literals. Check the exact dialed address here as well,
    // stripping URL brackets because net.isIP expects an unbracketed IPv6 address.
    const hostname = endpoint.hostname.replace(/^\[|\]$/g, '');
    const family = isIP(hostname);
    if (family !== 0) addressPolicy.assertAllowed({ hostname, address: hostname, family });
    const requestInit: RequestInit = { ...init, redirect: 'error', dispatcher: port.dispatcher };
    const requestUrl = url instanceof Request ? new Request(endpoint.href, url) : endpoint.href;
    const response = await requiredArgs.fetchFn({ url: requestUrl }, requestInit);
    // A redirect destination has not passed the address policy. The explicit response check also
    // catches injected fetch implementations that do not enforce redirect: 'error' themselves.
    if ((response.status >= 300 && response.status < 400) || response.type === 'opaqueredirect') {
      await response.body?.cancel().catch(() => undefined);
      throw new OAuthError({
        code: 'OAUTH_UNSAFE_ENDPOINT', message: 'refusing to follow an OAuth endpoint redirect',
        operatorAction: 'Configure the final HTTPS endpoint directly.',
      });
    }
    return response;
  };
  return { guard, fetchFn, close: args => port.close(args) };
}
