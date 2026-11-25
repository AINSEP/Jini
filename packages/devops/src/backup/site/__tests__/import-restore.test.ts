import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createImportRestore, type ImportKeepOffRequest, type ImportRestoreHost } from '../import-restore.js';
import { inspectThemeManifests, writeExclusive, type ImportPlacementChecks } from '../import-restore-placement.js';
import type { VerifiedSiteImport } from '../import-verifier.js';

const bases: string[] = [];
afterEach(() => { for (const base of bases.splice(0)) fs.rmSync(base, { recursive: true, force: true }); });

interface Harness { root: string; dir: string; dbPath: string }
function harness(): Harness {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-unit-'));
  bases.push(base);
  const dir = path.join(base, 'site');
  fs.mkdirSync(dir);
  return { root: path.join(base, 'stage'), dir, dbPath: path.join(dir, 'content.db') };
}

const checks: ImportPlacementChecks = { checkSourceDirContainment: () => [], loadTheme: () => ({ status: 'valid' }), validateSharePath: () => {} };
const placeBytes = vi.fn();
const keepOff = vi.fn(async (_request: ImportKeepOffRequest<string>): Promise<string[]> => []);
const pluginState = vi.fn(async (): Promise<ReadonlySet<string>> => new Set());

/** A host over the real placement rules with neutral archive paths; the three effectful steps are spies. */
function host(over: Partial<ImportRestoreHost<string>> = {}): ImportRestoreHost<string> {
  return {
    archivePaths: {
      overridesUnit: 'themes/__ovr__',
      archiveCodeUnit: ({ path: file }) => (/^(agent-)?plugins\//.test(file) ? file.split('/').slice(0, 2).join('/') : undefined),
      editedArchiveWarnings: ({ units }) => [...units].map(unit => `edited:${unit}`),
      keptOffArchiveWarnings: ({ units }) => [...units].map(unit => `kept-off:${unit}`),
    },
    fallbackThemeId: () => 'base',
    inspectThemeManifests: required => inspectThemeManifests({ ...required, checks }),
    writeExclusive: required => { placeBytes(required.relative); writeExclusive({ ...required, validatePath: () => {} }); },
    restoreImportedPluginState: pluginState,
    keepImportedCodeOff: keepOff,
    ...over,
  };
}

function verified(files: Record<string, string>, over: Partial<VerifiedSiteImport> = {}): VerifiedSiteImport {
  return { name: 'Copy', database: Buffer.from('db-bytes'), warnings: [], modified: new Set(), plugins: [], trustedPlugins: [],
    files: new Map(Object.entries(files).map(([file, text]) => [file, Buffer.from(text)])), ...over };
}
const theme = (name: string, html = '<p>x</p>'): Record<string, string> => ({
  [`themes/static/${name}/theme.json`]: JSON.stringify({ tier: 'static' }), [`themes/static/${name}/pages/index.html`]: html });
const read = (...parts: string[]): string | null => (fs.existsSync(path.join(...parts)) ? fs.readFileSync(path.join(...parts), 'utf8') : null);
const state = (root: string) => JSON.parse(fs.readFileSync(path.join(root, '.archive-state.json'), 'utf8'));
const request = (h: Harness, over = {}) => ({ root: h.root, dir: h.dir, dbPath: h.dbPath, pluginLayout: {} as never, openContent: () => 'handle', ...over });

describe('stageVerifiedImport', () => {
  it('writes the database, every file and the inventory into a private stage', () => {
    const h = harness();
    createImportRestore({ host: host() }).stageVerifiedImport({ root: h.root, verified: verified({ 'uploads/a': 'a' }) });
    expect(read(h.root, 'database/content.db')).toBe('db-bytes');
    expect(read(h.root, 'uploads/a')).toBe('a');
    expect(JSON.parse(read(h.root, '.inventory.json')!)).toEqual(['uploads/a']);
    expect(fs.statSync(h.root).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(h.root, '.archive-state.json')).mode & 0o777).toBe(0o600);
  });

  it('stages the encrypted keys only when the archive carried them', () => {
    const [a, b] = [harness(), harness()];
    const restore = createImportRestore({ host: host() });
    restore.stageVerifiedImport({ root: a.root, verified: verified({}, { encryptedKeys: Buffer.from('sealed') }) });
    restore.stageVerifiedImport({ root: b.root, verified: verified({}) });
    expect(read(a.root, '.saved-keys.json')).toBe('sealed');
    expect(read(b.root, '.saved-keys.json')).toBeNull();
  });

  it('keeps unrecognised code units switched off, but not recognised, edited, live or data ones', () => {
    const h = harness();
    const files = { 'uploads/a': 'a', 'plugins/p1/index.js': 'x', 'plugins/p2/index.js': 'x', 'agent-plugins/p3/index.js': 'x', 'overrides/page.html': 'x', ...theme('live'),
      'themes/static/code/theme.json': JSON.stringify({ tier: 'static' }), 'themes/static/code/main.ts': 'x' };
    createImportRestore({ host: host() }).stageVerifiedImport({ root: h.root, verified: verified(files, {
      modified: new Set(['plugins/p2']), trustedPlugins: [{ id: 'p3' } as never] }) });
    expect(state(h.root).keptOff.sort()).toEqual(['plugins/p1', 'themes/__ovr__', 'themes/code']);
  });

  it('refuses to reuse an existing stage folder', () => {
    const h = harness();
    fs.mkdirSync(h.root);
    expect(() => createImportRestore({ host: host() }).stageVerifiedImport({ root: h.root, verified: verified({}) })).toThrow();
  });
});

