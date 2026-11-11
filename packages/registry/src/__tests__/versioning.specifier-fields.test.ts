import { describe, expect, it } from 'vitest';
import { parseRegistrySpecifier, resolveRegistryEntryVersion } from '../versioning.js';

/** L2 §4 versioning: specifier splitting boundaries (`slash>0`, `at>slash+1`) and the optional-field
 *  precedence record → record.dist → entry → entry.dist, with absent fields OMITTED (toStrictEqual). */
describe('parseRegistrySpecifier', () => {
  it.each([
    ['vendor/name', { name: 'vendor/name' }],
    ['  vendor/name@^1.2  ', { name: 'vendor/name', range: '^1.2' }],
    ['vendor/name@', { name: 'vendor/name' }],
    ['vendor/n@1', { name: 'vendor/n', range: '1' }],
    ['vendor/@1', { name: 'vendor/@1' }],
    ['/name@1', { name: '/name@1' }],
    ['name@1', { name: 'name@1' }],
    ['@scope/pkg@2.0.0', { name: '@scope/pkg', range: '2.0.0' }],
    ['@scope/pkg', { name: '@scope/pkg' }],
    ['a/b@c@d', { name: 'a/b@c', range: 'd' }],
  ])('%j → %j', (input, expected) => {
    expect(parseRegistrySpecifier({ input })).toStrictEqual(expected);
  });
});

describe('resolveRegistryEntryVersion optional fields', () => {
  const base = { name: 'v/p', version: '1.0.0', source: 'entry-src' } as const;
  it('omits every optional field when nothing provides it', () => {
    expect(resolveRegistryEntryVersion({ entry: { ...base } as never })).toStrictEqual({ version: '1.0.0', source: 'entry-src' });
  });
  it('prefers the version record, then its dist, then the entry, then the entry dist', () => {
    const entry = { ...base, ref: 'entry-ref', integrity: 'entry-int', dist: { manifestDigest: 'entry-dist-md', integrity: 'entry-dist-int' }, deprecated: 'old',
      versions: [{ version: '1.0.0', source: 'rec-src', ref: 'rec-ref', dist: { integrity: 'rec-dist-int' } }] };
    expect(resolveRegistryEntryVersion({ entry: entry as never })).toStrictEqual({
      version: '1.0.0', source: 'rec-src', ref: 'rec-ref', manifestDigest: 'entry-dist-md', archiveIntegrity: 'rec-dist-int', deprecated: 'old',
    });
    const recordWins = { ...entry, versions: [{ version: '1.0.0', manifestDigest: 'rec-md', integrity: 'rec-int', deprecated: false, dist: { integrity: 'rec-dist-int' } }] };
    expect(resolveRegistryEntryVersion({ entry: recordWins as never })).toMatchObject({ source: 'entry-src', ref: 'entry-ref', manifestDigest: 'rec-md', archiveIntegrity: 'rec-int', deprecated: false });
  });
  it('a yanked entry, a yanked target version, or a missing source resolve to null', () => {
    expect(resolveRegistryEntryVersion({ entry: { ...base, yanked: true } as never })).toBeNull();
    expect(resolveRegistryEntryVersion({ entry: { ...base, versions: [{ version: '1.0.0', yanked: true }] } as never })).toBeNull();
    expect(resolveRegistryEntryVersion({ entry: { ...base, source: '' } as never })).toBeNull();
  });
  it('latest / blank range use distTags.latest before entry.version', () => {
    const entry = { ...base, distTags: { latest: '2.0.0' }, versions: [{ version: '1.0.0' }, { version: '2.0.0', source: 'two' }] };
    for (const requestedRange of [undefined, 'latest', '  ', '  latest  ']) {
      expect(resolveRegistryEntryVersion({ entry: entry as never }, { requestedRange })).toMatchObject({ version: '2.0.0', source: 'two' });
    }
  });
});
