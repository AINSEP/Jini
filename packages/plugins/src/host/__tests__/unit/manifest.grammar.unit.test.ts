import { describe, expect, it } from 'vitest';
import { validateManifest, validatePluginIdFormat } from '../support/manifest.js';

/** L2 §4 manifest.ts: id grammar/length at 50/51, semver exactness (build kept, v-prefix/padding
 *  refused), integrity hash pattern anchors, and non-string identity fields — one clause per case. */
const hex = 'ab'.repeat(32);
const base = { id: 'sample', name: 'Sample', version: '1.0.0', sdkRange: '*', engine: 1, tier: 'tier-3', capabilities: [], hooks: [], fields: [], integrity: {} };
const errors = (changes: Record<string, unknown>, folderName = 'sample') => validateManifest({ manifest: { ...base, ...changes }, folderName, builtInIds: [] }).errors;
const messages = (changes: Record<string, unknown>, folderName?: string) => errors(changes, folderName).map(e => e.message);

describe('validatePluginIdFormat', () => {
  it.each(['a', '0', 'a-b-9', 'x'.repeat(50)])('accepts %j', (id) => {
    expect(validatePluginIdFormat({ id })).toEqual([]);
  });
  it.each(['', 'x'.repeat(51), 'A', 'a_b', 'a.b', 'a/b', ' a', 'a ', 'a\n', 'é'])('refuses %j with the grammar message', (id) => {
    expect(validatePluginIdFormat({ id })).toEqual([{ code: 'MANIFEST_MALFORMED', file: null, message: `id '${id}' must match /^[a-z0-9-]+$/ and be 1-50 characters` }]);
  });
});

describe('validateManifest identity fields', () => {
  it('a non-string id is refused as such (not as a grammar error)', () => {
    expect(messages({ id: 7 })).toContain("'id' must be a string");
    expect(messages({ id: 7 }).some(m => m.startsWith('id '))).toBe(false);
  });
  it.each(['1.0.0', '0.0.1', '1.2.3-rc.1', '1.0.0+build.42', '1.0.0-beta+exp.sha.5114f85'])('version %j is exact semver', (version) => {
    expect(messages({ version }).filter(m => m.startsWith('version'))).toEqual([]);
  });
  it.each(['v1.0.0', ' 1.0.0', '1.0.0 ', '1.0', '01.0.0', '1.0.0\n', 7, null])('version %j is refused', (version) => {
    expect(messages({ version })).toContain(`version '${String(version)}' must be a semver version (e.g. 1.0.0)`);
  });
  it.each([7, '', '   ', null])('name %j is refused', (name) => {
    expect(messages({ name })).toContain("'name' must be a non-empty string");
  });
  it.each([`sha256-${hex}`])('integrity %s accepted', (hash) => {
    expect(messages({ integrity: { 'server/index.mjs': hash } }).filter(m => m.startsWith('integrity'))).toEqual([]);
  });
  it.each([
    `sha256-${hex.toUpperCase()}`, `sha256-${hex.slice(1)}`, `sha256-${hex}0`, `xsha256-${hex}`, `sha256-${hex}\n`, `sha512-${hex}`, `sha256:${hex}`,
  ])('integrity hash %j refused', (hash) => {
    expect(messages({ integrity: { 'server/index.mjs': hash } })).toContain("integrity entry 'server/index.mjs' must be 'sha256-' followed by 64 lowercase hex characters");
  });
  it.each([[[]], ['x'], [null]])('integrity %j that is not an object map is refused', (integrity) => {
    expect(messages({ integrity })).toContain("'integrity' must be an object mapping packaged file paths to sha256 hashes");
  });
});
