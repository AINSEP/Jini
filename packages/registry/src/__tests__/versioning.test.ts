import type { RegistryEntry } from '@jini-ai/protocol';
import { describe, expect, it } from 'vitest';

import { parseRegistrySpecifier, resolveRegistryEntryVersion } from '../versioning.js';

describe('parseRegistrySpecifier', () => {
  it('returns the name alone when no range suffix is present (vendor/name form)', () => {
    expect(parseRegistrySpecifier('vendor/name')).toEqual({ name: 'vendor/name' });
  });

  it('splits a vendor/name@version specifier into name + range', () => {
    expect(parseRegistrySpecifier('vendor/name@1.0.0')).toEqual({ name: 'vendor/name', range: '1.0.0' });
  });

  it('preserves caret/tilde range markers in the range field', () => {
    expect(parseRegistrySpecifier('vendor/name@^1.0.0')).toEqual({ name: 'vendor/name', range: '^1.0.0' });
    expect(parseRegistrySpecifier('vendor/name@~1.2.3')).toEqual({ name: 'vendor/name', range: '~1.2.3' });
  });

  it('preserves dist-tag style ranges like "latest"', () => {
    expect(parseRegistrySpecifier('vendor/name@latest')).toEqual({ name: 'vendor/name', range: 'latest' });
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(parseRegistrySpecifier('  vendor/name@1.0.0  ')).toEqual({ name: 'vendor/name', range: '1.0.0' });
  });

  it('treats a bare name without a slash as the whole specifier (no range split)', () => {
    // Without a `vendor/` segment, the `@` is interpreted as part of the name
    // (e.g. an org-scoped namespace), not a version separator.
    expect(parseRegistrySpecifier('name@1.0.0')).toEqual({ name: 'name@1.0.0' });
  });

  it('drops a trailing bare @ with nothing after it', () => {
    expect(parseRegistrySpecifier('vendor/name@')).toEqual({ name: 'vendor/name' });
  });
});

function entry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    name: 'vendor/example',
    source: 'github:vendor/example@v1.0.0/entry',
    version: '1.0.0',
    ...overrides,
  } as RegistryEntry;
}

