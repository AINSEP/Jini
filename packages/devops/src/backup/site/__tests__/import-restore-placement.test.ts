import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { explainThemeTree, inspectThemeManifests, liveThemeTrees, restoreDestination, writeExclusive, type ImportPlacementChecks } from '../import-restore-placement.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function stage(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'placement-'));
  dirs.push(root);
  for (const [file, text] of Object.entries(files)) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), text); }
  return root;
}
function checks(over: Partial<ImportPlacementChecks> = {}): ImportPlacementChecks {
  return { checkSourceDirContainment: () => [], loadTheme: () => ({ status: 'valid' }), validateSharePath: () => {}, ...over };
}
const plain = JSON.stringify({ tier: 'static' });
const compiled = JSON.stringify({ tier: 'static', build: { source: 'compiled', sourceDir: 'src' } });

describe('inspectThemeManifests', () => {
  it('plain, tier-mismatched, unreadable and compiled manifests get their verdicts', async () => {
    const files = ['themes/static/ok/theme.json', 'themes/static/wrong/theme.json', 'themes/static/broken/theme.json', 'themes/static/built/theme.json'];
    const root = await stage({ [files[0]!]: plain, [files[1]!]: JSON.stringify({ tier: 'declarative' }), [files[2]!]: '{nope', [files[3]!]: compiled });
    const found = inspectThemeManifests({ root, files, checks: checks() });
    expect([...found.quarantinedThemes].sort()).toEqual(['static/broken', 'static/wrong']);
    expect(found.compiledSources).toEqual(new Map([['static/built', 'themes/static/built/src/']]));
  });

  it('a compiled build is quarantined when containment fails, the theme is invalid, or the path is unsafe', async () => {
    const files = ['themes/static/built/theme.json'];
    const root = await stage({ [files[0]!]: compiled });
    const quarantined = (c: ImportPlacementChecks) => [...inspectThemeManifests({ root, files, checks: c }).quarantinedThemes];
    expect(quarantined(checks({ checkSourceDirContainment: () => ['escapes'] }))).toEqual(['static/built']);
    expect(quarantined(checks({ loadTheme: () => ({ status: 'invalid' }) }))).toEqual(['static/built']);
    expect(quarantined(checks({ validateSharePath: () => { throw new Error('unsafe'); } }))).toEqual(['static/built']);
    expect(quarantined(checks())).toEqual([]);
  });

  it('hands the staged build, schema version 2 and the theme folder to the host checks', async () => {
    const files = ['themes/static/built/theme.json'];
    const root = await stage({ [files[0]!]: compiled });
    const contain = vi.fn(() => []); const load = vi.fn(() => ({ status: 'valid' }));
    inspectThemeManifests({ root, files, checks: checks({ checkSourceDirContainment: contain, loadTheme: load }) });
    expect(contain).toHaveBeenCalledWith({ build: { source: 'compiled', sourceDir: 'src' }, schemaVersion: 2 });
    expect(load).toHaveBeenCalledWith({ themeDir: path.join(root, 'themes', 'static/built'), id: 'built', source: 'site' });
  });
});

describe('liveThemeTrees and restoreDestination', () => {
  it('quarantines trees with unsupported files or a quarantined manifest; compiled source is not live', () => {
    const files = ['themes/static/a/index.html', 'themes/static/b/run.ts', 'themes/static/c/index.html', 'themes/static/d/src/x.ts', 'themes/static/d/index.html'];
    const live = liveThemeTrees({ files, findings: { quarantinedThemes: new Set(['static/c']), compiledSources: new Map([['static/d', 'themes/static/d/src/']]) } });
    expect([...live].sort()).toEqual(['static/a', 'static/d']);
    const liveThemes = live; const compiledSources = new Map([['static/d', 'themes/static/d/src/']]);
    expect(restoreDestination({ file: 'settings.json', liveThemes, compiledSources })).toBeNull();
    expect(restoreDestination({ file: 'uploads/x.png', liveThemes, compiledSources })).toBe('uploads/x.png');
    expect(restoreDestination({ file: 'themes/static/a/index.html', liveThemes, compiledSources })).toBe('themes/static/a/index.html');
    expect(restoreDestination({ file: 'themes/static/d/src/x.ts', liveThemes, compiledSources })).toBe('.import-quarantine/themes/static/d/src/x.ts');
    expect(restoreDestination({ file: 'plugins/p/a.txt', liveThemes, compiledSources })).toBe('.import-quarantine/plugins/p/a.txt');
  });
});

describe('explainThemeTree', () => {
  it('explains a missing manifest, build source and non-web files; empty for a live tree', async () => {
    const files = ['themes/static/t/index.html', 'themes/static/t/run.ts'];
    const root = await stage({ [files[0]!]: '<p>', [files[1]!]: 'x' });
    const problems = explainThemeTree({ root, id: 'static/t', files, checks: checks() });
    expect(problems).toEqual(['It has no theme.json file.', 'It holds files that are not plain web files: run.ts.']);
    const okFiles = ['themes/static/ok/theme.json', 'themes/static/ok/index.html'];
    const ok = await stage({ [okFiles[0]!]: plain, [okFiles[1]!]: '<p>' });
    expect(explainThemeTree({ root: ok, id: 'static/ok', files: okFiles, checks: checks() })).toEqual([]);
  });

  it('says why a quarantined manifest was held back, using the host checks', async () => {
    const files = ['themes/static/built/theme.json'];
    const root = await stage({ [files[0]!]: compiled });
    const problems = explainThemeTree({ root, id: 'static/built', files, checks: checks({ loadTheme: () => ({ status: 'invalid' }) }) });
    expect(problems).toContain('Its built files did not pass the theme checks.');
  });
});

describe('writeExclusive', () => {
  it('runs the injected path policy first, refuses escapes, and never overwrites', async () => {
    const root = await stage({});
    const seen: string[] = [];
    const validatePath = ({ path: p }: { path: string }) => { seen.push(p); };
    writeExclusive({ root, relative: 'a/b.txt', bytes: Buffer.from('one'), validatePath });
    expect(await readFile(path.join(root, 'a/b.txt'), 'utf8')).toBe('one');
    expect(() => writeExclusive({ root, relative: 'a/b.txt', bytes: Buffer.from('two'), validatePath })).toThrow(/EEXIST/);
    expect(() => writeExclusive({ root, relative: '../escaped', bytes: Buffer.from('x'), validatePath })).toThrow('Import path escaped staging');
    expect(seen).toEqual(['a/b.txt', 'a/b.txt', '../escaped']);
    const refusing = () => { throw new Error('policy says no'); };
    expect(() => writeExclusive({ root, relative: 'c.txt', bytes: Buffer.from('x'), validatePath: refusing })).toThrow('policy says no');
  });
});
