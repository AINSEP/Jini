import { fixtureEntropy } from "./fixtures.js";
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { createFileClientRegistrationCache, createNodeRegistrationCacheFileIO } from '../src/index.js';
const client = {
    clientId: 'id', clientSecret: 'secret', tokenEndpointAuthMethod: 'none' as const,
    registrationClientUri: null, clientIdIssuedAt: null, clientSecretExpiresAt: 0,
};
test('file registration cache survives adapter recreation and writes owner-only atomic snapshots', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oauth-cache-'));
    try {
        const filePath = join(dir, 'clients.json');
        const first = createFileClientRegistrationCache({ filePath, fileIO: createNodeRegistrationCacheFileIO({ randomBytesFn: fixtureEntropy }) });
        expect(await first.get({
            key: 'missing'
        })).toBeNull();
        await Promise.all([first.set({
                key: 'a',
                client: client
            }), first.set({
                key: 'b',
                client: { ...client, clientId: 'other' }
            })]);
        const second = createFileClientRegistrationCache({ filePath, fileIO: createNodeRegistrationCacheFileIO({ randomBytesFn: fixtureEntropy }) });
        expect(await second.get({
            key: 'a'
        })).toEqual(client);
        expect((await second.get({
            key: 'b'
        }))!.clientId).toBe('other');
        expect((await stat(filePath)).mode & 0o777).toBe(0o600);
        const raw = await readFile(filePath, 'utf8');
        expect(JSON.parse(raw)).toHaveLength(2);
        await second.delete({
            key: 'a'
        });
        expect(await first.get({
            key: 'a'
        })).toBeNull();
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test('file cache reports corrupt documents and can be used again after the file is repaired', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oauth-cache-'));
    try {
        const filePath = join(dir, 'clients.json');
        const cache = createFileClientRegistrationCache({ filePath, fileIO: createNodeRegistrationCacheFileIO({ randomBytesFn: fixtureEntropy }) });
        await writeFile(filePath, '{corrupt');
        await expect(cache.set({
            key: 'a',
            client: client
        })).rejects.toThrow();
        await writeFile(filePath, '[]');
        await cache.set({
            key: 'a',
            client: client
        });
        expect(await cache.get({
            key: 'a'
        })).toEqual(client);
        await writeFile(filePath, JSON.stringify([['a', { clientId: 'only-an-id' }]]));
        await expect(cache.get({
            key: 'a'
        })).rejects.toThrow('invalid registration cache');
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
