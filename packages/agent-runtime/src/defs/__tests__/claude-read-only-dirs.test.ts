import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeFilesystemSettings, validateReadOnlyExtraDirs } from '../../claude-filesystem-policy.js';
import { claudeAgentDef } from '../claude.js';

// Owner 2026-10-27: the owner-picked folder is natively readable, never natively writable.
const fixtures: string[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true }); });

function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'read-only-dirs-')));
  fixtures.push(base);
  // The site lies outside home so each refusal is reached by its own rule, not by another's.
  const home = join(base, 'users', 'owner'), site = join(base, 'sites', 'site'), picked = join(home, 'Desktop', 'Picked Folder');
  mkdirSync(site, { recursive: true }); mkdirSync(picked, { recursive: true });
  return { base, home, site, picked };
}

describe('validateReadOnlyExtraDirs', () => {
  it('returns the canonical picked folder outside the site', () => {
    const { home, site, picked } = fixture();
    expect(validateReadOnlyExtraDirs({ filesystemRoot: site, dirs: [picked] }, { homeDir: home })).toEqual([picked]);
  });

  it('refuses /, home, an ancestor of home, an ancestor of the site, the site and paths inside it', () => {
    const { base, home, site } = fixture();
    mkdirSync(join(site, 'inner'));
    for (const dir of ['/', home, join(base, 'users'), base, join(base, 'sites'), site, join(site, 'inner')]) {
      expect(() => validateReadOnlyExtraDirs({ filesystemRoot: site, dirs: [dir] }, { homeDir: home }), dir).toThrow();
    }
  });

  it('refuses relative, missing and non-directory paths', () => {
    const { home, site, picked } = fixture();
    writeFileSync(join(picked, 'file.txt'), 'x');
    for (const dir of ['Desktop/Picked Folder', join(home, 'missing'), join(picked, 'file.txt')]) {
      expect(() => validateReadOnlyExtraDirs({ filesystemRoot: site, dirs: [dir] }, { homeDir: home }), dir).toThrow();
    }
  });

  it.skipIf(process.platform === 'win32')('refuses a symlinked folder even when its target is acceptable', () => {
    const { home, site, picked } = fixture();
    const alias = join(home, 'alias'); symlinkSync(picked, alias);
    expect(() => validateReadOnlyExtraDirs({ filesystemRoot: site, dirs: [alias] }, { homeDir: home })).toThrow('symlink');
  });
});

describe('Claude read-only settings for the picked folder', () => {
  const facts = { platform: 'darwin' as const, homeDir: '/Users/owner', tempDir: '/var/tmp', uid: 501 };
  const picked = '/Users/owner/Desktop/Picked Folder';

  it('makes the folder a working directory for reads while every write path is denied', () => {
    const settings = JSON.parse(claudeFilesystemSettings({ options: { filesystemRoot: '/site', filesystemReadOnlyDirs: [picked] } }, facts));
    expect(settings.permissions.additionalDirectories).toEqual([picked]);
    expect(settings.permissions.deny).toContain(`Edit(/${picked}/**)`);
    expect(settings.sandbox.filesystem.allowRead).toContain(picked);
    expect(settings.sandbox.filesystem.denyWrite).toEqual([picked]);
    expect(settings.sandbox.filesystem.allowWrite).not.toContain(picked);
  });

  it('grants nothing for a path a permission rule cannot express literally', () => {
    const odd = '/Users/owner/Desktop/a*b';
    const settings = JSON.parse(claudeFilesystemSettings({ options: { filesystemRoot: '/site', filesystemReadOnlyDirs: [odd] } }, facts));
    expect(JSON.stringify(settings)).not.toContain('a*b');
    expect(settings.permissions.additionalDirectories).toEqual([]);
  });

  it('keeps host deny rules and stays identical when rebuilt from its own output', () => {
    const options = { filesystemRoot: '/site', filesystemReadOnlyDirs: [picked], settings: JSON.stringify({ permissions: { deny: ['Read(//**/.env)'] } }) };
    const once = claudeFilesystemSettings({ options }, facts);
    expect(JSON.parse(once).permissions.deny).toEqual(['Read(//**/.env)', `Edit(/${picked}/**)`]);
    expect(claudeFilesystemSettings({ options: { ...options, settings: once } }, facts)).toBe(once);
  });

  it('leaves the default policy unchanged without a picked folder', () => {
    const settings = JSON.parse(claudeFilesystemSettings({ options: { filesystemRoot: '/site' } }, facts));
    expect(settings.permissions.additionalDirectories).toEqual([]);
    expect(settings.permissions.deny).toBeUndefined();
    expect(settings.sandbox.filesystem.denyWrite).toBeUndefined();
  });

  it('refuses an unsafe read-only folder at buildArgs time', () => {
    const { base, site } = fixture();
    expect(() => claudeAgentDef.buildArgs({ prompt: 'hi', imagePaths: [] }, {
      options: { filesystemRoot: site, filesystemReadOnlyDirs: [join(base, 'sites')] }, runtimeContext: { cwd: site },
    })).toThrow();
  });
});
