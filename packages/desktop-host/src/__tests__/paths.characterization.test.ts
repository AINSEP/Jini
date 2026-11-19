import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDesktopHostPathRoots } from '../paths.js';

const required = { namespace: 'stable', namespaceBaseRoot: '/base' };

describe('data-root fallback and validation before flattening', () => {
  it.each([undefined, '', '   '])('uses the namespace data root for an absent or blank override: %s', override => {
    expect(resolveDesktopHostPathRoots({ dataDirOverride: { value: override, sourceName: 'DATA' }, ...required }).dataRoot)
      .toBe(join('/base', 'stable', 'data'));
  });

  it('uses the default data root when the host supplies no override', () => {
    expect(resolveDesktopHostPathRoots({ dataDirOverride: undefined, ...required }).dataRoot).toBe(join('/base', 'stable', 'data'));
  });

  it.each(['~', '$HOME', '${HOME}', '~/state', '$HOME/state', '${HOME}/state'])('expands and scopes home override %s', override => {
    const suffix = override.endsWith('/state') ? ['state'] : [];
    expect(resolveDesktopHostPathRoots({ dataDirOverride: { value: override, sourceName: 'DATA' }, ...required }).dataRoot)
      .toBe(join(homedir(), ...suffix, 'namespaces', 'stable', 'data'));
  });

  it('trims an override, preserves matching scoped spelling, and rejects a mismatched scope', () => {
    expect(resolveDesktopHostPathRoots({ dataDirOverride: { value: ' /state ', sourceName: 'DATA' }, ...required }).dataRoot)
      .toBe(join('/state', 'namespaces', 'stable', 'data'));
    const scoped = '/state/namespaces/stable/data/';
    expect(resolveDesktopHostPathRoots({ dataDirOverride: { value: scoped, sourceName: 'DATA' }, ...required }).dataRoot).toBe(scoped);
    expect(() => resolveDesktopHostPathRoots({ dataDirOverride: { value: '/state/namespaces/beta/data', sourceName: 'DATA' }, ...required }))
      .toThrow('DATA targets namespace "beta" but the active namespace is "stable"');
    expect(() => resolveDesktopHostPathRoots({ dataDirOverride: { value: ' relative ', sourceName: 'DATA' }, ...required }))
      .toThrow('DATA must be an absolute path; got: relative');
  });

  it.each(['../elsewhere', '..', '.', '', '/outside', 'a/b', 'a\\b', 'C:outside', 'bad\0name'])(
    'refuses an unsafe namespace %j before resolving roots', namespace => {
      expect(() => resolveDesktopHostPathRoots({ dataDirOverride: undefined, namespace, namespaceBaseRoot: '/base' }))
        .toThrow('namespace must be a single safe path segment');
    },
  );
});

it('keeps the host label in refusals and rejects a sibling namespace', () => {
  const dataDirOverride = { value: '/state/namespaces/beta/data', sourceName: 'HOST_STATE_ROOT' };
  expect(() => resolveDesktopHostPathRoots({ ...required, dataDirOverride }))
    .toThrow('HOST_STATE_ROOT targets namespace "beta" but the active namespace is "stable"');
  expect(() => resolveDesktopHostPathRoots({ ...required, dataDirOverride: { value: ' relative ', sourceName: 'OTHER_HOST_ROOT' } }))
    .toThrow('OTHER_HOST_ROOT must be an absolute path; got: relative');
});
