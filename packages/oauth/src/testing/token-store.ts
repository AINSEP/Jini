import type { OAuthEmptyArgs } from '../args.js';
import type { OAuthTokenSet, OAuthTokenStore } from '../ports.js';
/** Single-process token store and compare-and-set leases. Production adapters own encryption and lease expiry. */
export function createMemoryTokenStore(_requiredArgs: OAuthEmptyArgs): OAuthTokenStore {
    const tokens = new Map<string, OAuthTokenSet>();
    const leases = new Set<string>();
    return {
        async load({ key }) { return structuredClone(tokens.get(key) ?? null); },
        async persist({ key, tokens: value }) { tokens.set(key, structuredClone(value)); },
        async markNeedsReauth({ key }) { tokens.delete(key); },
        async tryAcquireRefreshLease({ key }) {
            if (leases.has(key))
                return false;
            leases.add(key);
            return true;
        },
        async releaseRefreshLease({ key }) { leases.delete(key); },
    };
}
