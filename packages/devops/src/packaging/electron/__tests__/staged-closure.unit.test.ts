import { describe, expect, it } from 'vitest';
import { auditStagedClosure, type StagedClosureInput } from '../staged-closure.js';
import { memoryFs } from './memory-fs.js';

type Ref = { specifier: string; kind: 'import' | 'require'; line: number; deferred: boolean };
const ref = (specifier: string, line = 1, kind: 'import' | 'require' = 'import'): Ref => ({ specifier, kind, line, deferred: false });

interface Opts { files: Record<string, string>; refs?: Record<string, Ref[]>; resolve?: Record<string, string>; realpaths?: Record<string, string>; dirs?: string[]; others?: string[]; scan?: string[]; hostModules?: string[]; packageRoots?: string[]; noReferences?: boolean; throwNonError?: string }

function run(o: Opts) {
  const fs = memoryFs({ files: o.files }, { dirs: o.dirs, others: o.others, realpaths: o.realpaths });
  const resolved: Array<{ fromFile: string; specifier: string; kind: string }> = [];
  const input: StagedClosureInput = {
    root: '/stage', scan: o.scan ?? ['/stage/dist'], fs,
    imports: o.noReferences ? { imports: () => [] } : { imports: () => [], references: ({ file }) => o.refs?.[file] ?? [] },
    resolver: { resolve: r => {
      resolved.push(r);
      if (o.throwNonError === r.specifier) throw 'plain string failure';
      const key = `${r.fromFile}|${r.specifier}`;
      const target = o.resolve?.[key];
      if (target === undefined) throw new Error(`Cannot find module '${r.specifier}'`);
      return target;
    } },
    ...(o.hostModules ? { hostModules: new Set(o.hostModules) } : {}),
    ...(o.packageRoots ? { packageRoots: o.packageRoots } : {}),
  };
  return { audit: auditStagedClosure(input), resolved, fs };
}

const manifest = (m: object) => JSON.stringify(m);

describe('auditStagedClosure basics', () => {
  it('requires an AST reference reader', () => {
    expect(() => run({ files: { '/stage/dist/a.js': '' }, noReferences: true })).toThrow('staged closure requires an AST runtime-reference reader');
  });

  it('passes an empty stage', () => {
    expect(run({ files: { '/stage/package.json': '{}' } }).audit).toEqual({ problems: [], optIns: [], checked: 0 });
  });

  it('skips node builtins and host modules without resolving them', () => {
    const { audit, resolved } = run({
      files: { '/stage/dist/a.js': '' },
      refs: { '/stage/dist/a.js': [ref('node:fs'), ref('fs'), ref('electron'), ref('fs/promises')] },
      hostModules: ['electron'],
    });
    expect(audit).toEqual({ problems: [], optIns: [], checked: 1 });
    expect(resolved).toEqual([]);
  });

  it('does not skip a non-builtin when no host modules are declared', () => {
    const { audit } = run({ files: { '/stage/dist/a.js': '' }, refs: { '/stage/dist/a.js': [ref('electron', 4)] } });
    expect(audit.problems).toEqual(["dist/a.js:4 -> electron: Cannot find module 'electron'"]);
  });

  it('follows resolved relative imports, counting each file once even through cycles', () => {
    const { audit, resolved } = run({
      files: { '/stage/dist/a.js': '', '/stage/dist/b.js': '', '/stage/dist/c.js': '' },
      refs: { '/stage/dist/a.js': [ref('./b.js'), ref('./b.js', 2, 'require')], '/stage/dist/b.js': [ref('./a.js'), ref('./c.js')] },
      resolve: { '/stage/dist/a.js|./b.js': '/stage/dist/b.js', '/stage/dist/b.js|./a.js': '/stage/dist/a.js', '/stage/dist/b.js|./c.js': '/stage/dist/c.js' },
    });
    expect(audit).toEqual({ problems: [], optIns: [], checked: 3 });
    expect(resolved).toContainEqual({ fromFile: '/stage/dist/a.js', specifier: './b.js', kind: 'require' });
  });

  it('reports a failed resolution with file, line, specifier and message', () => {
    const { audit } = run({ files: { '/stage/dist/a.js': '' }, refs: { '/stage/dist/a.js': [ref('./missing.js', 7)] } });
    expect(audit.problems).toEqual(["dist/a.js:7 -> ./missing.js: Cannot find module './missing.js'"]);
  });

  it('stringifies a non-Error failure', () => {
    const { audit } = run({ files: { '/stage/dist/a.js': '' }, refs: { '/stage/dist/a.js': [ref('./x.js', 3)] }, throwNonError: './x.js' });
    expect(audit.problems).toEqual(['dist/a.js:3 -> ./x.js: plain string failure']);
  });

  it('does not enqueue resolved targets that are not code files', () => {
    const { audit } = run({
      files: { '/stage/dist/a.js': '', '/stage/dist/data.json': '{}', '/stage/dist/types.d.ts': '', '/stage/dist/x.test.js': '', '/stage/dist/y.spec.ts': '' },
      scan: ['/stage/dist/a.js'],
      refs: { '/stage/dist/a.js': [ref('./data.json'), ref('./types.d.ts'), ref('./x.test.js'), ref('./y.spec.ts')] },
      resolve: { '/stage/dist/a.js|./data.json': '/stage/dist/data.json', '/stage/dist/a.js|./types.d.ts': '/stage/dist/types.d.ts', '/stage/dist/a.js|./x.test.js': '/stage/dist/x.test.js', '/stage/dist/a.js|./y.spec.ts': '/stage/dist/y.spec.ts' },
    });
    expect(audit).toEqual({ problems: [], optIns: [], checked: 1 });
  });
});

