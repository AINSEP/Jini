import type { ClientRegistrationCache } from './ports.js';
import type { RegisteredOAuthClient } from './registration.js';
/** File I/O seam. Writes must be atomic and owner-only because registrations can contain secrets. */
export interface RegistrationCacheFilePort {
    read(requiredArgs: {
        readonly filePath: string;
    }): Promise<string | null>;
    writeAtomic(requiredArgs: {
        readonly filePath: string;
        readonly content: string;
    }): Promise<void>;
}
export interface FileClientRegistrationCacheOptions {
    readonly filePath: string;
    readonly fileIO: RegistrationCacheFilePort;
}
/** Optional file cache. Mutations are serialized per instance; apps must coordinate multiple writers. */
export function createFileClientRegistrationCache(options: FileClientRegistrationCacheOptions): ClientRegistrationCache {
    let queue = Promise.resolve();
    const read = async (): Promise<Map<string, RegisteredOAuthClient>> => {
        const content = await options.fileIO.read({
            filePath: options.filePath
        });
        if (content === null)
            return new Map();
        const rows: unknown = JSON.parse(content);
        if (!Array.isArray(rows) || !rows.every(validRow))
            throw new Error('invalid registration cache');
        return new Map(rows as [
            string,
            RegisteredOAuthClient
        ][]);
    };
    const mutate = (change: (entries: Map<string, RegisteredOAuthClient>) => void): Promise<void> => {
        const attempt = queue.then(async () => {
            const entries = await read();
            change(entries);
            await options.fileIO.writeAtomic({
                filePath: options.filePath,
                content: JSON.stringify([...entries])
            });
        });
        // A failed write must not permanently poison this adapter's queue.
        queue = attempt.catch(() => undefined);
        return attempt;
    };
    return {
        async get({ key }) { await queue; return structuredClone((await read()).get(key) ?? null); },
        set({ key, client }) {
            const snapshot = structuredClone(client);
            return mutate(entries => { entries.set(key, snapshot); });
        },
        delete({ key }) { return mutate(entries => { entries.delete(key); }); },
    };
}
function validRow(row: unknown): boolean {
    if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string')
        return false;
    const client: unknown = row[1];
    if (client === null || typeof client !== 'object')
        return false;
    const c = client as Record<string, unknown>;
    const nullableString = (value: unknown): boolean => value === null || typeof value === 'string';
    const nullableNumber = (value: unknown): boolean => value === null || (typeof value === 'number' && Number.isFinite(value));
    return typeof c.clientId === 'string' && c.clientId !== '' && nullableString(c.clientSecret)
        && ['none', 'client_secret_post', 'client_secret_basic'].includes(String(c.tokenEndpointAuthMethod))
        && nullableString(c.registrationClientUri) && nullableNumber(c.clientIdIssuedAt) && nullableNumber(c.clientSecretExpiresAt);
}
