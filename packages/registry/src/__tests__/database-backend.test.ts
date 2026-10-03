import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sign } from 'node:crypto';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StaticRegistryBackend } from '../static-backend.js';
import { DatabaseRegistryBackend, ensureRegistryTables, upsertRegistryEntry } from '../database-backend.js';
import { canonicalRegistrySigningPayload, type RegistryTrustRoot } from '../trust.js';

// Self-signed test CA (chains to itself), matching `trust.test.ts`'s fixture.
const SELF_SIGNED_CA_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBkjCCATegAwIBAgIUK0avUXJe13wKID2ScGCeLXHryxswCgYIKoZIzj0EAwIw
HTEbMBkGA1UEAwwSVGVzdCBUcnVzdCBSb290IENBMCAXDTI2MDcyMjA0MTE0NloY
DzIxMjYwNjI4MDQxMTQ2WjAdMRswGQYDVQQDDBJUZXN0IFRydXN0IFJvb3QgQ0Ew
WTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQsZHk8F8ScSaJGOG0tAW7SSkBEEjOm
q0kh74AkGQuKczmIOU2EndCHzCydqrMjX+DRhQSj7WSEAmMKyV7s594mo1MwUTAd
BgNVHQ4EFgQU+r4ExVmN9YMomT3H7izT/GPBfUswHwYDVR0jBBgwFoAU+r4ExVmN
9YMomT3H7izT/GPBfUswDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNJADBG
AiEAjMZ3lNIJhM1605xWipWZEJVcGrS/yTuMAhfzvypOkA0CIQDpU8fpu6b50Eiz
34W2FiMqCxQrKGm/+Xe2RnIbqsqw+w==
-----END CERTIFICATE-----`;

const SELF_SIGNED_CA_KEY_PEM = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIFwuaGm+4pIT8qwcOOS4YrejKVuubs3Rhl0dZxmZY5ijoAoGCCqGSM49
AwEHoUQDQgAELGR5PBfEnEmiRjhtLQFu0kpARBIzpqtJIe+AJBkLinM5iDlNhJ3Q
h8wsnaqzI1/g0YUEo+1khAJjCsle7OfeJg==
-----END EC PRIVATE KEY-----`;

const entry = {
  name: 'vendor/example',
  title: 'Example',
  description: 'Searchable fixture entry',
  version: '1.1.0',
  source: 'github:vendor/example@v1.1.0/entry',
  versions: [
    { version: '1.0.0', source: 'github:vendor/example@v1.0.0/entry' },
    { version: '1.1.0', source: 'github:vendor/example@v1.1.0/entry' },
  ],
  distTags: { latest: '1.1.0' },
};

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
});

afterEach(() => {
  db.close();
});

