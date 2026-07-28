import { sign } from 'node:crypto';
import type { RegistryManifest } from '@injini/protocol';
import { describe, expect, it } from 'vitest';

import { GithubRegistryBackend, type GithubRegistryClient } from '../github-backend.js';
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

const manifest: RegistryManifest = {
  specVersion: '1.0.0',
  name: 'fixture',
  version: '1.0.0',
  entries: [
    {
      name: 'vendor/example',
      title: 'Example',
      description: 'Searchable fixture entry',
      version: '1.1.0',
      source: 'github:vendor/example@v1.1.0/entry',
      integrity: 'sha256:top',
      manifestDigest: 'sha256:digest',
      capabilitiesSummary: ['prompt:inject'],
    },
  ],
};

describe('GithubRegistryBackend', () => {
  it('reads the manifest at the default path/ref and serves it like a static backend', async () => {
    let readArgs: unknown[] = [];
    const client: GithubRegistryClient = {
      async readManifest(...args) {
        readArgs = args;
        return manifest;
      },
    };
    const backend = await GithubRegistryBackend.create({
      id: 'official',
      owner: 'acme',
      repo: 'registry',
      trust: 'official',
      client,
    });
    expect(readArgs).toEqual(['acme', 'registry', 'main', 'registry/index.json']);
    expect(backend.kind).toBe('github');
    expect(backend.trust).toBe('official');
    expect(backend.ref).toBe('main');
    expect(backend.manifestPath).toBe('registry/index.json');
    await expect(backend.resolve('vendor/example')).resolves.toMatchObject({ source: manifest.entries[0]?.source });
  });

  it('defaults trust to restricted when no explicit trust is configured (SEC-RB-005 / CR-009)', async () => {
    // There is no signature/allowlist proof tying a GitHub owner/repo/ref to
    // any trust class, so construction must not silently assert `official`
    // just because the source happens to be GitHub.
    const client: GithubRegistryClient = { async readManifest() { return manifest; } };
    const backend = await GithubRegistryBackend.create({ id: 'unlabeled', owner: 'acme', repo: 'registry', client });
    expect(backend.trust).toBe('restricted');
  });

  it('accepts an optional trustRoot constructor option and wires it into resolve()’s signature verification', async () => {
    const signedManifest: RegistryManifest = {
      ...manifest,
      entries: [
        {
          ...manifest.entries[0]!,
          signatures: [
            {
              kind: 'github-oidc',
              issuer: 'https://token.actions.githubusercontent.com',
              certificate: SELF_SIGNED_CA_CERT_PEM,
              signedAt: '2026-08-01T00:00:00Z',
              signature: sign('sha256', Buffer.from(canonicalRegistrySigningPayload(manifest.entries[0]!), 'utf8'), SELF_SIGNED_CA_KEY_PEM).toString('base64'),
            },
          ],
        },
      ],
    };
    const client: GithubRegistryClient = { async readManifest() { return signedManifest; } };

    const withoutTrustRoot = await GithubRegistryBackend.create({ id: 'official', owner: 'acme', repo: 'registry', client });
    await expect(withoutTrustRoot.resolve('vendor/example')).resolves.toMatchObject({ verified: false });

    const trustRoot: RegistryTrustRoot = { githubOidc: { caCertificates: [SELF_SIGNED_CA_CERT_PEM] } };
    const withTrustRoot = await GithubRegistryBackend.create({ id: 'official', owner: 'acme', repo: 'registry', client, trustRoot });
    await expect(withTrustRoot.resolve('vendor/example')).resolves.toMatchObject({
      verified: true,
      verifiedIssuer: 'https://token.actions.githubusercontent.com',
    });
  });

  it('honors an explicit ref/manifestPath', async () => {
    const client: GithubRegistryClient = { async readManifest() { return manifest; } };
    const backend = await GithubRegistryBackend.create({
      id: 'official',
      owner: 'acme',
      repo: 'registry',
      ref: 'release',
      manifestPath: 'custom/path.json',
      client,
    });
    expect(backend.ref).toBe('release');
    expect(backend.manifestPath).toBe('custom/path.json');
  });

  it('publish returns a dry-run payload with a warning when the client has no mutation capability', async () => {
    const client: GithubRegistryClient = { async readManifest() { return manifest; } };
    const backend = await GithubRegistryBackend.create({ id: 'official', owner: 'acme', repo: 'registry', client });
    const entry = manifest.entries[0]!;
    const outcome = await backend.publish?.({ entry });
    expect(outcome).toMatchObject({ ok: true, dryRun: true });
    expect(outcome?.warnings).toEqual(['github mutation client unavailable; emitted dry-run payload only']);
    expect(outcome?.changedFiles).toEqual(['entries/vendor/example/entry.json', 'entries/vendor/example/versions/1.1.0.json']);
  });

  it('publish returns a dry-run payload with no warning when request.dryRun is explicit and the client can mutate', async () => {
    const client: GithubRegistryClient = {
      async readManifest() { return manifest; },
      async createPublishPullRequest() { throw new Error('should not be called for a dry run'); },
    };
    const backend = await GithubRegistryBackend.create({ id: 'official', owner: 'acme', repo: 'registry', client });
    const outcome = await backend.publish?.({ entry: manifest.entries[0]!, dryRun: true });
    expect(outcome).toMatchObject({ ok: true, dryRun: true, warnings: [] });
  });

  it('publish opens a PR mutation with deterministic paths and a rendered body (with changelog)', async () => {
    let mutationFiles: string[] = [];
    let mutationBody = '';
    const client: GithubRegistryClient = {
      async readManifest() {
        return manifest;
      },
      async createPublishPullRequest(mutation) {
        mutationFiles = mutation.files.map((file) => file.path);
        mutationBody = mutation.body;
        expect(mutation.branchName).toBe('publish/vendor-example-1.1.0');
        expect(mutation.baseRef).toBe('main');
        return { url: 'https://github.com/acme/registry/pull/1' };
      },
    };
    const backend = await GithubRegistryBackend.create({ id: 'official', owner: 'acme', repo: 'registry', client });
    const outcome = await backend.publish?.({ entry: manifest.entries[0]!, changelog: 'Initial release' });
    expect(outcome).toMatchObject({ ok: true, dryRun: false, pullRequestUrl: 'https://github.com/acme/registry/pull/1' });
    expect(mutationFiles).toEqual(['entries/vendor/example/entry.json', 'entries/vendor/example/versions/1.1.0.json']);
    expect(mutationBody).toContain('Publish vendor/example@1.1.0');
    expect(mutationBody).toContain('- integrity: sha256:top');
    expect(mutationBody).toContain('- manifestDigest: sha256:digest');
    expect(mutationBody).toContain('## Changelog');
    expect(mutationBody).toContain('Initial release');
  });

  it('publish body falls back to dist-level integrity/digest and "(none declared)" capabilities when absent', async () => {
    const bareEntry = { name: 'vendor/bare', version: '1.0.0', source: 's', dist: { integrity: 'sha256:d', manifestDigest: 'sha256:m' } };
    let mutationBody = '';
    const client: GithubRegistryClient = {
      async readManifest() {
        return { ...manifest, entries: [bareEntry] };
      },
      async createPublishPullRequest(mutation) {
        mutationBody = mutation.body;
        return { url: 'https://github.com/acme/registry/pull/2' };
      },
    };
    const backend = await GithubRegistryBackend.create({ id: 'official', owner: 'acme', repo: 'registry', client });
    await backend.publish?.({ entry: bareEntry });
    expect(mutationBody).toContain('- integrity: sha256:d');
    expect(mutationBody).toContain('- manifestDigest: sha256:m');
    expect(mutationBody).toContain('(none declared)');
  });

  it('publish body shows "(pending)" when no integrity/digest is available anywhere', async () => {
    const bareEntry = { name: 'vendor/bare', version: '1.0.0', source: 's' };
    let mutationBody = '';
    const client: GithubRegistryClient = {
      async readManifest() {
        return { ...manifest, entries: [bareEntry] };
      },
      async createPublishPullRequest(mutation) {
        mutationBody = mutation.body;
        return { url: 'https://github.com/acme/registry/pull/3' };
      },
    };
    const backend = await GithubRegistryBackend.create({ id: 'official', owner: 'acme', repo: 'registry', client });
    await backend.publish?.({ entry: bareEntry });
    expect(mutationBody).toContain('- integrity: (pending)');
    expect(mutationBody).toContain('- manifestDigest: (pending)');
  });

  it('yank returns a dry-run outcome with a warning when the client has no mutation capability', async () => {
    const client: GithubRegistryClient = { async readManifest() { return manifest; } };
    const backend = await GithubRegistryBackend.create({ id: 'official', owner: 'acme', repo: 'registry', client });
    const outcome = await backend.yank?.('vendor/example', '1.1.0', 'security issue');
    expect(outcome).toMatchObject({ ok: true, dryRun: true, name: 'vendor/example', version: '1.1.0', reason: 'security issue' });
    expect(outcome?.warnings).toEqual(['github mutation client unavailable; emitted dry-run yank only']);
  });

  it('yank opens a PR mutation with a deterministic path and branch name', async () => {
    let mutationPath = '';
    const client: GithubRegistryClient = {
      async readManifest() {
        return manifest;
      },
      async createPublishPullRequest(mutation) {
        mutationPath = mutation.files[0]?.path ?? '';
        expect(mutation.branchName).toBe('yank/vendor-example-1.1.0');
        return { url: 'https://github.com/acme/registry/pull/4' };
      },
    };
    const backend = await GithubRegistryBackend.create({ id: 'official', owner: 'acme', repo: 'registry', client });
    const outcome = await backend.yank?.('vendor/example', '1.1.0', 'security issue');
    expect(mutationPath).toBe('entries/vendor/example/versions/1.1.0.json');
    expect(outcome).toMatchObject({ ok: true, dryRun: false, pullRequestUrl: 'https://github.com/acme/registry/pull/4' });
  });

  describe('input validation (SEC-RB-005 / CR-009)', () => {
    const client: GithubRegistryClient = {
      async readManifest() {
        return manifest;
      },
      async createPublishPullRequest() {
        throw new Error('should not be called when validation rejects the request first');
      },
    };

    it('publish rejects a path-traversal entry name', async () => {
      const backend = await GithubRegistryBackend.create({ id: 'official', owner: 'acme', repo: 'registry', client });
      await expect(backend.publish?.({ entry: { name: '../../etc/passwd', version: '1.0.0', source: 's' } })).rejects.toThrow(
        /invalid registry entry name/i,
      );
    });

    it('publish rejects a version containing a path separator', async () => {
      const backend = await GithubRegistryBackend.create({ id: 'official', owner: 'acme', repo: 'registry', client });
      await expect(
        backend.publish?.({ entry: { name: 'vendor/example', version: '1.0.0/../evil', source: 's' } }),
      ).rejects.toThrow(/invalid version/i);
    });

    it('yank rejects a path-traversal name', async () => {
      const backend = await GithubRegistryBackend.create({ id: 'official', owner: 'acme', repo: 'registry', client });
      await expect(backend.yank?.('../../etc/passwd', '1.0.0', 'reason')).rejects.toThrow(/invalid registry entry name/i);
    });

    it('yank rejects a version containing whitespace', async () => {
      const backend = await GithubRegistryBackend.create({ id: 'official', owner: 'acme', repo: 'registry', client });
      await expect(backend.yank?.('vendor/example', '1.0.0 ', 'reason')).rejects.toThrow(/invalid version/i);
    });

    it('yank rejects a reason containing control characters', async () => {
      const backend = await GithubRegistryBackend.create({ id: 'official', owner: 'acme', repo: 'registry', client });
      await expect(backend.yank?.('vendor/example', '1.0.0', 'reason\u0000injected')).rejects.toThrow(
        /control characters/i,
      );
    });

    it('publish rejects an entry that passes name/version path-safety but fails the wire schema otherwise', async () => {
      const backend = await GithubRegistryBackend.create({ id: 'official', owner: 'acme', repo: 'registry', client });
      // `name`/`version` are safe path segments, but `tags` is the wrong
      // type — `assertSafeEntryName`/`assertSafeVersion` alone would let
      // this through; the full-request schema check must not.
      await expect(
        backend.publish?.({ entry: { name: 'vendor/example', version: '1.0.0', source: 's', tags: 'not-an-array' } as never }),
      ).rejects.toThrow(/invalid registry publish request/i);
    });
  });

  describe('malformed remote manifest (SEC-RB-005)', () => {
    it('serves an empty list and a doctor malformed-manifest issue instead of crashing when the client returns entries that are not an array', async () => {
      const client: GithubRegistryClient = {
        async readManifest() {
          return { specVersion: '1.0.0', name: 'fixture', version: '1.0.0', entries: 'not-an-array' } as never;
        },
      };
      const backend = await GithubRegistryBackend.create({ id: 'official', owner: 'acme', repo: 'registry', client });
      await expect(backend.list()).resolves.toEqual([]);
      const report = await backend.doctor();
      expect(report).toMatchObject({ ok: false, entriesChecked: 0 });
      expect(report.issues).toEqual([expect.objectContaining({ code: 'malformed-manifest' })]);
    });
  });
});
