import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeFilesystemSettings } from '../../claude-filesystem-policy.js';

const fixtures: string[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('canonical Claude scratch grants', () => {
  it.each(['darwin', 'linux'] as const)('grants the real scratch subtree through a symlinked %s temp base before Claude creates it', platform => {
    const root = mkdtempSync('/var/tmp/j-');
    fixtures.push(root);
    const target = join(root, 'real');
    const alias = join(root, 'alias');
    mkdirSync(target);
    symlinkSync(target, alias);
    const canonicalScratch = join(realpathSync(target), 'claude-501');
    expect(existsSync(canonicalScratch)).toBe(false);

    const settings = JSON.parse(claudeFilesystemSettings({ options: {
      filesystemRoot: '/site', filesystemRuntimeTempBase: alias,
    } }, { platform, uid: 501, homeDir: '/home/owner', tempDir: '/host/temp' }));
    const { allowRead, allowWrite, denyRead } = settings.sandbox.filesystem;
    expect(allowRead).toContain(canonicalScratch);
    expect(allowWrite).toContain(canonicalScratch);
    expect(allowWrite).toContain(join(alias, 'claude-501'));
    expect(denyRead).toEqual(['/home/owner', '/tmp', '/private/tmp', '/host/temp']);
    for (const outside of [root, alias, target, realpathSync(target), join(realpathSync(target), 'claude-502'), '/tmp', '/private/tmp']) {
      expect(allowRead).not.toContain(outside);
      expect(allowWrite).not.toContain(outside);
    }
  });

  it('refuses a short alias whose canonical scratch path would force shared-temp fallback', () => {
    const root = mkdtempSync('/var/tmp/j-');
    fixtures.push(root);
    const target = join(root, 'a'.repeat(44));
    const alias = join(root, 'alias');
    mkdirSync(target);
    symlinkSync(target, alias);
    expect(() => claudeFilesystemSettings({ options: {
      filesystemRoot: '/site', filesystemRuntimeTempBase: alias,
    } }, { platform: 'linux', uid: 501 })).toThrow('Runtime temp path must not exceed 44 bytes');
  });

  it('does not duplicate an already canonical scratch grant', () => {
    const root = mkdtempSync('/var/tmp/j-');
    fixtures.push(root);
    const base = realpathSync(root);
    const settings = JSON.parse(claudeFilesystemSettings({ options: {
      filesystemRoot: '/site', filesystemRuntimeTempBase: base,
    } }, { platform: 'linux', uid: 501 }));
    expect(settings.sandbox.filesystem.allowWrite).toEqual(['/site', '/site/.agent-runtime/tmp', join(base, 'claude-501')]);
  });

  it('keeps the literal grant when the base does not exist yet', () => {
    const root = mkdtempSync('/var/tmp/j-');
    fixtures.push(root);
    const base = join(realpathSync(root), 'absent');
    const settings = JSON.parse(claudeFilesystemSettings({ options: {
      filesystemRoot: '/site', filesystemRuntimeTempBase: base,
    } }, { platform: 'linux', uid: 501 }));
    expect(settings.sandbox.filesystem.allowWrite).toEqual(['/site', '/site/.agent-runtime/tmp', join(base, 'claude-501')]);
  });

  it('fails closed when the scratch base cannot be resolved', () => {
    const denied = Object.assign(new Error('scratch inaccessible'), { code: 'EACCES' });
    expect(() => claudeFilesystemSettings({ options: {
      filesystemRoot: '/site', filesystemRuntimeTempBase: '/tmp/run',
    } }, { platform: 'linux', uid: 501, realpath: () => { throw denied; } })).toThrow(denied);
  });
});
