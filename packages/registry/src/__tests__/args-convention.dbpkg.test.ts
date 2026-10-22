import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { StaticRegistryBackend } from '../static-backend.js';
import { DatabaseRegistryBackend, upsertRegistryEntry } from '../database-backend.js';
import { GithubApiRegistryClient } from '../github-client.js';
import { canonicalRegistrySigningPayload, verifyRegistrySignature } from '../trust.js';
import { createSqliteCatalogStoreFactory } from '../tool-catalog-builder/sqlite.js';
import { buildToolCatalogQuery, createLiveToolCatalogQuery } from '../tool-catalog-builder/query.js';
import { createSearchEnricher, createPrefixSourceClassifier } from '../tool-catalog-builder/search-enricher.js';

const entry = { name: 'vendor/example', version: '1.0.0', source: 'https://example.test/archive', integrity: 'sha256:fixture' };
const manifest = { specVersion: '1.0.0' as const, name: 'fixture', version: '1.0.0', entries: [entry] };

describe('registry object arguments and unchanged behavior', () => {
  it('preserves canonical bytes and fails closed without a trust root', () => {
    expect(canonicalRegistrySigningPayload({ entry })).toBe('vendor/example@1.0.0:sha256:fixture');
    expect(verifyRegistrySignature({ entry, signature: { kind: 'github-oidc', signature: 'AA==' } })).toEqual({
      verified: false, kind: 'github-oidc', reason: 'no github-oidc trust root configured',
    });
  });

  it('implements the protocol contract with optional filters and an injected diagnostic clock', async () => {
    const backend = new StaticRegistryBackend({ id: 'fixture', trust: 'restricted', manifest }, { clock: { nowMs: () => 123 } });
    expect(await backend.list({}, { query: 'example' })).toEqual([entry]);
    expect(await backend.resolve({ name: entry.name }, { range: '1.0.0' })).toMatchObject({ verified: false, source: entry.source });
    expect((await backend.doctor({})).checkedAt).toBe(123);
  });

  it('rejects unknown trust and backend modes before serving any entries', () => {
    expect(() => new StaticRegistryBackend({ id: 'fixture', trust: 'unknown' as never, manifest })).toThrow();
    expect(() => new StaticRegistryBackend({ id: 'fixture', trust: 'restricted', manifest }, { kind: 'unknown' as never })).toThrow();
  });

  it('retains dry-run isolation, timestamps and nonexistent-version yank outcomes', async () => {
    const db = new Database(':memory:');
    try {
      const backend = new DatabaseRegistryBackend({ id: 'fixture', db });
      await backend.publish({ entry }, { dryRun: true });
      expect(await backend.list({})).toEqual([]);
      upsertRegistryEntry({ db, backendId: 'fixture', entry }, { now: 987 });
      expect(db.prepare('SELECT updated_at FROM registry_entries').get()).toEqual({ updated_at: 987 });
      expect(await backend.yank({ name: entry.name, version: '9.0.0', reason: 'missing' })).toEqual({
        ok: false, name: entry.name, version: '9.0.0', reason: 'missing', warnings: ['vendor/example@9.0.0 not found'],
      });
    } finally { db.close(); }
  });

  it('passes the existing 15 second bound to the injected HTTP port and preserves errors', async () => {
    const send = vi.fn(async () => ({ status: 404, headers: {}, bodyText: '' }));
    const client = new GithubApiRegistryClient({ http: { send } });
    await expect(client.readManifest({ owner: 'acme', repo: 'registry', ref: 'main', path: 'index.json' }))
      .rejects.toThrow('Registry manifest not found: acme/registry@main:index.json');
    expect(send).toHaveBeenCalledWith({ request: {
      method: 'GET', url: 'https://api.github.com/repos/acme/registry/contents/index.json?ref=main',
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' },
      idleTimeoutMs: 15_000, totalDeadlineMs: 15_000,
    } });
  });

  it('propagates the transport timeout error object without changing its type or message', async () => {
    const failure = new Error('transport timeout');
    const client = new GithubApiRegistryClient({ http: { send: async () => { throw failure; } } });
    await expect(client.readManifest({ owner: 'acme', repo: 'registry', ref: 'main', path: 'index.json' }))
      .rejects.toBe(failure);
  });

  it('rejects an invalid build timestamp before creating any tables', () => {
    const db = new Database(':memory:');
    try {
      const factory = createSqliteCatalogStoreFactory({ db });
      expect(() => factory.create({ entries: [], builtAtIso: 'invalid' })).toThrow('catalog build timestamp must be valid');
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'tool_catalog%'").all()).toEqual([]);
    } finally { db.close(); }
  });

  it('merges the builder with SQLite without exposing indexed vocabulary and supports rebinding', () => {
    const db = new Database(':memory:');
    try {
      const source = { list: () => [{ id: 'page.edit', description: 'Edit pages', inputSchema: { type: 'object' } }] };
      const query = buildToolCatalogQuery({ source,
        storeFactory: createSqliteCatalogStoreFactory({ db }),
        enricher: createSearchEnricher({ marker: '\nVocabulary: ', keywords: { 'page.edit': 'revise' }, questions: {} }),
        classifier: createPrefixSourceClassifier({ separator: '.', fallbackSource: 'host' }),
        clock: { nowMs: () => Date.parse('2026-10-02T00:00:00.000Z') },
      });
      expect(query.search({ query: 'revise' })).toEqual([expect.objectContaining({ id: 'page.edit', description: 'Edit pages', source: 'page' })]);
      expect(query.describe({ id: 'page.edit' })).toMatchObject({ inputSchema: { type: 'object' } });
      expect(db.prepare('SELECT updated_at FROM tool_catalog').get()).toEqual({ updated_at: Date.parse('2026-10-02T00:00:00.000Z') });
      const live = createLiveToolCatalogQuery({ initial: query });
      live.rebind({ next: { search: () => [], describe: () => null } });
      expect(live.query.search({ query: 'revise' })).toEqual([]);
    } finally { db.close(); }
  });
});
