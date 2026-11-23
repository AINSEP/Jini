import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHARED_EXTENSION_CAPABILITIES } from '../extension-capability-vocabulary.js';

// The host's own test pins that its plugin binding imports this array by identity; these pin the
// array itself, so both extension mechanisms keep building their vocabularies from one frozen source.
describe('SHARED_EXTENSION_CAPABILITIES', () => {
  it('is exactly the three capabilities both extension mechanisms share, in declaration order', () => {
    expect(SHARED_EXTENSION_CAPABILITIES).toEqual(['content.read', 'content.extend', 'hooks.attach']);
  });

  it('is frozen, so no consumer can widen the shared source of truth for the other', () => {
    expect(Object.isFrozen(SHARED_EXTENSION_CAPABILITIES)).toBe(true);
    expect(() => (SHARED_EXTENSION_CAPABILITIES as string[]).push('tools.register')).toThrow(TypeError);
  });

  it('is published as its own core subpath', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(manifest.exports['./extension-capability-vocabulary']).toEqual({
      types: './dist/extension-capability-vocabulary.d.ts',
      import: './dist/extension-capability-vocabulary.js',
      default: './dist/extension-capability-vocabulary.js',
    });
  });
});