describe('resolveRegistryEntryVersion', () => {
  it('returns null for a yanked entry regardless of requested range', () => {
    const e = entry({ yanked: true, version: '1.0.0' });
    expect(resolveRegistryEntryVersion(e)).toBeNull();
    expect(resolveRegistryEntryVersion(e, '1.0.0')).toBeNull();
  });

  it('defaults to distTags.latest when no range is requested', () => {
    const e = entry({
      version: '1.0.0',
      distTags: { latest: '1.2.0' },
      versions: [
        { version: '1.0.0', source: 'github:vendor/example@v1.0.0/entry' },
        { version: '1.2.0', source: 'github:vendor/example@v1.2.0/entry' },
      ],
    });
    expect(resolveRegistryEntryVersion(e)?.version).toBe('1.2.0');
  });

  it('defaults to the entry version when distTags is absent and no versions match', () => {
    const e = entry({ version: '1.0.0' });
    expect(resolveRegistryEntryVersion(e)?.version).toBe('1.0.0');
  });

  it('falls back to the first non-yanked version when entry has no version/distTags', () => {
    const e = entry({
      version: undefined as unknown as string,
      versions: [
        { version: '1.0.0', source: 's1', yanked: true },
        { version: '1.1.0', source: 's2' },
      ],
    });
    expect(resolveRegistryEntryVersion(e)?.version).toBe('1.1.0');
  });

  it('returns null instead of silently serving a yanked version when it is the resolved DEFAULT (no range requested)', () => {
    // Distinct from the "specific yanked version requested directly" case
    // further down: here no range/version is requested at all, so
    // resolution falls through to `distTags.latest`/`entry.version` — which
    // can themselves name a version that is present in the `versions`
    // ledger but marked yanked there. Without this final yanked check, a
    // caller asking for "whatever the default is" would silently receive a
    // yanked release's source/integrity instead of `null`.
    const viaDistTagsLatest = entry({
      version: '9.9.9', // deliberately different from distTags.latest, so this proves distTags wins
      distTags: { latest: '1.0.0' },
      versions: [{ version: '1.0.0', source: 's1', yanked: true }],
    });
    expect(resolveRegistryEntryVersion(viaDistTagsLatest)).toBeNull();

    const viaTopLevelVersion = entry({
      version: '1.0.0',
      distTags: undefined,
      versions: [{ version: '1.0.0', source: 's1', yanked: true }],
    });
    expect(resolveRegistryEntryVersion(viaTopLevelVersion)).toBeNull();
  });

  it('picks the highest matching version for a caret range, ignoring out-of-major candidates', () => {
    const e = entry({
      version: '2.0.0',
      versions: [
        { version: '1.0.0', source: 's1' },
        { version: '1.1.5', source: 's115' },
        { version: '1.2.0', source: 's120' },
        { version: '2.0.0', source: 's200' },
      ],
    });
    const resolved = resolveRegistryEntryVersion(e, '^1.0.0');
    expect(resolved?.version).toBe('1.2.0');
    expect(resolved?.source).toBe('s120');
  });

  it('locks the minor for a 0.x caret range (^0.2.0 excludes 0.3.0)', () => {
    const e = entry({
      version: '0.3.0',
      versions: [
        { version: '0.2.0', source: 's020' },
        { version: '0.2.5', source: 's025' },
        { version: '0.3.0', source: 's030' },
      ],
    });
    const resolved = resolveRegistryEntryVersion(e, '^0.2.0');
    expect(resolved?.version).toBe('0.2.5');
    expect(resolved?.source).toBe('s025');
  });

  it('locks the patch for a 0.0.x caret range (^0.0.3 excludes 0.0.4)', () => {
    const e = entry({
      version: '0.0.4',
      versions: [
        { version: '0.0.3', source: 's003' },
        { version: '0.0.4', source: 's004' },
      ],
    });
    expect(resolveRegistryEntryVersion(e, '^0.0.3')?.version).toBe('0.0.3');
  });

  it('excludes prerelease candidates from a non-prerelease caret range', () => {
    const e = entry({
      version: '0.2.1-beta.1',
      versions: [
        { version: '0.2.0', source: 's020' },
        { version: '0.2.1-beta.1', source: 's021b' },
      ],
    });
    expect(resolveRegistryEntryVersion(e, '^0.2.0')?.version).toBe('0.2.0');

    const patch = entry({
      version: '0.0.3-beta.1',
      versions: [{ version: '0.0.3-beta.1', source: 's003b' }],
    });
    expect(resolveRegistryEntryVersion(patch, '^0.0.3')).toBeNull();
  });

  it('matches same-tuple prereleases when the caret range is itself a prerelease', () => {
    const e = entry({
      version: '0.2.1',
      versions: [
        { version: '0.2.1-beta.1', source: 'sb1' },
        { version: '0.2.1-beta.2', source: 'sb2' },
        { version: '0.2.1', source: 's021' },
        { version: '0.2.5-beta.1', source: 's025b' },
      ],
    });
    expect(resolveRegistryEntryVersion(e, '^0.2.1-beta.1')?.version).toBe('0.2.1');
  });

  it('respects tilde ranges (locks minor)', () => {
    const e = entry({
      version: '1.2.5',
      versions: [
        { version: '1.2.0', source: 's' },
        { version: '1.2.5', source: 's' },
        { version: '1.3.0', source: 's' },
      ],
    });
    expect(resolveRegistryEntryVersion(e, '~1.2.0')?.version).toBe('1.2.5');
  });

  it('filters yanked version records from caret matches', () => {
    const e = entry({
      version: '1.2.0',
      versions: [
        { version: '1.0.0', source: 's1' },
        { version: '1.2.0', source: 's12', yanked: true },
      ],
    });
    expect(resolveRegistryEntryVersion(e, '^1.0.0')?.version).toBe('1.0.0');
  });

  it('returns null when a specific yanked version is requested directly', () => {
    const e = entry({ version: '1.0.0', versions: [{ version: '1.0.0', source: 's1', yanked: true }] });
    expect(resolveRegistryEntryVersion(e, '1.0.0')).toBeNull();
  });

  it('returns null when no version matches the caret range', () => {
    const e = entry({ version: '2.0.0', versions: [{ version: '2.0.0', source: 's2' }] });
    expect(resolveRegistryEntryVersion(e, '^1.0.0')).toBeNull();
  });

  it('skips a candidate version string that does not parse as semver', () => {
    const e = entry({
      version: '1.0.0',
      versions: [
        { version: 'not-a-semver', source: 's-bad' },
        { version: '1.0.0', source: 's-good' },
      ],
    });
    expect(resolveRegistryEntryVersion(e, '^1.0.0')?.source).toBe('s-good');
  });

  it('returns null when the requested range does not parse as semver', () => {
    const e = entry({ version: '1.0.0', versions: [{ version: '1.0.0', source: 's1' }] });
    expect(resolveRegistryEntryVersion(e, '^not-a-version')).toBeNull();
  });

  it('resolves a dist-tag (non-latest) name to its pinned version', () => {
    const e = entry({
      version: '1.0.0',
      distTags: { latest: '1.0.0', beta: '2.0.0-beta.1' },
      versions: [
        { version: '1.0.0', source: 's1' },
        { version: '2.0.0-beta.1', source: 'sb' },
      ],
    });
    expect(resolveRegistryEntryVersion(e, 'beta')?.version).toBe('2.0.0-beta.1');
  });

  it('resolves an exact version string that is not a dist-tag', () => {
    const e = entry({
      version: '1.0.0',
      versions: [
        { version: '1.0.0', source: 's1' },
        { version: '1.1.0', source: 's2' },
      ],
    });
    expect(resolveRegistryEntryVersion(e, '1.1.0')?.version).toBe('1.1.0');
  });

  describe('version identity cannot detach from source/integrity (CR-008)', () => {
    it('rejects an exact-version request for a version absent from entry.versions instead of falling back to top-level source/integrity', () => {
      const e = entry({
        version: '1.0.0',
        source: 'top-level-source',
        integrity: 'sha256:top-level',
        versions: [
          { version: '1.0.0', source: 's1' },
          { version: '1.1.0', source: 's2' },
        ],
      });
      // `9.9.9` has no record in `entry.versions` — must not resolve to the
      // top-level source/integrity mislabeled as version 9.9.9.
      expect(resolveRegistryEntryVersion(e, '9.9.9')).toBeNull();
    });

    it('rejects a dist-tag whose pinned version has no matching record in entry.versions', () => {
      const e = entry({
        version: '1.0.0',
        source: 'top-level-source',
        distTags: { latest: '1.0.0', beta: '9.9.9-beta.1' },
        versions: [{ version: '1.0.0', source: 's1' }],
      });
      // `beta` points at `9.9.9-beta.1`, which has no record in `versions`.
      expect(resolveRegistryEntryVersion(e, 'beta')).toBeNull();
    });

    it('rejects a dist-tag pointing at a yanked version record', () => {
      const e = entry({
        version: '1.0.0',
        distTags: { latest: '1.0.0', beta: '2.0.0-beta.1' },
        versions: [
          { version: '1.0.0', source: 's1' },
          { version: '2.0.0-beta.1', source: 'sb', yanked: true },
        ],
      });
      expect(resolveRegistryEntryVersion(e, 'beta')).toBeNull();
    });

    it('rejects an exact-version request pointing at a yanked version record (distinct from the dist-tag case)', () => {
      const e = entry({
        version: '1.0.0',
        versions: [
          { version: '1.0.0', source: 's1' },
          { version: '2.0.0', source: 's2', yanked: true },
        ],
      });
      expect(resolveRegistryEntryVersion(e, '2.0.0')).toBeNull();
    });

    it('still allows an exact-version request matching the top-level version when the entry declares no versions ledger at all', () => {
      // The legacy single-version case: no `versions` array exists, so there
      // is no ledger to be authoritative over — the top-level `version` *is*
      // the one version this entry has.
      const e = entry({ version: '1.0.0', source: 's1' });
      expect(resolveRegistryEntryVersion(e, '1.0.0')?.source).toBe('s1');
    });

    it('rejects an exact-version request that does not match the top-level version when there is no versions ledger', () => {
      const e = entry({ version: '1.0.0', source: 's1' });
      // No `versions` array, and `9.9.9` isn't the entry's top-level version
      // either — must not fall back to `s1` mislabeled as version 9.9.9.
      expect(resolveRegistryEntryVersion(e, '9.9.9')).toBeNull();
    });
  });

  it('carries through integrity / manifestDigest / ref / deprecated when present on the version record', () => {
    const e = entry({
      version: '1.0.0',
      versions: [
        {
          version: '1.0.0',
          source: 's1',
          ref: 'refs/tags/v1.0.0',
          integrity: 'sha256:abc',
          manifestDigest: 'sha256:def',
          deprecated: 'use 2.x',
        },
      ],
    });
    const r = resolveRegistryEntryVersion(e, '1.0.0');
    expect(r).toMatchObject({
      version: '1.0.0',
      source: 's1',
      ref: 'refs/tags/v1.0.0',
      archiveIntegrity: 'sha256:abc',
      manifestDigest: 'sha256:def',
      deprecated: 'use 2.x',
    });
  });

  it('falls back to the entry-level ref/integrity/manifestDigest/dist when the version record has none', () => {
    const e = entry({
      version: '1.0.0',
      ref: 'refs/heads/main',
      integrity: 'sha256:entry-level',
      manifestDigest: 'sha256:entry-digest',
      dist: { integrity: 'sha256:dist-level', manifestDigest: 'sha256:dist-digest' },
      versions: [{ version: '1.0.0', source: 's1' }],
    });
    const r = resolveRegistryEntryVersion(e, '1.0.0');
    expect(r).toMatchObject({
      ref: 'refs/heads/main',
      archiveIntegrity: 'sha256:entry-level',
      manifestDigest: 'sha256:entry-digest',
    });
  });

  it('falls back to the version record\'s own dist.integrity/dist.manifestDigest when it has no top-level integrity/manifestDigest', () => {
    const e = entry({
      version: '1.0.0',
      versions: [
        {
          version: '1.0.0',
          source: 's1',
          dist: { integrity: 'sha256:version-dist', manifestDigest: 'sha256:version-dist-digest' },
        },
      ],
    });
    const r = resolveRegistryEntryVersion(e, '1.0.0');
    expect(r).toMatchObject({ archiveIntegrity: 'sha256:version-dist', manifestDigest: 'sha256:version-dist-digest' });
  });

  it('falls back to dist-level integrity/manifestDigest when neither version nor entry top-level carries them', () => {
    const e = entry({
      version: '1.0.0',
      dist: { integrity: 'sha256:dist-level', manifestDigest: 'sha256:dist-digest' },
      versions: [{ version: '1.0.0', source: 's1' }],
    });
    const r = resolveRegistryEntryVersion(e, '1.0.0');
    expect(r).toMatchObject({ archiveIntegrity: 'sha256:dist-level', manifestDigest: 'sha256:dist-digest' });
  });

  it('orders mixed numeric/alphanumeric prerelease identifiers per semver §11 precedence', () => {
    // A prerelease range so all three same-tuple prereleases are candidates;
    // exercises comparePrerelease's numeric-vs-numeric and numeric-vs-alpha
    // branches in one sort.
    const e = entry({
      version: '1.0.0-9',
      versions: [
        { version: '1.0.0-9', source: 's9' },
        { version: '1.0.0-alpha', source: 's-alpha' },
        { version: '1.0.0-beta', source: 's-beta' },
      ],
    });
    // Numeric identifiers are ranked lower than alphanumeric ones (semver
    // §11.4.3), and among alphanumeric identifiers ASCII order applies, so
    // the highest-precedence candidate is "beta".
    expect(resolveRegistryEntryVersion(e, '^1.0.0-9')?.version).toBe('1.0.0-beta');
  });

  it('ranks two differing alphanumeric prerelease identifiers by ASCII order, either direction', () => {
    const alphaFirst = entry({
      version: '1.0.0-alpha',
      versions: [
        { version: '1.0.0-alpha', source: 's-alpha' },
        { version: '1.0.0-beta', source: 's-beta' },
      ],
    });
    expect(resolveRegistryEntryVersion(alphaFirst, '^1.0.0-alpha')?.version).toBe('1.0.0-beta');

    const betaFirst = entry({
      version: '1.0.0-beta',
      versions: [
        { version: '1.0.0-beta', source: 's-beta' },
        { version: '1.0.0-alpha', source: 's-alpha' },
      ],
    });
    expect(resolveRegistryEntryVersion(betaFirst, '^1.0.0-alpha')?.version).toBe('1.0.0-beta');
  });

  it('ranks a longer identifier set above a shorter one when the shared prefix is equal, either direction', () => {
    // semver §11.4.4: a larger set of prerelease fields has higher precedence
    // than a smaller set, when all preceding identifiers are equal.
    const shortFirst = entry({
      version: '1.0.0-alpha',
      versions: [
        { version: '1.0.0-alpha', source: 's-short' },
        { version: '1.0.0-alpha.1', source: 's-long' },
      ],
    });
    expect(resolveRegistryEntryVersion(shortFirst, '^1.0.0-alpha')?.version).toBe('1.0.0-alpha.1');

    const longFirst = entry({
      version: '1.0.0-alpha.1',
      versions: [
        { version: '1.0.0-alpha.1', source: 's-long' },
        { version: '1.0.0-alpha', source: 's-short' },
      ],
    });
    expect(resolveRegistryEntryVersion(longFirst, '^1.0.0-alpha')?.version).toBe('1.0.0-alpha.1');
  });

  it('returns null when neither version record nor entry has a source', () => {
    const e = { name: 'vendor/example', version: '1.0.0', versions: [{ version: '1.0.0' }] } as unknown as RegistryEntry;
    expect(resolveRegistryEntryVersion(e, '1.0.0')).toBeNull();
  });
});