describe('resolution safety', () => {
  const base = { files: { '/stage/dist/a.js': '', '/stage/dist/dir/x.js': '', '/outside/o.js': '' } as Record<string, string>, refs: { '/stage/dist/a.js': [ref('pkg', 2)] } };
  const problem = (o: Partial<Opts>) => run({ ...base, ...o } as Opts).audit.problems;

  it('rejects a target outside the stage', () => {
    expect(problem({ resolve: { '/stage/dist/a.js|pkg': '/outside/o.js' } })).toEqual(['dist/a.js:2 -> pkg: resolved outside the staged tree']);
  });

  it('rejects a sibling directory that merely shares the root prefix', () => {
    expect(problem({ files: { ...base.files, '/stage-evil/x.js': '' }, resolve: { '/stage/dist/a.js|pkg': '/stage-evil/x.js' } })).toEqual(['dist/a.js:2 -> pkg: resolved outside the staged tree']);
  });

  it('rejects a target that does not exist', () => {
    expect(problem({ resolve: { '/stage/dist/a.js|pkg': '/stage/dist/nope.js' } })).toEqual(['dist/a.js:2 -> pkg: resolved target does not exist']);
  });

  it('rejects a symlink escaping the stage', () => {
    expect(problem({ scan: ['/stage/dist/a.js'], resolve: { '/stage/dist/a.js|pkg': '/stage/dist/dir/x.js' }, realpaths: { '/stage/dist/dir/x.js': '/outside/o.js' } })).toEqual(['dist/a.js:2 -> pkg: resolved symlink escapes the staged tree']);
  });

  it('rejects a directory target', () => {
    expect(problem({ resolve: { '/stage/dist/a.js|pkg': '/stage/dist/dir' } })).toEqual(['dist/a.js:2 -> pkg: resolved target is not a file']);
  });

  it('compares against the real path of the root', () => {
    const files = { '/stage/dist/a.js': '', '/stage/dist/b.js': '', '/real/dist/a.js': '', '/real/dist/b.js': '' };
    const realpaths = { '/stage': '/real', '/stage/dist': '/real/dist', '/stage/dist/a.js': '/real/dist/a.js', '/stage/dist/b.js': '/real/dist/b.js' };
    const r = run({ files, realpaths, refs: { '/real/dist/a.js': [ref('./b.js')] }, resolve: { '/real/dist/a.js|./b.js': '/real/dist/b.js' } });
    expect(r.audit).toEqual({ problems: [], optIns: [], checked: 2 });
  });
});

