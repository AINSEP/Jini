import { describe, expect, it } from 'vitest';
import {
  RegistryEntrySchema,
  RegistryManifestSchema,
  RegistryPublishOutcomeSchema,
  RegistryYankOutcomeSchema,
  ResolvedRegistryEntrySchema,
  type RegistryBackend,
  type RegistryBackendFactory,
} from '../registry.js';

const entry = RegistryEntrySchema.parse({
  name: 'vendor/example',
  version: '1.0.0',
  source: 'github:vendor/example@v1.0.0/plugin',
  title: 'Example',
  capabilitiesSummary: ['prompt:inject'],
});

describe('registry protocol', () => {
  it('requires stable vendor/plugin-name ids', () => {
    expect(() => RegistryEntrySchema.parse({ ...entry, name: 'example' })).toThrow();
    expect(RegistryEntrySchema.parse(entry).name).toBe('vendor/example');
  });

  it('accepts optional metrics and marketplace signatures for future hardening', () => {
    const parsed = RegistryEntrySchema.parse({
      ...entry,
      metrics: {
        downloads: 42,
        installs: 7,
      },
      signatures: [
        {
          kind: 'github-oidc',
          issuer: 'https://token.actions.githubusercontent.com',
          subject: 'repo:vendor/example:ref:refs/heads/main',
          signature: 'sha256-fixture',
        },
      ],
    });
    expect(parsed.metrics?.downloads).toBe(42);
    expect(parsed.signatures?.[0]?.kind).toBe('github-oidc');
  });

  it('keeps all backend implementations behind one async contract', async () => {
    const calls: unknown[] = [];
    const backend: RegistryBackend = {
      id: 'fixture',
      kind: 'local',
      trust: 'restricted',
      async list(requiredArgs, optionalArgs) {
        calls.push(['list', requiredArgs, optionalArgs]);
        return [entry];
      },
      async search({ query }, optionalArgs) {
        calls.push(['search', query, optionalArgs]);
        return query === 'Example' ? [{ entry, score: 1, matched: ['title'] }] : [];
      },
      async resolve({ name }, optionalArgs) {
        calls.push(['resolve', name, optionalArgs]);
        if (name !== entry.name) return null;
        return {
          backendId: this.id,
          backendKind: this.kind,
          trust: this.trust,
          verified: false,
          entry,
          version: { version: entry.version, source: entry.source },
          source: entry.source,
        };
      },
      async manifest({ name, version }) {
        return name === entry.name && version === entry.version ? entry : null;
      },
      async doctor(requiredArgs) {
        calls.push(['doctor', requiredArgs]);
        return {
          ok: true,
          backendId: this.id,
          checkedAt: 123,
          entriesChecked: 1,
          issues: [],
        };
      },
      async publish({ entry: publishedEntry }, options) {
        calls.push(['publish', publishedEntry, options]);
        return RegistryPublishOutcomeSchema.parse({
          ok: true,
          dryRun: options?.dryRun,
          changedFiles: [`plugins/${publishedEntry.name}/versions/${publishedEntry.version}.json`],
          warnings: [],
        });
      },
      async yank({ name, version, reason }) {
        return RegistryYankOutcomeSchema.parse({ ok: true, name, version, reason });
      },
    };

    await expect(backend.list({})).resolves.toHaveLength(1);
    await expect(backend.search({ query: 'Example' })).resolves.toHaveLength(1);
    await expect(backend.resolve({ name: 'vendor/example' })).resolves.toMatchObject({
      backendId: 'fixture',
      source: entry.source,
    });
    await expect(backend.doctor({})).resolves.toMatchObject({ ok: true, entriesChecked: 1 });
    await expect(backend.publish?.({ entry }, { dryRun: true })).resolves.toMatchObject({
      ok: true,
      dryRun: true,
    });
    await expect(backend.list({}, { includeYanked: true })).resolves.toEqual([entry]);
    await expect(backend.search({ query: 'Example' }, { limit: 1 })).resolves.toEqual([
      { entry, score: 1, matched: ['title'] },
    ]);
    await expect(backend.search({ query: 'missing' })).resolves.toEqual([]);
    await expect(backend.resolve({ name: entry.name }, { range: '^1.0.0' })).resolves.toMatchObject({ entry });
    await expect(backend.resolve({ name: 'vendor/missing' })).resolves.toBeNull();
    await expect(backend.manifest({ name: entry.name, version: entry.version })).resolves.toEqual(entry);
    await expect(backend.manifest({ name: entry.name, version: '2.0.0' })).resolves.toBeNull();
    await expect(backend.yank?.({ name: entry.name, version: entry.version, reason: 'security' })).resolves.toEqual({
      ok: true, name: entry.name, version: entry.version, reason: 'security', warnings: [],
    });
    expect(calls).toContainEqual(['list', {}, undefined]);
    expect(calls).toContainEqual(['list', {}, { includeYanked: true }]);
    expect(calls).toContainEqual(['search', 'Example', { limit: 1 }]);
    expect(calls).toContainEqual(['resolve', entry.name, { range: '^1.0.0' }]);
    expect(calls).toContainEqual(['doctor', {}]);
    expect(calls).toContainEqual(['publish', entry, { dryRun: true }]);

    const factory: RegistryBackendFactory<{ backend: RegistryBackend }> = {
      kind: 'local',
      create({ config }) { return config.backend; },
    };
    expect(factory.create({ config: { backend } })).toBe(backend);
  });

  it('defaults verified to false without requiring it, and never mutates what trust means (additive verification field)', () => {
    const withoutVerified = ResolvedRegistryEntrySchema.parse({
      backendId: 'fixture',
      backendKind: 'local',
      trust: 'official',
      entry,
      version: { version: entry.version, source: entry.source },
      source: entry.source,
    });
    expect(withoutVerified.verified).toBe(false);
    expect(withoutVerified.trust).toBe('official');
    expect(withoutVerified.verifiedIssuer).toBeUndefined();
    expect(withoutVerified.verifiedSubject).toBeUndefined();

    const verified = ResolvedRegistryEntrySchema.parse({
      backendId: 'fixture',
      backendKind: 'github',
      trust: 'restricted',
      verified: true,
      verifiedIssuer: 'https://token.actions.githubusercontent.com',
      verifiedSubject: 'https://github.com/vendor/example/.github/workflows/build.yml@refs/heads/main',
      entry,
      version: { version: entry.version, source: entry.source },
      source: entry.source,
    });
    expect(verified.verified).toBe(true);
    // `trust` is untouched by verification — still the backend-configured
    // value, proving this field sits alongside `trust` rather than deriving/narrowing it.
    expect(verified.trust).toBe('restricted');
    expect(verified.verifiedIssuer).toBe('https://token.actions.githubusercontent.com');
  });

  it('parses a manifest envelope of entries and rejects a missing entries array', () => {
    const manifest = RegistryManifestSchema.parse({
      specVersion: '1.0.0',
      name: 'fixture-registry',
      version: '0.0.0',
      entries: [entry],
    });
    expect(manifest.entries).toHaveLength(1);
    expect(() =>
      RegistryManifestSchema.parse({ specVersion: '1.0.0', name: 'fixture-registry', version: '0.0.0' }),
    ).toThrow();
  });

  it('requires a non-empty reason on a yank outcome', () => {
    expect(() =>
      RegistryYankOutcomeSchema.parse({ ok: true, name: entry.name, version: '1.0.0', reason: '' }),
    ).toThrow();
    expect(
      RegistryYankOutcomeSchema.parse({
        ok: true,
        name: entry.name,
        version: '1.0.0',
        reason: 'security',
      }).warnings,
    ).toEqual([]);
  });
});
