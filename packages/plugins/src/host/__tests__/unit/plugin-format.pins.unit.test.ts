import { describe, expect, it } from 'vitest';
import { PLUGIN_MANIFEST_FILENAME, PLUGIN_SDK_SPECIFIER, canonicalizePluginManifest, pluginManifestFilenames } from '../../plugin-format.js';
import { verifyPluginSnapshotIntegrity } from '../../node/module-snapshot.js';
const policy = { legacyManifestFilenames: ['legacy.plugin.json'] };
import { PluginHookFailedError } from '../../errors.js';

/** AP6 pins for the package format vocabulary, canonical-name precedence, and the shared hook error. */
describe('plugin format', () => {
  it('canonical wins without falling back after bad canonical bytes', () => {
    expect(PLUGIN_MANIFEST_FILENAME).toBe('jini.plugin.json');
    expect(PLUGIN_SDK_SPECIFIER).toBe('@jini-ai/plugin-sdk');
    expect(pluginManifestFilenames({})).toEqual(['jini.plugin.json']);
    expect(pluginManifestFilenames({}, { legacyManifestFilenames: ['legacy.plugin.json', 'jini.plugin.json', '../evil.plugin.json', 'path/evil.plugin.json', 'path\\evil.plugin.json', 'bad\0.plugin.json', '..plugin.json', 'legacy.plugin.json', 'second.plugin.json', 'unrelated.json'] })).toEqual(['jini.plugin.json', 'legacy.plugin.json', 'second.plugin.json']);
    expect([...canonicalizePluginManifest({ files: new Map([['legacy.plugin.json', 'valid'], ['jini.plugin.json', '{']]) }, policy)]).toEqual([['jini.plugin.json', '{']]);
    const canonical = canonicalizePluginManifest({ files: new Map<string, string | undefined>([['jini.plugin.json', undefined], ['legacy.plugin.json', 'valid']]) }, policy);
    expect(canonical.has('jini.plugin.json')).toBe(true);
    expect(canonical.get('jini.plugin.json')).toBeUndefined();
  });
  it('canonicalize prefers the canonical file, renames a legacy-only one, and drops the other alias', () => {
    expect([...canonicalizePluginManifest({ files: new Map([['legacy.plugin.json', 'legacy'], ['jini.plugin.json', 'canon'], ['a', 'x']]) }, policy)]).toEqual([['a', 'x'], ['jini.plugin.json', 'canon']]);
    expect([...canonicalizePluginManifest({ files: new Map([['legacy.plugin.json', 'legacy']]) }, policy)]).toEqual([['jini.plugin.json', 'legacy']]);
    expect([...canonicalizePluginManifest({ files: new Map([['a', 'x']]) }, policy)]).toEqual([['a', 'x']]);
  });
  it('PluginHookFailedError carries plugin id, cause and refusedItemRef (null by default)', () => {
    const cause = new Error('c');
    expect(new PluginHookFailedError('p', 'm', { cause })).toMatchObject({ name: 'PluginHookFailedError', pluginId: 'p', message: 'm', cause, refusedItemRef: null });
    expect(new PluginHookFailedError('p', 'm', { refusedItemRef: 'post:1' }).refusedItemRef).toBe('post:1');
  });
});

it('an alias never exempts an unrelated file from integrity', () => {
  const files = new Map([['legacy.plugin.json', new Uint8Array([1])], ['unrelated.plugin.json', new Uint8Array([2])]]);
  expect(() => verifyPluginSnapshotIntegrity({ files, integrity: {} }, policy)).toThrow('Package changed before loading.');
  expect(() => verifyPluginSnapshotIntegrity({ files: new Map([['legacy.plugin.json', new Uint8Array([1])]]), integrity: {} }, policy)).not.toThrow();
});
