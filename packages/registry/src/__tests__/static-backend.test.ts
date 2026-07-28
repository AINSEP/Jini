import { sign } from 'node:crypto';
import type { RegistryManifest } from '@injini/protocol';
import { describe, expect, it } from 'vitest';

import { assertValidPublishRequest, StaticRegistryBackend } from '../static-backend.js';
import { canonicalRegistrySigningPayload, type RegistryTrustRoot } from '../trust.js';

// Self-signed test CA (chains to itself — see `trust.test.ts`'s equivalent
// fixture note for why this is enough to exercise real `node:crypto`
// signature-chain verification without a separate leaf cert pair).
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

function manifestOf(entries: RegistryManifest['entries']): RegistryManifest {
  return { specVersion: '1.0.0', name: 'fixture', version: '1.0.0', entries };
}

const exampleEntry = {
  name: 'vendor/example',
  title: 'Example',
  description: 'Searchable fixture entry',
  version: '1.1.0',
  source: 'github:vendor/example@v1.1.0/entry',
  versions: [
    { version: '1.0.0', source: 'github:vendor/example@v1.0.0/entry', integrity: 'sha256:old' },
    { version: '1.1.0', source: 'github:vendor/example@v1.1.0/entry', integrity: 'sha256:new' },
  ],
  distTags: { latest: '1.1.0' },
  license: 'MIT',
  capabilitiesSummary: ['prompt:inject'],
  tags: ['fixture'],
  publisher: { id: 'vendor', github: 'vendor-gh' },
};