describe('DatabaseRegistryBackend', () => {
  it('defaults trust to restricted and creates the table on construction', async () => {
    const backend = new DatabaseRegistryBackend({ id: 'fixture', db });
    expect(backend.kind).toBe('db');
    expect(backend.trust).toBe('restricted');
    await expect(backend.list({})).resolves.toEqual([]);
  });

  it('keeps behavior equivalent to a static backend seeded with the same entries', async () => {
    const staticBackend = new StaticRegistryBackend({ id: 'fixture', trust: 'trusted', manifest: { specVersion: '1.0.0', name: 'fixture', version: '1.0.0', entries: [entry] } });
    ensureRegistryTables({ db });
    for (const e of await staticBackend.list({})) {
      upsertRegistryEntry({ db, backendId: 'fixture', entry: e }, { now: 123 });
    }
    const databaseBackend = new DatabaseRegistryBackend({ id: 'fixture', db }, { trust: 'trusted' });

    await expect(databaseBackend.list({})).resolves.toEqual(await staticBackend.list({}));
    await expect(databaseBackend.search({ query: 'Searchable' })).resolves.toMatchObject([{ entry: { name: 'vendor/example' } }]);
    await expect(databaseBackend.resolve({ name: 'vendor/example' })).resolves.toMatchObject({ source: entry.source });
  });

  it('accepts an optional trustRoot constructor option and wires it into resolve()’s signature verification', async () => {
    const signedEntry = {
      ...entry,
      signatures: [
        {
          kind: 'github-oidc' as const,
          issuer: 'https://token.actions.githubusercontent.com',
          certificate: SELF_SIGNED_CA_CERT_PEM,
          signedAt: '2026-08-01T00:00:00Z',
          signature: sign('sha256', Buffer.from(canonicalRegistrySigningPayload({ entry }), 'utf8'), SELF_SIGNED_CA_KEY_PEM).toString('base64'),
        },
      ],
    };
    ensureRegistryTables({ db });
    upsertRegistryEntry({ db, backendId: 'fixture', entry: signedEntry }, { now: 123 });

    const withoutTrustRoot = new DatabaseRegistryBackend({ id: 'fixture', db });
    await expect(withoutTrustRoot.resolve({ name: 'vendor/example' })).resolves.toMatchObject({ verified: false });

    const trustRoot: RegistryTrustRoot = { githubOidc: { caCertificates: [SELF_SIGNED_CA_CERT_PEM] } };
    const withTrustRoot = new DatabaseRegistryBackend({ id: 'fixture', db }, { trustRoot });
    await expect(withTrustRoot.resolve({ name: 'vendor/example' })).resolves.toMatchObject({
      verified: true,
      verifiedIssuer: 'https://token.actions.githubusercontent.com',
    });
  });

  it('publish upserts the row and returns db:// changed-file paths', async () => {
    const backend = new DatabaseRegistryBackend({ id: 'fixture', db });
    const outcome = await backend.publish?.({ entry });
    expect(outcome).toMatchObject({
      ok: true,
      dryRun: false,
      changedFiles: ['db://fixture/entries/vendor/example', 'db://fixture/entries/vendor/example/versions/1.1.0'],
    });
    await expect(backend.list({})).resolves.toHaveLength(1);
  });

  it('publish called twice for the same name upserts (does not duplicate rows)', async () => {
    const backend = new DatabaseRegistryBackend({ id: 'fixture', db });
    await backend.publish?.({ entry });
    await backend.publish?.({ entry: { ...entry, version: '1.2.0', source: 's-1.2.0' } });
    const list = await backend.list({});
    expect(list).toHaveLength(1);
    expect(list[0]?.version).toBe('1.2.0');
  });

  it('publish with dryRun: true does not write to the database and reports dryRun: true (CR-009)', async () => {
    const backend = new DatabaseRegistryBackend({ id: 'fixture', db });
    const outcome = await backend.publish?.({ entry }, { dryRun: true });
    expect(outcome).toMatchObject({
      ok: true,
      dryRun: true,
      changedFiles: ['db://fixture/entries/vendor/example', 'db://fixture/entries/vendor/example/versions/1.1.0'],
    });
    // No row was actually written.
    await expect(backend.list({})).resolves.toEqual([]);
  });

  it('publish with dryRun: true on top of an already-published entry leaves the stored row untouched', async () => {
    const backend = new DatabaseRegistryBackend({ id: 'fixture', db });
    await backend.publish?.({ entry });
    await backend.publish?.({ entry: { ...entry, version: '9.9.9', source: 'should-not-be-stored' } }, { dryRun: true });
    const list = await backend.list({});
    expect(list).toHaveLength(1);
    expect(list[0]?.version).toBe('1.1.0');
  });

  it('yank returns ok:false with a warning when the entry does not exist', async () => {
    const backend = new DatabaseRegistryBackend({ id: 'fixture', db });
    const outcome = await backend.yank?.({ name: 'vendor/missing', version: '1.0.0', reason: 'security issue' });
    expect(outcome).toMatchObject({ ok: false, warnings: ['vendor/missing not found'] });
  });

  it('yank returns ok:false with a warning when the entry exists but the requested version does not (CR-009)', async () => {
    const backend = new DatabaseRegistryBackend({ id: 'fixture', db });
    await backend.publish?.({ entry });
    const outcome = await backend.yank?.({ name: 'vendor/example', version: '9.9.9', reason: 'security issue' });
    expect(outcome).toMatchObject({ ok: false, warnings: ['vendor/example@9.9.9 not found'] });

    // And it must not have mutated the stored entry.
    const row = db.prepare('SELECT entry_json FROM registry_entries WHERE backend_id = ? AND name = ?').get('fixture', 'vendor/example') as { entry_json: string };
    const stored = JSON.parse(row.entry_json);
    expect(stored.yanked).toBeUndefined();
    expect(stored.versions.every((v: { yanked?: boolean }) => !v.yanked)).toBe(true);
  });

  it('yank marks the specific version record yanked and, when it is the top version, the entry itself', async () => {
    const backend = new DatabaseRegistryBackend({ id: 'fixture', db });
    await backend.publish?.({ entry });
    const outcome = await backend.yank?.({ name: 'vendor/example', version: '1.1.0', reason: 'security issue' });
    expect(outcome).toMatchObject({ ok: true, name: 'vendor/example', version: '1.1.0', reason: 'security issue' });

    const row = db.prepare('SELECT entry_json FROM registry_entries WHERE backend_id = ? AND name = ?').get('fixture', 'vendor/example') as { entry_json: string };
    const stored = JSON.parse(row.entry_json);
    expect(stored.yanked).toBe(true);
    expect(stored.yankReason).toBe('security issue');
    expect(stored.versions.find((v: { version: string }) => v.version === '1.1.0').yanked).toBe(true);
  });

  it('yank on a non-top version marks only that version record, leaving the entry itself un-yanked', async () => {
    const backend = new DatabaseRegistryBackend({ id: 'fixture', db });
    await backend.publish?.({ entry });
    await backend.yank?.({ name: 'vendor/example', version: '1.0.0', reason: 'superseded' });

    const row = db.prepare('SELECT entry_json FROM registry_entries WHERE backend_id = ? AND name = ?').get('fixture', 'vendor/example') as { entry_json: string };
    const stored = JSON.parse(row.entry_json);
    expect(stored.yanked).toBeUndefined();
    expect(stored.versions.find((v: { version: string }) => v.version === '1.0.0').yanked).toBe(true);
    expect(stored.versions.find((v: { version: string }) => v.version === '1.1.0').yanked).toBeUndefined();
  });

  it('publish rejects a malformed entry instead of writing a row that would poison future reads (CR-009)', async () => {
    const backend = new DatabaseRegistryBackend({ id: 'fixture', db });
    // `name` doesn't match the `vendor/name` shape `RegistryEntrySchema`
    // requires — without validating on write, this would be stored as-is
    // and then `manifestFromDb()`/`parseStoredEntry()` would throw on every
    // subsequent list/search/resolve/doctor call for this backend, since
    // those trust that anything already in the table is schema-shaped.
    await expect(backend.publish?.({ entry: { name: 'no-slash', version: '1.0.0', source: 's' } } as never)).rejects.toThrow(
      /invalid registry publish request/i,
    );
    // Nothing was written, and the backend is still usable.
    await expect(backend.list({})).resolves.toEqual([]);
  });

  it('publish rejects an entry with a wrongly-typed field instead of writing it (CR-009)', async () => {
    const backend = new DatabaseRegistryBackend({ id: 'fixture', db });
    await expect(
      backend.publish?.({ entry: { name: 'vendor/example', version: '1.0.0', source: 's', tags: 'not-an-array' } as never }),
    ).rejects.toThrow(/invalid registry publish request/i);
    await expect(backend.list({})).resolves.toEqual([]);
  });

  it('yank falls back to a synthetic single-version list when the stored entry has no versions array', async () => {
    const backend = new DatabaseRegistryBackend({ id: 'fixture', db });
    const bare = { name: 'vendor/bare', version: '1.0.0', source: 's' };
    await backend.publish?.({ entry: bare });
    const outcome = await backend.yank?.({ name: 'vendor/bare', version: '1.0.0', reason: 'security issue' });
    expect(outcome).toMatchObject({ ok: true });

    const row = db.prepare('SELECT entry_json FROM registry_entries WHERE backend_id = ? AND name = ?').get('fixture', 'vendor/bare') as { entry_json: string };
    const stored = JSON.parse(row.entry_json);
    expect(stored.yanked).toBe(true);
  });

  describe('corrupt stored rows (CR-009)', () => {
    // Construct the backend against an empty (valid) table first, then
    // corrupt a row directly via raw SQL — simulating a row that some other
    // process/migration/bit-rot corrupted after the backend was created —
    // so the read paths under test are the ones that actually encounter it,
    // not `DatabaseRegistryBackend`'s own constructor-time manifest read.
    function corruptRow(entryJson: string) {
      db.prepare(
        `INSERT INTO registry_entries (backend_id, name, version, entry_json, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ).run('fixture', 'vendor/corrupt', '1.0.0', entryJson, Date.now());
    }

    it('list/search/resolve/doctor throw a clear error instead of an unhandled crash on invalid JSON', async () => {
      const backend = new DatabaseRegistryBackend({ id: 'fixture', db });
      corruptRow('{not valid json');

      await expect(backend.list({})).rejects.toThrow(/corrupt registry_entries row/i);
      await expect(backend.search({ query: '' })).rejects.toThrow(/corrupt registry_entries row/i);
      await expect(backend.resolve({ name: 'vendor/corrupt' })).rejects.toThrow(/corrupt registry_entries row/i);
      await expect(backend.doctor({})).rejects.toThrow(/corrupt registry_entries row/i);
    });

    it('throws a clear error when a stored row is valid JSON but fails RegistryEntrySchema', async () => {
      const backend = new DatabaseRegistryBackend({ id: 'fixture', db });
      corruptRow(JSON.stringify({ not: 'a valid registry entry' }));

      await expect(backend.list({})).rejects.toThrow(/corrupt registry_entries row/i);
    });

    it('yank throws a clear error rather than crashing when the stored row is corrupt', async () => {
      const backend = new DatabaseRegistryBackend({ id: 'fixture', db });
      corruptRow('{not valid json');

      await expect(backend.yank?.({ name: 'vendor/corrupt', version: '1.0.0', reason: 'reason' })).rejects.toThrow(/corrupt registry_entries row/i);
    });
  });

  describe('yank concurrency (read-modify-write atomicity)', () => {
    // `yank` reads a row, computes a new value from it, then writes the
    // result back. Run against a *file-backed* database (not `:memory:`,
    // which each connection would see independently) with a second,
    // independent connection to the same file standing in for a concurrent
    // writer (e.g. another daemon process sharing this database). This
    // proves `yank` now holds the row lock for its whole read-modify-write
    // instead of leaving a window between two separate auto-committing
    // statements where a concurrent writer could interleave and be silently
    // clobbered (a lost update).
    let dir: string;
    let file: string;
    let dbA: Database.Database;
    let dbB: Database.Database;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'registry-yank-lock-'));
      file = join(dir, 'registry.db');
      // better-sqlite3 defaults `timeout` (its busy-wait budget before
      // throwing SQLITE_BUSY) to 5000ms — set it low here so a genuine lock
      // conflict fails fast and deterministically instead of making this
      // test wait out that default on every run.
      dbA = new Database(file, { timeout: 50 });
      dbB = new Database(file, { timeout: 50 });
    });

    afterEach(() => {
      dbA.close();
      dbB.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it('holds the write lock across its own read and write, blocking a concurrent writer for the whole operation', async () => {
      const backend = new DatabaseRegistryBackend({ id: 'fixture', db: dbA });
      await backend.publish?.({ entry });

      // Intercept the exact moment `yank`'s SELECT executes and, from
      // *inside* that call, attempt a concurrent write via the second
      // connection — simulating another process writing to the same row in
      // what would, without a lock held across the whole operation, be the
      // gap between `yank`'s read and its later write.
      let concurrentWriteError: unknown = null;
      const originalPrepare = dbA.prepare.bind(dbA);
      const prepareSpy = vi.spyOn(dbA, 'prepare').mockImplementation((sql: string) => {
        const stmt = originalPrepare(sql);
        if (sql.includes('SELECT entry_json FROM registry_entries')) {
          const originalGet = stmt.get.bind(stmt);
          (stmt as unknown as { get: typeof stmt.get }).get = (...args: Parameters<typeof stmt.get>) => {
            try {
              dbB.prepare(`UPDATE registry_entries SET updated_at = updated_at WHERE backend_id = ? AND name = ?`).run(
                'fixture',
                'vendor/example',
              );
            } catch (error) {
              concurrentWriteError = error;
            }
            return originalGet(...args);
          };
        }
        return stmt;
      });

      const outcome = await backend.yank?.({ name: 'vendor/example', version: '1.1.0', reason: 'security issue' });
      prepareSpy.mockRestore();

      // The yank itself succeeds normally — it holds the lock, so it is
      // never contended against.
      expect(outcome).toMatchObject({ ok: true });
      // But the concurrent writer, attempting to write mid-yank, was
      // rejected: proof the whole read-modify-write ran under one lock.
      expect(concurrentWriteError).not.toBeNull();
      expect(String(concurrentWriteError)).toMatch(/SQLITE_BUSY|database is locked/i);
    });
  });
});
