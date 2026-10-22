import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DesktopHostPathError, resolveDesktopHostPathRoots } from '../paths.js';

describe('resolveDesktopHostPathRoots', () => {
  it('derives the standard subroots under namespaceBaseRoot/namespace', () => {
    const roots = resolveDesktopHostPathRoots({ namespace: 'stable', namespaceBaseRoot: '/base' }, { env: {} });
    expect(roots.namespaceRoot).toBe(join('/base', 'stable'));
    expect(roots.dataRoot).toBe(join('/base', 'stable', 'data'));
    expect(roots.cacheRoot).toBe(join('/base', 'stable', 'cache'));
    expect(roots.logsRoot).toBe(join('/base', 'stable', 'logs'));
    expect(roots.runtimeRoot).toBe(join('/base', 'stable', 'runtime'));
    expect(roots.userDataRoot).toBe(join('/base', 'stable', 'user-data'));
    expect(roots.sessionDataRoot).toBe(join('/base', 'stable', 'user-data', 'session'));
  });

  it('honors an absolute data-dir override env var', () => {
    const roots = resolveDesktopHostPathRoots({ namespace: 'stable', namespaceBaseRoot: '/base' }, { dataDirOverrideEnvVar: 'JINI_DATA_DIR', env: { JINI_DATA_DIR: '/custom/data' } });
    expect(roots.dataRoot).toBe(join('/custom/data', 'namespaces', 'stable', 'data'));
  });

  it('throws when the override is not absolute', () => {
    expect(() =>
      resolveDesktopHostPathRoots({ namespace: 'stable', namespaceBaseRoot: '/base' }, { dataDirOverrideEnvVar: 'JINI_DATA_DIR', env: { JINI_DATA_DIR: 'relative/path' } }),
    ).toThrow(DesktopHostPathError);
  });

  it('throws when a namespace-scoped override targets a different namespace', () => {
    expect(() =>
      resolveDesktopHostPathRoots({ namespace: 'stable', namespaceBaseRoot: '/base' }, { dataDirOverrideEnvVar: 'JINI_DATA_DIR', env: { JINI_DATA_DIR: join('/x', 'namespaces', 'beta', 'data') } }),
    ).toThrow(/targets namespace "beta"/);
  });

  it('accepts a namespace-scoped override that matches the active namespace', () => {
    const scoped = join('/x', 'namespaces', 'stable', 'data');
    const roots = resolveDesktopHostPathRoots({ namespace: 'stable', namespaceBaseRoot: '/base' }, { dataDirOverrideEnvVar: 'JINI_DATA_DIR', env: { JINI_DATA_DIR: scoped } });
    expect(roots.dataRoot).toBe(scoped);
  });

  it('expands a bare "~" override to the home directory', () => {
    const roots = resolveDesktopHostPathRoots({ namespace: 'stable', namespaceBaseRoot: '/base' }, { dataDirOverrideEnvVar: 'JINI_DATA_DIR', env: { JINI_DATA_DIR: '~' } });
    expect(roots.dataRoot).toBe(join(homedir(), 'namespaces', 'stable', 'data'));
  });

  it('expands a bare "$HOME" override to the home directory', () => {
    const roots = resolveDesktopHostPathRoots({ namespace: 'stable', namespaceBaseRoot: '/base' }, { dataDirOverrideEnvVar: 'JINI_DATA_DIR', env: { JINI_DATA_DIR: '$HOME' } });
    expect(roots.dataRoot).toBe(join(homedir(), 'namespaces', 'stable', 'data'));
  });

  it('expands a "~/..." prefixed override relative to the home directory', () => {
    const roots = resolveDesktopHostPathRoots({ namespace: 'stable', namespaceBaseRoot: '/base' }, { dataDirOverrideEnvVar: 'JINI_DATA_DIR', env: { JINI_DATA_DIR: '~/jini-data' } });
    expect(roots.dataRoot).toBe(join(homedir(), 'jini-data', 'namespaces', 'stable', 'data'));
  });

  it('expands a "${HOME}/..." prefixed override relative to the home directory', () => {
    const roots = resolveDesktopHostPathRoots({ namespace: 'stable', namespaceBaseRoot: '/base' }, { dataDirOverrideEnvVar: 'JINI_DATA_DIR', env: { JINI_DATA_DIR: '${HOME}/jini-data' } });
    expect(roots.dataRoot).toBe(join(homedir(), 'jini-data', 'namespaces', 'stable', 'data'));
  });

  it('treats a short absolute override (fewer than 3 path segments) as unscoped', () => {
    const shortAbsolute = process.platform === 'win32' ? 'C:\\x' : '/x';
    const roots = resolveDesktopHostPathRoots({ namespace: 'stable', namespaceBaseRoot: '/base' }, { dataDirOverrideEnvVar: 'JINI_DATA_DIR', env: { JINI_DATA_DIR: shortAbsolute } });
    expect(roots.dataRoot).toBe(join(shortAbsolute, 'namespaces', 'stable', 'data'));
  });

  it('falls back to process.env when no env is supplied', () => {
    const roots = resolveDesktopHostPathRoots({ namespace: 'stable', namespaceBaseRoot: '/base' });
    expect(roots.namespaceRoot).toBe(join('/base', 'stable'));
  });

  it('validates a win32-style absolute override using win32 path rules on any host platform', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const roots = resolveDesktopHostPathRoots({ namespace: 'stable', namespaceBaseRoot: '/base' }, { dataDirOverrideEnvVar: 'JINI_DATA_DIR', env: { JINI_DATA_DIR: 'C:\\custom\\data' } });
      expect(roots.dataRoot).toBe(join('C:\\custom\\data', 'namespaces', 'stable', 'data'));
    } finally {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('rejects a win32-relative override as non-absolute when simulating win32', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      expect(() =>
        resolveDesktopHostPathRoots({ namespace: 'stable', namespaceBaseRoot: '/base' }, { dataDirOverrideEnvVar: 'JINI_DATA_DIR', env: { JINI_DATA_DIR: 'relative\\path' } }),
      ).toThrow(DesktopHostPathError);
    } finally {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });
});
