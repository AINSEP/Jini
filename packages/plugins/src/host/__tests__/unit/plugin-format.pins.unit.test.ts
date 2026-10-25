import { describe, expect, it } from 'vitest';
import { LEGACY_PLUGIN_MANIFEST_FILENAME, LEGACY_PLUGIN_SDK_SPECIFIER, PLUGIN_MANIFEST_FILENAME, PLUGIN_MANIFEST_FILENAMES, PLUGIN_SDK_SPECIFIER, PLUGIN_SDK_SPECIFIERS, canonicalizePluginManifest } from '../../plugin-format.js';
import { PluginHookFailedError } from '../../errors.js';

/** AP6 pins for the package format vocabulary, canonical-name precedence, and the shared hook error. */
describe('plugin format', () => {
  it('pins filenames and SDK specifiers (canonical first)', () => {
    expect(PLUGIN_MANIFEST_FILENAMES).toEqual([PLUGIN_MANIFEST_FILENAME, LEGACY_PLUGIN_MANIFEST_FILENAME]);
    expect([PLUGIN_MANIFEST_FILENAME, LEGACY_PLUGIN_MANIFEST_FILENAME]).toEqual(['jini.plugin.json', 'tovu.plugin.json']);
    expect(PLUGIN_SDK_SPECIFIERS).toEqual([PLUGIN_SDK_SPECIFIER, LEGACY_PLUGIN_SDK_SPECIFIER]);
    expect([PLUGIN_SDK_SPECIFIER, LEGACY_PLUGIN_SDK_SPECIFIER]).toEqual(['@jini-ai/plugin-sdk', '@tovu/sdk']);
  });
  it('canonicalize prefers the canonical file, renames a legacy-only one, and drops the other alias', () => {
    expect([...canonicalizePluginManifest({ files: new Map([['tovu.plugin.json', 'legacy'], ['jini.plugin.json', 'canon'], ['a', 'x']]) })]).toEqual([['a', 'x'], ['jini.plugin.json', 'canon']]);
    expect([...canonicalizePluginManifest({ files: new Map([['tovu.plugin.json', 'legacy']]) })]).toEqual([['jini.plugin.json', 'legacy']]);
    expect([...canonicalizePluginManifest({ files: new Map([['a', 'x']]) })]).toEqual([['a', 'x']]);
  });
  it('PluginHookFailedError carries plugin id, cause and refusedItemRef (null by default)', () => {
    const cause = new Error('c');
    expect(new PluginHookFailedError('p', 'm', { cause })).toMatchObject({ name: 'PluginHookFailedError', pluginId: 'p', message: 'm', cause, refusedItemRef: null });
    expect(new PluginHookFailedError('p', 'm', { refusedItemRef: 'post:1' }).refusedItemRef).toBe('post:1');
  });
});