describe('scan roots', () => {
  it('ignores a missing scan directory', () => {
    expect(run({ files: { '/stage/package.json': '{}' }, scan: ['/stage/nowhere'] }).audit.checked).toBe(0);
  });

  it('refuses a scan directory that escapes the root', () => {
    expect(() => run({ files: { '/outside/a.js': '' }, scan: ['/stage/link'], dirs: ['/stage/link'], realpaths: { '/stage/link': '/outside' } })).toThrow('staged scan escapes root: /stage/link');
  });

  it('accepts a code file as a scan root and ignores a non-code file', () => {
    expect(run({ files: { '/stage/main.js': '', '/stage/notes.md': '' }, scan: ['/stage/main.js'] }).audit.checked).toBe(1);
    expect(run({ files: { '/stage/main.js': '', '/stage/notes.md': '' }, scan: ['/stage/notes.md'] }).audit.checked).toBe(0);
  });

  it('walks directories recursively picking only code files, using real paths for single files', () => {
    const r = run({
      files: { '/stage/dist/a.js': '', '/stage/dist/sub/b.mjs': '', '/stage/dist/sub/c.cts': '', '/stage/dist/sub/d.tsx': '', '/stage/dist/e.d.ts': '', '/stage/dist/f.test.ts': '', '/stage/dist/g.txt': '', '/stage/dist/link.js': '' },
      realpaths: { '/stage/dist/link.js': '/stage/dist/a.js' },
    });
    expect(r.audit.checked).toBe(4);
  });
});

describe('installed Jini packages', () => {
  const dist = (pkg: string) => `/stage/node_modules/${pkg}/dist/index.js`;

  it('audits every @jini-ai dist file even when no scan root reaches it', () => {
    const r = run({ files: { [dist('@jini-ai/daemon')]: '' }, scan: [], refs: { [dist('@jini-ai/daemon')]: [ref('missing-dep', 5)] } });
    expect(r.audit.problems).toEqual(["node_modules/@jini-ai/daemon/dist/index.js:5 -> missing-dep: Cannot find module 'missing-dep'"]);
    expect(r.audit.checked).toBe(1);
  });

  it('does not audit dist of third-party or other-scope packages, nor hidden entries', () => {
    const r = run({ files: { [dist('left-pad')]: '', [dist('@other/pkg')]: '', '/stage/node_modules/.bin/x/dist/index.js': '', '/stage/node_modules/.pnpm/y/dist/index.js': '' }, scan: [] });
    expect(r.audit.checked).toBe(0);
  });

  it('finds nested installed versions and tolerates a Jini package with no dist', () => {
    const nested = '/stage/node_modules/@jini-ai/a/node_modules/@jini-ai/b/dist/n.js';
    const r = run({ files: { [nested]: '', '/stage/node_modules/@jini-ai/a/package.json': '{}' }, scan: [] });
    expect(r.audit.checked).toBe(1);
  });

  it('honours explicit package roots instead of the stage root', () => {
    const files = { [dist('@jini-ai/daemon')]: '', '/stage/app/node_modules/@jini-ai/mem/dist/m.js': '' };
    expect(run({ files, scan: [] }).audit.checked).toBe(1);
    expect(run({ files, scan: [], packageRoots: ['/stage/app'] }).audit.checked).toBe(1);
    expect(run({ files, scan: [], packageRoots: ['/stage/app', '/stage'] }).audit.checked).toBe(2);
    expect(run({ files, scan: [], packageRoots: [] }).audit.checked).toBe(0);
  });

  it('refuses an installed package whose link escapes the stage', () => {
    expect(() => run({ files: { '/stage/node_modules/evil/index.js': '', '/outside/x.js': '' }, scan: [], realpaths: { '/stage/node_modules/evil': '/outside/evil' } })).toThrow('staged package escapes root: /stage/node_modules/evil');
  });

  it('does not follow third-party targets but does follow Jini dist targets', () => {
    const third = '/stage/node_modules/lib/index.js';
    const jini = '/stage/node_modules/@jini-ai/mem/dist/m.js';
    const r = run({
      files: { '/stage/dist/a.js': '', [third]: '', [jini]: '' },
      refs: { '/stage/dist/a.js': [ref('lib'), ref('@jini-ai/mem/m')], [third]: [ref('hidden-dep')] },
      resolve: { '/stage/dist/a.js|lib': third, '/stage/dist/a.js|@jini-ai/mem/m': jini },
    });
    // a.js, plus the installed Jini dist file (reached by both the walk and the import); third-party never scanned.
    expect(r.audit).toEqual({ problems: [], optIns: [], checked: 2 });
  });

  it('follows a Jini dist target nested below another package', () => {
    const jini = '/stage/node_modules/lib/node_modules/@jini-ai/mem/dist/m.js';
    const r = run({ files: { '/stage/dist/a.js': '', [jini]: '' }, refs: { '/stage/dist/a.js': [ref('x')] }, resolve: { '/stage/dist/a.js|x': jini } });
    expect(r.audit.checked).toBe(2);
  });
});