describe('StaticRegistryBackend', () => {
  it('defaults kind to http when unspecified', () => {
    const backend = new StaticRegistryBackend({ id: 'fixture', trust: 'trusted', manifest: manifestOf([]) });
    expect(backend.kind).toBe('http');
  });

  it('lists non-yanked entries and drops malformed ones', async () => {
    const backend = new StaticRegistryBackend({
      id: 'fixture',
      trust: 'trusted',
      manifest: manifestOf([
        exampleEntry,
        { ...exampleEntry, name: 'vendor/yanked', yanked: true },
        { name: 'no-slash-invalid' } as never,
      ]),
    });
    const list = await backend.list();
    expect(list.map((e) => e.name)).toEqual(['vendor/example']);
  });

  describe('list filter contract (CR-009)', () => {
    function backendWithYankedFixture() {
      return new StaticRegistryBackend({
        id: 'fixture',
        trust: 'trusted',
        manifest: manifestOf([exampleEntry, { ...exampleEntry, name: 'vendor/yanked', yanked: true }]),
      });
    }

    it('drops yanked entries by default (no filter, and includeYanked: false)', async () => {
      const backend = backendWithYankedFixture();
      await expect(backend.list()).resolves.toEqual([expect.objectContaining({ name: 'vendor/example' })]);
      await expect(backend.list({ includeYanked: false })).resolves.toEqual([
        expect.objectContaining({ name: 'vendor/example' }),
      ]);
    });

    it('includes yanked entries when the filter explicitly asks for them', async () => {
      const backend = backendWithYankedFixture();
      const list = await backend.list({ includeYanked: true });
      expect(list.map((e) => e.name).sort()).toEqual(['vendor/example', 'vendor/yanked']);
    });

    it('filters by publisher id or github handle', async () => {
      const backend = new StaticRegistryBackend({
        id: 'fixture',
        trust: 'trusted',
        manifest: manifestOf([exampleEntry, { ...exampleEntry, name: 'vendor/other', publisher: { id: 'someone-else' } }]),
      });
      await expect(backend.list({ publisher: 'vendor' })).resolves.toEqual([
        expect.objectContaining({ name: 'vendor/example' }),
      ]);
      await expect(backend.list({ publisher: 'vendor-gh' })).resolves.toEqual([
        expect.objectContaining({ name: 'vendor/example' }),
      ]);
      await expect(backend.list({ publisher: 'nobody-matches-this' })).resolves.toEqual([]);
    });

    it('filters by tags (requires every requested tag)', async () => {
      const backend = new StaticRegistryBackend({
        id: 'fixture',
        trust: 'trusted',
        manifest: manifestOf([
          exampleEntry,
          { ...exampleEntry, name: 'vendor/other-tag', tags: ['other'] },
          { ...exampleEntry, name: 'vendor/no-tags', tags: undefined },
        ]),
      });
      await expect(backend.list({ tags: ['fixture'] })).resolves.toEqual([
        expect.objectContaining({ name: 'vendor/example' }),
      ]);
      await expect(backend.list({ tags: ['fixture', 'other'] })).resolves.toEqual([]);
    });

    it('filters by query text across name/title/description/tags/capabilities/publisher', async () => {
      const backend = new StaticRegistryBackend({
        id: 'fixture',
        trust: 'trusted',
        manifest: manifestOf([exampleEntry, { ...exampleEntry, name: 'vendor/unrelated', description: 'nothing to do with it', title: '', tags: [], capabilitiesSummary: [] }]),
      });
      await expect(backend.list({ query: 'Searchable' })).resolves.toEqual([
        expect.objectContaining({ name: 'vendor/example' }),
      ]);
      await expect(backend.list({ query: 'no-such-term-anywhere' })).resolves.toEqual([]);
    });

    it('search passes includeYanked through to list instead of unconditionally dropping yanked entries', async () => {
      const backend = backendWithYankedFixture();
      const defaultResults = await backend.search({ query: '' });
      expect(defaultResults.map((r) => r.entry.name)).toEqual(['vendor/example']);

      const withYanked = await backend.search({ query: '', includeYanked: true });
      expect(withYanked.map((r) => r.entry.name).sort()).toEqual(['vendor/example', 'vendor/yanked']);
    });
  });

  it('resolves exact versions and dist-tags from the manifest', async () => {
    const backend = new StaticRegistryBackend({ id: 'fixture', trust: 'trusted', manifest: manifestOf([exampleEntry]) });
    await expect(backend.resolve('vendor/example')).resolves.toMatchObject({
      source: 'github:vendor/example@v1.1.0/entry',
      integrity: 'sha256:new',
    });
    await expect(backend.resolve('vendor/example@1.0.0')).resolves.toMatchObject({
      source: 'github:vendor/example@v1.0.0/entry',
      integrity: 'sha256:old',
    });
    await expect(backend.manifest('vendor/example', '1.0.0')).resolves.toMatchObject({ name: 'vendor/example' });
  });

  it('resolve returns null for an unknown name or an unsatisfiable range', async () => {
    const backend = new StaticRegistryBackend({ id: 'fixture', trust: 'trusted', manifest: manifestOf([exampleEntry]) });
    await expect(backend.resolve('vendor/missing')).resolves.toBeNull();
    await expect(backend.resolve('vendor/example', '^9.0.0')).resolves.toBeNull();
    await expect(backend.manifest('vendor/missing', '1.0.0')).resolves.toBeNull();
  });

  describe('resolve() signature verification (trustRoot) — additive alongside trust, SEC-RB-005 remainder', () => {
    it('reports verified: false and no verifiedIssuer/verifiedSubject when no trustRoot is configured (unchanged default)', async () => {
      const backend = new StaticRegistryBackend({ id: 'fixture', trust: 'official', manifest: manifestOf([exampleEntry]) });
      const resolved = await backend.resolve('vendor/example');
      expect(resolved).toMatchObject({ trust: 'official', verified: false });
      expect(resolved).not.toHaveProperty('verifiedIssuer');
      expect(resolved).not.toHaveProperty('verifiedSubject');
    });

    it('reports verified: false when the entry has no signatures even though a trustRoot is configured', async () => {
      const backend = new StaticRegistryBackend({
        id: 'fixture',
        trust: 'restricted',
        manifest: manifestOf([exampleEntry]),
        trustRoot: { githubOidc: { caCertificates: [SELF_SIGNED_CA_CERT_PEM] } },
      });
      await expect(backend.resolve('vendor/example')).resolves.toMatchObject({ verified: false });
    });

    it('reports verified: true with verifiedIssuer/verifiedSubject, while `trust` stays exactly what the backend was configured with', async () => {
      const signedEntry = {
        ...exampleEntry,
        signatures: [
          {
            kind: 'github-oidc' as const,
            issuer: 'https://token.actions.githubusercontent.com',
            subject: 'repo:vendor/example:ref:refs/heads/main',
            certificate: SELF_SIGNED_CA_CERT_PEM,
            signedAt: '2026-08-01T00:00:00Z',
            signature: sign('sha256', Buffer.from(canonicalRegistrySigningPayload(exampleEntry), 'utf8'), SELF_SIGNED_CA_KEY_PEM).toString('base64'),
          },
        ],
      };
      const trustRoot: RegistryTrustRoot = { githubOidc: { caCertificates: [SELF_SIGNED_CA_CERT_PEM] } };
      const backend = new StaticRegistryBackend({ id: 'fixture', trust: 'restricted', manifest: manifestOf([signedEntry]), trustRoot });
      const resolved = await backend.resolve('vendor/example');
      expect(resolved).toMatchObject({
        trust: 'restricted',
        verified: true,
        verifiedIssuer: 'https://token.actions.githubusercontent.com',
        verifiedSubject: 'repo:vendor/example:ref:refs/heads/main',
      });
    });
  });

  it('search matches by name/title/description/tags/capabilities/publisher, filters by tag, and sorts by score then name', async () => {
    const backend = new StaticRegistryBackend({
      id: 'fixture',
      trust: 'trusted',
      manifest: manifestOf([
        exampleEntry,
        { ...exampleEntry, name: 'vendor/aaa-tagged-only', description: '', title: '', tags: ['fixture'], capabilitiesSummary: [] },
      ]),
    });
    const results = await backend.search({ query: 'Searchable', tags: ['fixture'] });
    expect(results).toHaveLength(1);
    expect(results[0]?.entry.name).toBe('vendor/example');

    const allTagged = await backend.search({ query: '' });
    expect(allTagged.map((r) => r.entry.name)).toEqual(['vendor/aaa-tagged-only', 'vendor/example']);
    expect(allTagged[0]?.score).toBe(0);
  });

  it('search filters out entries missing a required tag (including one with no tags field at all) and respects the limit', async () => {
    const backend = new StaticRegistryBackend({
      id: 'fixture',
      trust: 'trusted',
      manifest: manifestOf([
        exampleEntry,
        { ...exampleEntry, name: 'vendor/other', tags: ['other'] },
        { name: 'vendor/bare', version: '1.0.0', source: 's' },
      ]),
    });
    await expect(backend.search({ query: '', tags: ['fixture'] })).resolves.toHaveLength(1);
    await expect(backend.search({ query: '', limit: 1 })).resolves.toHaveLength(1);
  });

  it('search matches a bare entry with no title/description via its name alone', async () => {
    const backend = new StaticRegistryBackend({
      id: 'fixture',
      trust: 'trusted',
      manifest: manifestOf([{ name: 'vendor/bare', version: '1.0.0', source: 's' }]),
    });
    await expect(backend.search({ query: 'bare' })).resolves.toHaveLength(1);
  });

  it('search excludes entries whose text does not contain every query term', async () => {
    const backend = new StaticRegistryBackend({ id: 'fixture', trust: 'trusted', manifest: manifestOf([exampleEntry]) });
    await expect(backend.search({ query: 'no-such-term-anywhere' })).resolves.toEqual([]);
  });

  describe('doctor', () => {
    it('reports ok with no issues for a well-formed entry', async () => {
      const backend = new StaticRegistryBackend({ id: 'fixture', trust: 'trusted', manifest: manifestOf([exampleEntry]) });
      const report = await backend.doctor();
      expect(report).toMatchObject({ ok: true, backendId: 'fixture', entriesChecked: 1, issues: [] });
    });

    it('flags a raw entry that is not a valid object instead of throwing (CR-009)', async () => {
      const backend = new StaticRegistryBackend({
        id: 'fixture',
        trust: 'trusted',
        manifest: {
          specVersion: '1.0.0',
          name: 'fixture',
          version: '1.0.0',
          // `doctor` deliberately walks RAW, unvalidated entries — a caller
          // can hand it a manifest that never went through
          // `RegistryManifestSchema`, so a null/primitive "entry" must be
          // reported, not dereferenced and crashed on.
          entries: [null, 'not-an-object', 42, exampleEntry] as never,
        },
      });
      const report = await backend.doctor();
      expect(report).toMatchObject({ ok: false, entriesChecked: 4 });
      const malformed = report.issues.filter((issue) => issue.code === 'malformed-entry');
      expect(malformed).toHaveLength(3);
    });

    it('flags an invalid name', async () => {
      const backend = new StaticRegistryBackend({
        id: 'fixture',
        trust: 'trusted',
        manifest: { specVersion: '1.0.0', name: 'fixture', version: '1.0.0', entries: [{ ...exampleEntry, name: 'bad name', source: 'x' }] },
      });
      const report = await backend.doctor();
      expect(report.ok).toBe(false);
      expect(report.issues).toContainEqual(expect.objectContaining({ code: 'invalid-name' }));
    });

    it('flags a missing source when dist.archive is also absent', async () => {
      const backend = new StaticRegistryBackend({
        id: 'fixture',
        trust: 'trusted',
        manifest: manifestOf([{ name: 'vendor/example', source: '', version: '1.0.0' }]),
      });
      const report = await backend.doctor();
      expect(report.issues).toContainEqual(expect.objectContaining({ code: 'missing-source' }));
    });

    it('does not flag missing-source when dist.archive is present', async () => {
      const backend = new StaticRegistryBackend({
        id: 'fixture',
        trust: 'trusted',
        manifest: manifestOf([{ name: 'vendor/example', source: '', version: '1.0.0', dist: { archive: 'a.tar.gz' } }]),
      });
      const report = await backend.doctor();
      expect(report.issues.some((i) => i.code === 'missing-source')).toBe(false);
    });

    it('flags missing license and missing capabilities as warnings without failing ok', async () => {
      const backend = new StaticRegistryBackend({
        id: 'fixture',
        trust: 'trusted',
        manifest: manifestOf([{ name: 'vendor/example', source: 's', version: '1.0.0' }]),
      });
      const report = await backend.doctor();
      expect(report.ok).toBe(true);
      expect(report.issues).toContainEqual(expect.objectContaining({ code: 'missing-license', severity: 'warning' }));
      expect(report.issues).toContainEqual(expect.objectContaining({ code: 'missing-capabilities', severity: 'warning' }));
    });

    it('flags a yanked entry with no yank reason', async () => {
      const backend = new StaticRegistryBackend({
        id: 'fixture',
        trust: 'trusted',
        manifest: {
          specVersion: '1.0.0',
          name: 'fixture',
          version: '1.0.0',
          entries: [{ ...exampleEntry, yanked: true, yankReason: undefined }],
        },
      });
      const report = await backend.doctor();
      expect(report.ok).toBe(false);
      expect(report.issues).toContainEqual(expect.objectContaining({ code: 'missing-yank-reason' }));
    });

    it('flags an entry object with no name property at all (not just an invalid one)', async () => {
      const backend = new StaticRegistryBackend({
        id: 'fixture',
        trust: 'trusted',
        manifest: manifestOf([{ source: 's', version: '1.0.0' } as never]),
      });
      const report = await backend.doctor();
      expect(report.ok).toBe(false);
      expect(report.issues).toContainEqual(expect.objectContaining({ code: 'invalid-name', pluginName: undefined }));
    });

    it('flags a malformed manifest envelope (entries missing or not an array) instead of throwing', async () => {
      const backend = new StaticRegistryBackend({
        id: 'fixture',
        trust: 'trusted',
        // Simulates a manifest that never went through `RegistryManifestSchema`
        // — e.g. `GithubRegistryBackend` reading a malformed JSON file through
        // an injected client with no schema guarantee.
        manifest: { specVersion: '1.0.0', name: 'fixture', version: '1.0.0', entries: 'not-an-array' } as never,
      });
      const report = await backend.doctor();
      expect(report).toMatchObject({ ok: false, entriesChecked: 0 });
      expect(report.issues).toEqual([expect.objectContaining({ code: 'malformed-manifest', severity: 'error' })]);
    });

    it('flags a manifest with entries entirely missing (undefined), not just non-array', async () => {
      const backend = new StaticRegistryBackend({
        id: 'fixture',
        trust: 'trusted',
        manifest: { specVersion: '1.0.0', name: 'fixture', version: '1.0.0' } as never,
      });
      const report = await backend.doctor();
      expect(report).toMatchObject({ ok: false, entriesChecked: 0 });
      expect(report.issues).toEqual([expect.objectContaining({ code: 'malformed-manifest' })]);
    });
  });

  describe('malformed manifest envelope on the read paths (list/search/resolve)', () => {
    // A manifest whose `entries` isn't even an array — `list`/`search`/`resolve`
    // must degrade to "no entries" rather than crash with a bare TypeError from
    // deep inside `flatMap`/`for...of`.
    const malformedManifest = { specVersion: '1.0.0', name: 'fixture', version: '1.0.0', entries: null } as unknown as RegistryManifest;

    it('list returns an empty array instead of throwing', async () => {
      const backend = new StaticRegistryBackend({ id: 'fixture', trust: 'trusted', manifest: malformedManifest });
      await expect(backend.list()).resolves.toEqual([]);
    });

    it('search returns an empty array instead of throwing', async () => {
      const backend = new StaticRegistryBackend({ id: 'fixture', trust: 'trusted', manifest: malformedManifest });
      await expect(backend.search({ query: '' })).resolves.toEqual([]);
    });

    it('resolve returns null instead of throwing', async () => {
      const backend = new StaticRegistryBackend({ id: 'fixture', trust: 'trusted', manifest: malformedManifest });
      await expect(backend.resolve('vendor/example')).resolves.toBeNull();
    });
  });

  describe('assertValidPublishRequest', () => {
    it('returns the parsed request unchanged when it conforms to the schema', () => {
      const request = { entry: exampleEntry, dryRun: true, tag: 'latest' };
      const parsed = assertValidPublishRequest(request);
      expect(parsed.entry.name).toBe('vendor/example');
      expect(parsed.dryRun).toBe(true);
      expect(parsed.tag).toBe('latest');
    });

    it('throws a clear error for a request whose entry fails the wire schema', () => {
      expect(() => assertValidPublishRequest({ entry: { name: 'vendor/example', version: '1.0.0', tags: 'not-an-array' } as never } as never)).toThrow(
        /invalid registry publish request/i,
      );
    });

    it('throws a clear error when entry.name does not match the vendor/name shape', () => {
      expect(() =>
        assertValidPublishRequest({ entry: { name: 'no-slash', version: '1.0.0', source: 's' } } as never),
      ).toThrow(/invalid registry publish request/i);
    });
  });
});
