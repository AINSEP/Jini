import { describe, expect, test } from 'vitest';
import { parseAgentPluginManifest } from '../../manifest.js';
import { validatePluginManifest } from '../../../manifest.js';

/**
 * @file Host-key policy (README "Extension namespaces"): one `extensions` entry per host, each
 * host reads only its own key. The parsers keep their compatible `tovu` default for existing
 * callers that pass no namespace.
 */

const dualKey = {
  $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
  name: 'stock',
  extensions: {
    tovu: { id: 'tovu/stock', provides: ['stock-data'] },
    'open-marketing': { id: 'jini/stock', provides: ['market-data'] },
  },
};

function parsedIdentity(identityNamespace?: string) {
  const result = parseAgentPluginManifest({ value: dualKey }, identityNamespace === undefined ? {} : { identityNamespace });
  if (!result.ok) throw new Error(result.errors.join(' '));
  return { id: result.manifest.id, provides: result.manifest.provides };
}

describe('extension namespace per host', () => {
  test('each host reads only its own key from a dual-key manifest', () => {
    expect(parsedIdentity('tovu')).toEqual({ id: 'tovu/stock', provides: ['stock-data'] });
    expect(parsedIdentity('open-marketing')).toEqual({ id: 'jini/stock', provides: ['market-data'] });
  });

  test('a host with no key of its own gets the legacy identity, never another host\'s id', () => {
    expect(parsedIdentity('another-host')).toEqual({ id: 'unknown/stock', provides: [] });
  });

  test('omitting the namespace keeps the compatible tovu default', () => {
    expect(parsedIdentity()).toEqual(parsedIdentity('tovu'));
  });

  test('the object validator checks only the requested host key', () => {
    const foreignInvalid = { ...dualKey, extensions: { ...dualKey.extensions, 'open-marketing': { id: 'not a publisher id' } } };
    expect(validatePluginManifest({ value: foreignInvalid }, { identityNamespace: 'open-marketing' })).toBe(false);
    expect(validatePluginManifest({ value: foreignInvalid }, { identityNamespace: 'tovu' })).toBe(true);
    expect(validatePluginManifest({ value: foreignInvalid })).toBe(true);
  });
});