describe('optional peer exemptions', () => {
  const owner = (m: object) => ({ '/stage/node_modules/@jini-ai/daemon/package.json': manifest({ name: '@jini-ai/daemon', ...m }) });
  const optIn = 'opt-in: terminal — needs smol-toml';
  const peer = { peerDependencies: { 'smol-toml': '*' }, peerDependenciesMeta: { 'smol-toml': { optional: true } }, jini: { optionalPeers: { 'smol-toml': optIn } } };
  const file = '/stage/node_modules/@jini-ai/daemon/dist/index.js';
  const go = (files: Record<string, string>, specifier = 'smol-toml', line = 3) => run({ files: { [file]: '', ...files }, scan: [], refs: { [file]: [ref(specifier, line)] } }).audit;

  it('records an opt-in for a classified optional peer instead of a problem', () => {
    expect(go(owner(peer))).toEqual({ problems: [], optIns: [`node_modules/@jini-ai/daemon/dist/index.js:3 -> smol-toml (${optIn})`], checked: 1 });
  });

  it('uses the package name for deep and scoped specifiers', () => {
    const scoped = { ...peer, peerDependencies: { '@s/p': '*' }, peerDependenciesMeta: { '@s/p': { optional: true } }, jini: { optionalPeers: { '@s/p': optIn } } };
    expect(go(owner(scoped), '@s/p/deep/file').optIns).toHaveLength(1);
    expect(go(owner(peer), 'smol-toml/sub').optIns).toHaveLength(1);
  });

  it('reports a problem when the peer is not classified', () => {
    const bare = { peerDependencies: { 'smol-toml': '*' }, peerDependenciesMeta: { 'smol-toml': { optional: true } } };
    expect(go(owner(bare)).problems).toHaveLength(1);
    expect(go(owner(bare)).optIns).toEqual([]);
  });

  it('never exempts relative, hash-import or absolute specifiers', () => {
    for (const spec of ['./x.js', '../y.js', '#internal', '/abs/path.js']) {
      expect(go(owner(peer), spec).problems).toHaveLength(1);
    }
  });

  it('does not exempt when the owning package is not a Jini package', () => {
    const f = '/stage/node_modules/other/dist/index.js';
    const r = run({ files: { [f]: '', '/stage/node_modules/other/package.json': manifest({ name: 'other', ...peer }) }, scan: [f], refs: { [f]: [ref('smol-toml')] } });
    expect(r.audit.problems).toHaveLength(1);
  });

  it('does not exempt when no manifest owns the file', () => {
    const r = run({ files: { '/stage/dist/a.js': '' }, refs: { '/stage/dist/a.js': [ref('smol-toml')] } });
    expect(r.audit.problems).toHaveLength(1);
  });

  it('skips a nameless dual-build manifest to find the named owner above it', () => {
    const f = '/stage/node_modules/@jini-ai/daemon/dist/cjs/index.js';
    const files = { ...owner(peer), [f]: '', '/stage/node_modules/@jini-ai/daemon/dist/cjs/package.json': manifest({ type: 'commonjs' }) };
    const r = run({ files, scan: [], refs: { [f]: [ref('smol-toml', 9)] } });
    expect(r.audit.optIns).toEqual([`node_modules/@jini-ai/daemon/dist/cjs/index.js:9 -> smol-toml (${optIn})`]);
  });

  it('stops looking at the stage root, using a named root manifest if present', () => {
    const f = '/stage/dist/a.js';
    const r = run({ files: { [f]: '', '/stage/package.json': manifest({ name: '@jini-ai/host', ...peer }) }, refs: { [f]: [ref('smol-toml')] } });
    expect(r.audit.optIns).toHaveLength(1);
    const nameless = run({ files: { [f]: '', '/stage/package.json': manifest({ type: 'module' }) }, refs: { [f]: [ref('smol-toml')] } });
    expect(nameless.audit.problems).toHaveLength(1);
  });
});