describe('stagedImportWarnings', () => {
  it('is empty without a stage state, and merges stored, edited and kept-off notices without repeats', () => {
    const h = harness();
    const restore = createImportRestore({ host: host() });
    expect(restore.stagedImportWarnings({ root: h.root })).toEqual([]);
    restore.stageVerifiedImport({ root: h.root, verified: verified({ 'plugins/p1/x.js': 'x' }, { warnings: ['w', 'w'], modified: new Set(['m']) }) });
    expect(restore.stagedImportWarnings({ root: h.root })).toEqual(['w', 'edited:m', 'kept-off:plugins/p1']);
  });
});

describe('restoreStagedImport', () => {
  async function staged(files: Record<string, string>, over: Partial<VerifiedSiteImport> = {}, hostOver: Partial<ImportRestoreHost<string>> = {}) {
    const h = harness();
    const restore = createImportRestore({ host: host(hostOver) });
    restore.stageVerifiedImport({ root: h.root, verified: verified(files, over) });
    placeBytes.mockClear();
    return { h, restore };
  }

  it('places uploads and live themes, quarantines everything else and drops settings.json', async () => {
    const { h, restore } = await staged({ 'uploads/a': 'a', 'settings.json': '{}', 'overrides/x.html': 'o', ...theme('alpha'), 'themes/static/code/theme.json': JSON.stringify({ tier: 'static' }), 'themes/static/code/main.ts': 'x' });
    await restore.restoreStagedImport(request(h));
    expect(read(h.dir, 'uploads/a')).toBe('a');
    expect(read(h.dir, 'themes/static/alpha/pages/index.html')).toBe('<p>x</p>');
    expect(read(h.dir, '.import-quarantine/overrides/x.html')).toBe('o');
    expect(read(h.dir, '.import-quarantine/themes/static/code/main.ts')).toBe('x');
    expect(read(h.dir, 'settings.json')).toBeNull();
    expect(read(h.dbPath)).toBe('db-bytes');
  });

  it('copies the database exclusively, never overwriting an existing one', async () => {
    const { h, restore } = await staged({ 'uploads/a': 'a' });
    fs.writeFileSync(h.dbPath, 'existing');
    await expect(restore.restoreStagedImport(request(h))).rejects.toThrow(/EEXIST/);
    expect(read(h.dbPath)).toBe('existing');
  });

  it('quarantines a live theme the archive marks as edited and replaces the others', async () => {
    const { h, restore } = await staged({ ...theme('alpha', 'new'), ...theme('beta', 'new') }, { modified: new Set(['themes/beta']) });
    fs.mkdirSync(path.join(h.dir, 'themes/static/alpha/pages'), { recursive: true });
    fs.writeFileSync(path.join(h.dir, 'themes/static/alpha/stale.txt'), 'stale');
    await restore.restoreStagedImport(request(h));
    expect(read(h.dir, 'themes/static/alpha/stale.txt')).toBeNull();
    expect(read(h.dir, 'themes/static/alpha/pages/index.html')).toBe('new');
    expect(read(h.dir, 'themes/static/beta/pages/index.html')).toBeNull();
    expect(read(h.dir, '.import-quarantine/themes/static/beta/pages/index.html')).toBe('new');
  });

  it('never replaces the fallback theme: the archive copy is set aside and the step is told', async () => {
    const { h, restore } = await staged({ ...theme('base', 'imported'), ...theme('alpha', 'imported') });
    for (const name of ['base', 'alpha']) { fs.mkdirSync(path.join(h.dir, `themes/static/${name}/pages`), { recursive: true }); fs.writeFileSync(path.join(h.dir, `themes/static/${name}/pages/index.html`), 'own'); fs.writeFileSync(path.join(h.dir, `themes/static/${name}/theme.json`), JSON.stringify({ tier: 'static' })); }
    await restore.restoreStagedImport(request(h));
    const call = keepOff.mock.calls.at(-1)![0];
    expect(call.setAside).toBe(true);
    expect(call.fallback).toBe('base');
    expect([...call.unrecognised]).toEqual(['alpha']);
    expect([...call.liveThemes]).toEqual(['static/alpha']);
    expect(read(h.dir, 'themes/static/base/pages/index.html')).toBe('own');
    expect(read(h.dir, '.import-quarantine/themes/static/base/pages/index.html')).toBe('imported');
  });

  it('skips files the plugin restore placed itself and forwards its source root', async () => {
    pluginState.mockResolvedValueOnce(new Set(['uploads/a']));
    const { h, restore } = await staged({ 'uploads/a': 'a', 'uploads/b': 'b' });
    await restore.restoreStagedImport(request(h), { pluginSourceRoot: '/src-root' });
    expect(placeBytes.mock.calls.map(call => call[0])).toEqual(['uploads/b']);
    expect(pluginState).toHaveBeenLastCalledWith(expect.objectContaining({ dir: h.dir, root: h.root, files: ['uploads/a', 'uploads/b'] }), { sourceRoot: '/src-root' });
  });

  it('hands the keep-off step the host handle opener and merges its notices into the warnings', async () => {
    keepOff.mockImplementationOnce(async request => [`opened:${request.openContent({ filePath: 'x' })}`, 'w']);
    const { h, restore } = await staged({ 'uploads/a': 'a' }, { warnings: ['w'] });
    await restore.restoreStagedImport(request(h));
    expect(restore.stagedImportWarnings({ root: h.root })).toEqual(['w', 'opened:handle']);
  });

  it('restores optional saved keys with the allocated site identity and merges their notices', async () => {
    const restoreKeys = vi.fn(async () => ({ notices: ['keys-note'] }));
    const { h, restore } = await staged({}, { encryptedKeys: Buffer.from('sealed') });
    const signal = new AbortController().signal;
    await restore.restoreStagedImport(request(h, { siteId: 'site-1', savedKeys: { restore: restoreKeys } }), { savedKeysPassword: 'pw', signal });
    expect(restoreKeys).toHaveBeenCalledWith({ encryptedKeys: Buffer.from('sealed'), password: 'pw', siteId: 'site-1', dir: h.dir, dbPath: h.dbPath }, { signal });
    expect(restore.stagedImportWarnings({ root: h.root })).toEqual(['keys-note']);
  });

  it('leaves saved keys out with a fixed notice when no restore service or site id exists, and skips them when absent', async () => {
    const unavailable = 'Saved keys were left out because their restore service was unavailable.';
    const restoreKeys = vi.fn(async () => ({ notices: [] }));
    const withKeys = await staged({}, { encryptedKeys: Buffer.from('sealed') });
    await withKeys.restore.restoreStagedImport(request(withKeys.h, { savedKeys: { restore: restoreKeys } }));
    expect(restoreKeys).not.toHaveBeenCalled();
    expect(withKeys.restore.stagedImportWarnings({ root: withKeys.h.root })).toEqual([unavailable]);
    const none = await staged({});
    await none.restore.restoreStagedImport(request(none.h));
    expect(none.restore.stagedImportWarnings({ root: none.h.root })).toEqual([]);
  });
});
