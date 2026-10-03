import type { OAuthEmptyArgs } from '../args.js';
import type { ClientRegistrationCache } from '../ports.js';
import type { RegisteredOAuthClient } from '../registration.js';
/** Independent memory cache; callers cannot mutate stored secrets through returned objects. */
export function createMemoryClientRegistrationCache(_requiredArgs: OAuthEmptyArgs): ClientRegistrationCache {
    const clients = new Map<string, RegisteredOAuthClient>();
    return {
        async get({ key }) { return structuredClone(clients.get(key) ?? null); },
        async set({ key, client }) { clients.set(key, structuredClone(client)); },
        async delete({ key }) { clients.delete(key); },
    };
}
