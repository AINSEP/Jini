import { describe, expect, it } from 'vitest';
import { validateManifest } from '../support/manifest.js';

const digest = `sha256-${'ab'.repeat(32)}`;
const manifest = { id: 'sample', name: 'Sample', version: '1.0.0', sdkRange: '*', engine: 1, tier: 'tier-3', capabilities: [], hooks: [], fields: [], integrity: {} };
function errorsFor({ changes }: { changes: Readonly<Record<string, unknown>> }, _options: Record<string, never> = {}) {
  return validateManifest({ manifest: { ...manifest, ...changes }, folderName: 'sample', builtInIds: [] }).errors;
}
const malformed = ({ message }: { message: string }, _options: Record<string, never> = {}) => ({ code: 'MANIFEST_MALFORMED', file: null, message });
const contributesInvalid = ({ message }: { message: string }, _options: Record<string, never> = {}) => ({ code: 'CONTRIBUTES_INVALID', file: null, message });

describe('manifest identity and contribution validation before L121', () => {
  it('collects identity errors in name, version and integrity insertion order', () => {
    expect(errorsFor({ changes: { name: ' ', version: 'v1.0.0', integrity: { '': digest, 'server/a.mjs': 1, 'server/b.mjs': 'bad' } } })).toEqual([
      malformed({ message: "'name' must be a non-empty string" }),
      malformed({ message: "version 'v1.0.0' must be a semver version (e.g. 1.0.0)" }),
      malformed({ message: "integrity entry '' must be 'sha256-' followed by 64 lowercase hex characters" }),
      malformed({ message: "integrity entry 'server/a.mjs' must be 'sha256-' followed by 64 lowercase hex characters" }),
      malformed({ message: "integrity entry 'server/b.mjs' must be 'sha256-' followed by 64 lowercase hex characters" }),
    ]);
  });
  it.each([undefined, null, 3, '', '  '])('keeps missing-name errors distinct from invalid-name errors: %j', name => {
    const message = name === undefined ? "missing required manifest field 'name'" : "'name' must be a non-empty string";
    expect(errorsFor({ changes: { name } })).toEqual([malformed({ message })]);
  });
  it.each([undefined, null, 3, 'latest', 'v1.0.0', '1.0.0 ', '1.0.0+'])('keeps missing-version errors distinct from malformed semver: %j', version => {
    const message = version === undefined ? "missing required manifest field 'version'" : `version '${String(version)}' must be a semver version (e.g. 1.0.0)`;
    expect(errorsFor({ changes: { version } })).toEqual([malformed({ message })]);
  });
  it.each(['1.0.0', '1.0.0+build.42', '1.0.0-beta.1+build.42'])('accepts exact semver and nonblank names without trimming: %s', version => {
    expect(errorsFor({ changes: { version, name: ' Sample ' } })).toEqual([]);
  });
  it.each([undefined, null, [], 'digest', 1].map(integrity => ({ integrity })))('validates integrity presence and object shape: %j', ({ integrity }) => {
    const message = integrity === undefined ? "missing required manifest field 'integrity'" : "'integrity' must be an object mapping packaged file paths to sha256 hashes";
    expect(errorsFor({ changes: { integrity } })).toEqual([malformed({ message })]);
  });
  it.each([{}, { 'server/index.mjs': digest }])('accepts empty integrity and correct digests: %j', integrity => {
    expect(errorsFor({ changes: { integrity } })).toEqual([]);
  });
  it.each([null, 1, 'bad', `sha256-${'AB'.repeat(32)}`, `sha256-${'a'.repeat(63)}`])('rejects malformed hashes: %j', hash => {
    expect(errorsFor({ changes: { integrity: { 'server/index.mjs': hash } } })).toEqual([
      malformed({ message: "integrity entry 'server/index.mjs' must be 'sha256-' followed by 64 lowercase hex characters" }),
    ]);
  });
  it.each([undefined, null, {}])('allows absent, null and empty contribution blocks: %j', contributes => {
    expect(errorsFor({ changes: { contributes } })).toEqual([]);
  });
  it.each([[], 'routes', 1, false].map(contributes => ({ contributes })))('rejects a non-object contribution block: %j', ({ contributes }) => {
    expect(errorsFor({ changes: { contributes } })).toEqual([contributesInvalid({ message: "'contributes' must be an object of string lists" })]);
  });
  it('collects list errors in insertion order and skips entry checks for malformed lists', () => {
    expect(errorsFor({ changes: { contributes: {
      unknown: ['x'], tools: ['plugin_capability_bad', ''], routes: ['bad', 'GET /ok'], settings: [3], permissions: null, widgets: [],
    } } })).toEqual([
      contributesInvalid({ message: "unknown contributes key 'unknown' (expected one of routes, tools, tables, settings, widgets, permissions)" }),
      contributesInvalid({ message: 'contributes.tools must be a list of non-empty strings' }),
      contributesInvalid({ message: "contributes.routes entry 'bad' must be '/path' or 'METHOD /path'" }),
      contributesInvalid({ message: 'contributes.settings must be a list of non-empty strings' }),
      contributesInvalid({ message: 'contributes.permissions must be a list of non-empty strings' }),
    ]);
  });
  it.each([undefined, null, 'tool', [1], [''], [' ']].map(tools => ({ tools })))('rejects malformed contribution lists: %j', ({ tools }) => {
    expect(errorsFor({ changes: { contributes: { tools } } })).toEqual([contributesInvalid({ message: 'contributes.tools must be a list of non-empty strings' })]);
  });
  it('preserves kind-specific checks and the special wildcard route method', () => {
    expect(errorsFor({ changes: { contributes: {
      routes: ['* /ok', 'get /ok', '/ok', 'GET /bad*'], tools: ['ok', 'plugin_capability_x', 'agent_plugin_x'],
      tables: ['p_sample__ok', 'p_sample__', 'other'], settings: ['sample.*'], widgets: ['ok'], permissions: ['ok'],
    } } })).toEqual([
      contributesInvalid({ message: "contributes.routes entry 'GET /bad*' must name one thing, not a '*' pattern" }),
      contributesInvalid({ message: "contributes.tools entry 'plugin_capability_x' uses a prefix reserved for generated tools" }),
      contributesInvalid({ message: "contributes.tools entry 'agent_plugin_x' uses a prefix reserved for generated tools" }),
      contributesInvalid({ message: "contributes.tables entry 'p_sample__' must be namespaced to this plugin ('p_sample__*')" }),
      contributesInvalid({ message: "contributes.tables entry 'other' must be namespaced to this plugin ('p_sample__*')" }),
      contributesInvalid({ message: "contributes.settings entry 'sample.*' must name one thing, not a '*' pattern" }),
    ]);
  });
});
