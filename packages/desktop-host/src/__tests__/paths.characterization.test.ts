import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDesktopHostPathRoots } from '../paths.js';

const required = { namespace: 'stable', namespaceBaseRoot: '/base' };

describe('data-root fallback and validation before flattening', () => {
  it.each([undefined, '', '   '])('uses the namespace data root for an absent or blank override: %s', override => {
    expect(resolveDesktopHostPathRoots(required, { dataDirOverrideEnvVar: 'DATA', env: { DATA: override } }).dataRoot)
      .toBe(join('/base', 'stable', 'data'));
  });

  it('ignores environment entries when no override variable was selected', () => {
    expect(resolveDesktopHostPathRoots(required, { env: { DATA: '/other' } }).dataRoot).toBe(join('/base', 'stable', 'data'));
  });

  it.each(['~', '$HOME', '${HOME}', '~/state', '$HOME/state', '${HOME}/state'])('expands and scopes home override %s', override => {
    const suffix = override.endsWith('/state') ? ['state'] : [];
    expect(resolveDesktopHostPathRoots(required, { dataDirOverrideEnvVar: 'DATA', env: { DATA: override } }).dataRoot)
      .toBe(join(homedir(), ...suffix, 'namespaces', 'stable', 'data'));
  });

  it('trims an override, preserves matching scoped spelling, and rejects a mismatched scope', () => {
    expect(resolveDesktopHostPathRoots(required, { dataDirOverrideEnvVar: 'DATA', env: { DATA: ' /state ' } }).dataRoot)
      .toBe(join('/state', 'namespaces', 'stable', 'data'));
    const scoped = '/state/namespaces/stable/data/';
    expect(resolveDesktopHostPathRoots(required, { dataDirOverrideEnvVar: 'DATA', env: { DATA: scoped } }).dataRoot).toBe(scoped);
    expect(() => resolveDesktopHostPathRoots(required, { dataDirOverrideEnvVar: 'DATA', env: { DATA: '/state/namespaces/beta/data' } }))
      .toThrow('DATA targets namespace "beta" but the active namespace is "stable"');
    expect(() => resolveDesktopHostPathRoots(required, { dataDirOverrideEnvVar: 'DATA', env: { DATA: ' relative ' } }))
      .toThrow('DATA must be an absolute path; got: relative');
  });

  it('allows namespace traversal outside the base root (reported, not fixed)', () => {
    const roots = resolveDesktopHostPathRoots({ namespace: '../elsewhere', namespaceBaseRoot: '/base' }, { env: {} });
    expect(roots.namespaceRoot).toBe('/elsewhere');
    expect(roots.dataRoot).toBe('/elsewhere/data');
  });
});
