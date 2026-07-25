import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFileComposioConfigStore,
  FileConnectorCredentialStore,
  InMemoryConnectorCredentialStore,
  type ConnectorCredentialRecord,
} from '../../src/index.js';
import { withExclusiveFileLock } from '../../src/file-lock.js';

const temporaryDirectories: string[] = [];

function makeTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jini-composio-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Composio file stores', () => {
  it('persists config securely and clears auth ids when the API key changes', () => {
    const directory = makeTemporaryDirectory();
    const filePath = path.join(directory, 'nested', 'config.json');
    const store = createFileComposioConfigStore({ filePath });

    expect(store.read()).toEqual({ apiKey: '', authConfigIds: {} });
    expect(store.write({ apiKey: '  secret-key  ' })).toEqual({
      configured: true,
      apiKeyTail: '-key',
    });
    store.setAuthConfigId(' github ', ' auth_1 ');
    expect(store.read()).toEqual({
      apiKey: 'secret-key',
      authConfigIds: { github: 'auth_1' },
    });
    expect(store.readPublic()).toEqual({ configured: true, apiKeyTail: '-key' });
    store.deleteAuthConfigId('missing');
    store.deleteAuthConfigId('github');
    expect(store.read().authConfigIds).toEqual({});
    store.setAuthConfigId('github', 'auth_1');

    store.write({ apiKey: 'replacement-key' });
    expect(store.read().authConfigIds).toEqual({});
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(filePath)).mode & 0o777).toBe(0o700);
  });

  it('covers every config update and validation shape without losing stored ids', () => {
    expect(() => createFileComposioConfigStore({ filePath: ' ' })).toThrow('filePath');
    const directory = makeTemporaryDirectory();
    const filePath = path.join(directory, 'config.json');
    const store = createFileComposioConfigStore({ filePath });
    expect(store.readPublic()).toEqual({ configured: false, apiKeyTail: '' });
    store.write({ apiKey: 'key', authConfigIds: { github: 'auth_1' } });
    store.write({ authConfigIds: { slack: 'auth_2' } });
    expect(store.read()).toEqual({
      apiKey: 'key',
      authConfigIds: { slack: 'auth_2' },
    });
    store.write({});
    expect(store.read().authConfigIds).toEqual({ slack: 'auth_2' });
    store.write({ apiKey: null });
    expect(store.read()).toEqual({ apiKey: '', authConfigIds: {} });
    store.setAuthConfigId('', 'auth');
    store.setAuthConfigId('github', '');
    store.deleteAuthConfigId('');
    expect(store.read()).toEqual({ apiKey: '', authConfigIds: {} });
  });

  it('keeps config instances isolated and normalizes malformed persisted fields', () => {
    const directory = makeTemporaryDirectory();
    const firstPath = path.join(directory, 'first.json');
    const secondPath = path.join(directory, 'second.json');
    fs.writeFileSync(firstPath, JSON.stringify({
      apiKey: ' key ',
      authConfigIds: { github: ' auth_1 ', blank: '', invalid: 123 },
    }));

    const first = createFileComposioConfigStore({ filePath: firstPath });
    const second = createFileComposioConfigStore({ filePath: secondPath });
    expect(first.read()).toEqual({ apiKey: 'key', authConfigIds: { github: 'auth_1' } });
    expect(second.read()).toEqual({ apiKey: '', authConfigIds: {} });
  });

  it('round-trips cloned credential records with secret-safe permissions', () => {
    const directory = makeTemporaryDirectory();
    const filePath = path.join(directory, 'credentials', 'records.json');
    const store = new FileConnectorCredentialStore({ filePath });
    const record: ConnectorCredentialRecord = {
      schemaVersion: 1,
      connectorId: 'github',
      accountLabel: 'octocat',
      credentials: {
        provider: 'composio',
        providerConnectionId: 'ca_1',
        userId: 'user_1',
        connectorId: 'github',
        toolkitSlug: 'GITHUB',
        authConfigId: 'auth_1',
        validatedAt: '2026-07-23T00:00:00.000Z',
        nested: { token: 'secret' },
      },
      updatedAt: '2026-07-23T00:00:00.000Z',
    };

    store.set(record);
    const loaded = store.get('github')!;
    (loaded.credentials.nested as Record<string, string>).token = 'mutated';

    expect((store.get('github')!.credentials.nested as Record<string, string>).token).toBe('secret');
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(filePath)).mode & 0o777).toBe(0o700);

    store.delete('missing');
    store.delete('github');
    expect(store.get('github')).toBeUndefined();
    store.set(record);
    store.deleteByProvider('composio');
    expect(store.get('github')).toBeUndefined();
  });

  it('rejects malformed Composio credentials and oversized secret stores', () => {
    const directory = makeTemporaryDirectory();
    const credentialPath = path.join(directory, 'credentials.json');
    fs.writeFileSync(credentialPath, JSON.stringify({
      github: {
        schemaVersion: 1,
        connectorId: 'github',
        accountLabel: 'octocat',
        credentials: { provider: 'composio', providerConnectionId: 'ca_unvalidated' },
        updatedAt: '2026-07-23T00:00:00.000Z',
      },
    }));
    const credentials = new FileConnectorCredentialStore({ filePath: credentialPath });
    expect(credentials.get('github')).toBeUndefined();
    fs.writeFileSync(credentialPath, '{broken');
    expect(() => credentials.get('github')).toThrow();

    const configPath = path.join(directory, 'config.json');
    const config = createFileComposioConfigStore({ filePath: configPath });
    expect(() => config.write({ apiKey: 'x'.repeat(1024 * 1024 + 1) })).toThrow('exceeds');

    fs.writeFileSync(configPath, 'x'.repeat(1024 * 1024 + 1));
    expect(() => config.read()).toThrow('exceeds');
  });

  it('rejects an existing config symlink instead of following it', () => {
    const directory = makeTemporaryDirectory();
    const targetPath = path.join(directory, 'target-config.json');
    const linkPath = path.join(directory, 'config.json');
    fs.writeFileSync(targetPath, JSON.stringify({ apiKey: 'secret', authConfigIds: {} }), { mode: 0o600 });
    fs.symlinkSync(targetPath, linkPath);

    const store = createFileComposioConfigStore({ filePath: linkPath });
    expect(() => store.read()).toThrow();
  });

  it('rejects an existing credential symlink instead of following it', () => {
    const directory = makeTemporaryDirectory();
    const targetPath = path.join(directory, 'target-credentials.json');
    const linkPath = path.join(directory, 'credentials.json');
    fs.writeFileSync(targetPath, JSON.stringify({
      github: {
        schemaVersion: 1,
        connectorId: 'github',
        accountLabel: 'octocat',
        credentials: {
          provider: 'composio',
          providerConnectionId: 'ca_1',
          userId: 'user_1',
          connectorId: 'github',
          toolkitSlug: 'GITHUB',
          authConfigId: 'auth_1',
          validatedAt: '2026-07-24T00:00:00.000Z',
        },
        updatedAt: '2026-07-24T00:00:00.000Z',
      },
    }), { mode: 0o600 });
    fs.symlinkSync(targetPath, linkPath);

    const store = new FileConnectorCredentialStore({ filePath: linkPath });
    expect(() => store.get('github')).toThrow();
  });

  it('forces an existing config file to owner-only mode before accepting secrets', () => {
    const directory = makeTemporaryDirectory();
    const filePath = path.join(directory, 'config.json');
    fs.writeFileSync(filePath, JSON.stringify({ apiKey: 'secret', authConfigIds: {} }), { mode: 0o644 });
    fs.chmodSync(filePath, 0o644);

    expect(createFileComposioConfigStore({ filePath }).read()).toMatchObject({ apiKey: 'secret' });
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it('forces an existing credential file to owner-only mode before accepting secrets', () => {
    const directory = makeTemporaryDirectory();
    const filePath = path.join(directory, 'credentials.json');
    fs.writeFileSync(filePath, JSON.stringify({
      github: {
        schemaVersion: 1,
        connectorId: 'github',
        accountLabel: 'octocat',
        credentials: {
          provider: 'composio',
          providerConnectionId: 'ca_1',
          userId: 'user_1',
          connectorId: 'github',
          toolkitSlug: 'GITHUB',
          authConfigId: 'auth_1',
          validatedAt: '2026-07-24T00:00:00.000Z',
        },
        updatedAt: '2026-07-24T00:00:00.000Z',
      },
    }), { mode: 0o644 });
    fs.chmodSync(filePath, 0o644);

    expect(new FileConnectorCredentialStore({ filePath }).get('github')).toBeDefined();
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it('normalizes every malformed credential-file record shape independently', () => {
    expect(() => new FileConnectorCredentialStore({ filePath: ' ' })).toThrow('filePath');
    const directory = makeTemporaryDirectory();
    const credentialPath = path.join(directory, 'records.json');
    const store = new FileConnectorCredentialStore({ filePath: credentialPath });

    for (const topLevel of [null, [], 'invalid']) {
      fs.writeFileSync(credentialPath, JSON.stringify(topLevel));
      expect(store.get('anything')).toBeUndefined();
    }

    fs.writeFileSync(credentialPath, JSON.stringify({
      null_record: null,
      array_record: [],
      wrong_version: {
        schemaVersion: 2,
        connectorId: 'wrong_version',
        accountLabel: 'label',
        updatedAt: 'now',
        credentials: { provider: 'other' },
      },
      wrong_connector: {
        schemaVersion: 1,
        connectorId: 'other',
        accountLabel: 'label',
        updatedAt: 'now',
        credentials: { provider: 'other' },
      },
      wrong_label: {
        schemaVersion: 1,
        connectorId: 'wrong_label',
        accountLabel: 42,
        updatedAt: 'now',
        credentials: { provider: 'other' },
      },
      wrong_time: {
        schemaVersion: 1,
        connectorId: 'wrong_time',
        accountLabel: 'label',
        updatedAt: 42,
        credentials: { provider: 'other' },
      },
      missing_credentials: {
        schemaVersion: 1,
        connectorId: 'missing_credentials',
        accountLabel: 'label',
        updatedAt: 'now',
      },
      array_credentials: {
        schemaVersion: 1,
        connectorId: 'array_credentials',
        accountLabel: 'label',
        updatedAt: 'now',
        credentials: [],
      },
      valid: {
        schemaVersion: 1,
        connectorId: 'valid',
        accountLabel: 'label',
        updatedAt: 'now',
        credentials: { provider: 'other' },
      },
    }));
    expect(store.get('valid')).toMatchObject({
      connectorId: 'valid',
      credentials: { provider: 'other' },
    });
  });

  it('clones and deletes in-memory credential records by connector and provider', () => {
    const store = new InMemoryConnectorCredentialStore();
    const record: ConnectorCredentialRecord = {
      schemaVersion: 1,
      connectorId: 'github',
      accountLabel: 'octocat',
      credentials: {
        provider: 'composio',
        providerConnectionId: 'ca_1',
        userId: 'user_1',
        connectorId: 'github',
        toolkitSlug: 'GITHUB',
        authConfigId: 'auth_1',
        validatedAt: '2026-07-23T00:00:00.000Z',
      },
      updatedAt: '2026-07-23T00:00:00.000Z',
    };
    store.set(record);
    expect(store.get('github')).toEqual(record);
    store.delete('github');
    expect(store.get('github')).toBeUndefined();
    store.set(record);
    store.deleteByProvider('other');
    expect(store.get('github')).toBeDefined();
    store.deleteByProvider('composio');
    expect(store.get('github')).toBeUndefined();
  });

  it('serializes file mutations and releases only the caller-owned lock', () => {
    const directory = makeTemporaryDirectory();
    const filePath = path.join(directory, 'state.json');
    const lockPath = `${filePath}.lock`;

    expect(withExclusiveFileLock(filePath, () => {
      expect(fs.existsSync(lockPath)).toBe(true);
      return 42;
    })).toBe(42);
    expect(fs.existsSync(lockPath)).toBe(false);

    expect(() => withExclusiveFileLock(filePath, () => {
      throw new Error('operation failed');
    })).toThrow('operation failed');
    expect(fs.existsSync(lockPath)).toBe(false);

    expect(withExclusiveFileLock(filePath, () => {
      const callerOwnership = fs.readFileSync(lockPath, 'utf8');
      fs.unlinkSync(lockPath);
      fs.writeFileSync(lockPath, 'replacement-owner');
      return callerOwnership;
    })).not.toBe('');
    expect(fs.readFileSync(lockPath, 'utf8')).toBe('replacement-owner');
    fs.unlinkSync(lockPath);

    expect(withExclusiveFileLock(filePath, () => {
      fs.writeFileSync(lockPath, 'replacement-owner-on-same-inode');
      return 84;
    })).toBe(84);
    expect(fs.readFileSync(lockPath, 'utf8')).toBe('replacement-owner-on-same-inode');
    fs.unlinkSync(lockPath);
  });

  it('does not evict a live lock owner solely because its mtime is old', () => {
    const directory = makeTemporaryDirectory();
    const filePath = path.join(directory, 'state.json');
    const lockPath = `${filePath}.lock`;

    withExclusiveFileLock(filePath, () => {
      const callerOwnership = fs.readFileSync(lockPath, 'utf8');
      const base = Date.now();
      fs.utimesSync(lockPath, new Date(base - 31_000), new Date(base - 31_000));
      const now = vi.spyOn(Date, 'now')
        .mockReturnValueOnce(base)
        .mockReturnValue(base + 2_001);
      try {
        expect(() => withExclusiveFileLock(filePath, () => undefined)).toThrow('Timed out waiting');
      } finally {
        now.mockRestore();
      }
      expect(fs.readFileSync(lockPath, 'utf8')).toBe(callerOwnership);
    });
  });

  it('fails boundedly when another live process owns a file lock', () => {
    const directory = makeTemporaryDirectory();
    const filePath = path.join(directory, 'state.json');
    fs.writeFileSync(`${filePath}.lock`, 'owner');
    const now = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(2_001);
    try {
      expect(() => withExclusiveFileLock(filePath, () => undefined)).toThrow('Timed out waiting');
    } finally {
      now.mockRestore();
    }
  });

  it('surfaces non-contention lock and cleanup filesystem failures', () => {
    const directory = makeTemporaryDirectory();
    const filePath = path.join(directory, 'state.json');
    const open = vi.spyOn(fs, 'openSync').mockImplementationOnce(() => {
      const error = new Error('open denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      throw error;
    });
    expect(() => withExclusiveFileLock(filePath, () => undefined)).toThrow('open denied');
    open.mockRestore();

    fs.writeFileSync(`${filePath}.lock`, 'owner');
    const stat = vi.spyOn(fs, 'statSync').mockImplementationOnce(() => {
      const error = new Error('stat denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      throw error;
    });
    expect(() => withExclusiveFileLock(filePath, () => undefined)).toThrow('stat denied');
    stat.mockRestore();
    fs.unlinkSync(`${filePath}.lock`);

    expect(() => withExclusiveFileLock(filePath, () => {
      vi.spyOn(fs, 'unlinkSync').mockImplementationOnce(() => {
        const error = new Error('unlink denied') as NodeJS.ErrnoException;
        error.code = 'EACCES';
        throw error;
      });
    })).toThrow('unlink denied');
    vi.restoreAllMocks();
    fs.unlinkSync(`${filePath}.lock`);

    const realStatSync = fs.statSync.bind(fs);
    const cleanupStat = vi.spyOn(fs, 'statSync')
      .mockImplementationOnce((target) => realStatSync(target))
      .mockImplementationOnce(() => {
        const error = new Error('post-unlink stat denied') as NodeJS.ErrnoException;
        error.code = 'EACCES';
        throw error;
      });
    expect(() => withExclusiveFileLock(filePath, () => undefined)).toThrow(
      'post-unlink stat denied',
    );
    cleanupStat.mockRestore();
  });

  it('preserves records across independent store instances and cleans failed atomic writes', () => {
    const directory = makeTemporaryDirectory();
    const configPath = path.join(directory, 'shared-config.json');
    const firstConfig = createFileComposioConfigStore({ filePath: configPath });
    const secondConfig = createFileComposioConfigStore({ filePath: configPath });
    firstConfig.write({ apiKey: 'key' });
    firstConfig.setAuthConfigId('github', 'auth_github');
    secondConfig.setAuthConfigId('slack', 'auth_slack');
    expect(firstConfig.read().authConfigIds).toEqual({
      github: 'auth_github',
      slack: 'auth_slack',
    });

    const credentialPath = path.join(directory, 'shared-credentials.json');
    const firstCredentials = new FileConnectorCredentialStore({ filePath: credentialPath });
    const secondCredentials = new FileConnectorCredentialStore({ filePath: credentialPath });
    const record = (connectorId: string): ConnectorCredentialRecord => ({
      schemaVersion: 1,
      connectorId,
      accountLabel: connectorId,
      credentials: { provider: 'other', connectorId },
      updatedAt: '2026-07-23T00:00:00.000Z',
    });
    firstCredentials.set(record('github'));
    secondCredentials.set(record('slack'));
    expect(firstCredentials.get('github')).toBeDefined();
    expect(firstCredentials.get('slack')).toBeDefined();

    const failingConfigPath = path.join(directory, 'failing-config.json');
    const failingConfig = createFileComposioConfigStore({ filePath: failingConfigPath });
    const configRename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      const error = new Error('rename denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      throw error;
    });
    expect(() => failingConfig.write({ apiKey: 'key' })).toThrow('rename denied');
    configRename.mockRestore();
    expect(fs.readdirSync(directory).some((entry) => entry.includes('.tmp'))).toBe(false);

    const failingCredentialPath = path.join(directory, 'failing-credentials.json');
    const failingCredentials = new FileConnectorCredentialStore({ filePath: failingCredentialPath });
    const credentialRename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      const error = new Error('rename denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      throw error;
    });
    expect(() => failingCredentials.set(record('github'))).toThrow('rename denied');
    credentialRename.mockRestore();
    expect(fs.readdirSync(directory).some((entry) => entry.includes('.tmp'))).toBe(false);
  });

  it('surfaces atomic-write cleanup failures rather than hiding filesystem corruption', () => {
    const directory = makeTemporaryDirectory();
    const config = createFileComposioConfigStore({
      filePath: path.join(directory, 'config.json'),
    });
    const rename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      const error = new Error('rename denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      throw error;
    });
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementationOnce(() => {
      const error = new Error('cleanup denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      throw error;
    });
    expect(() => config.write({ apiKey: 'key' })).toThrow('cleanup denied');
    rename.mockRestore();
    unlink.mockRestore();

    const credentialStore = new FileConnectorCredentialStore({
      filePath: path.join(directory, 'credentials.json'),
    });
    const credentialRename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      const error = new Error('credential rename denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      throw error;
    });
    const credentialUnlink = vi.spyOn(fs, 'unlinkSync').mockImplementationOnce(() => {
      const error = new Error('credential cleanup denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      throw error;
    });
    expect(() => credentialStore.set({
      schemaVersion: 1,
      connectorId: 'github',
      accountLabel: 'octocat',
      credentials: { provider: 'other' },
      updatedAt: 'now',
    })).toThrow('credential cleanup denied');
    credentialRename.mockRestore();
    credentialUnlink.mockRestore();
  });

  it('rejects non-object and oversized credential material before persistence', () => {
    const memory = new InMemoryConnectorCredentialStore();
    expect(() => memory.set({
      schemaVersion: 1,
      connectorId: 'invalid',
      accountLabel: 'invalid',
      credentials: null as never,
      updatedAt: '2026-07-23T00:00:00.000Z',
    })).toThrow('bounded JSON object');

    const directory = makeTemporaryDirectory();
    const file = new FileConnectorCredentialStore({
      filePath: path.join(directory, 'oversized.json'),
    });
    expect(() => file.set({
      schemaVersion: 1,
      connectorId: 'large',
      accountLabel: 'large',
      credentials: {
        provider: 'other',
        first: 'x'.repeat(600_000),
        second: 'x'.repeat(600_000),
      },
      updatedAt: '2026-07-23T00:00:00.000Z',
    })).toThrow('exceed');
  });
});
