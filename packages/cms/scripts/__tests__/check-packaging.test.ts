import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  bareImportSpecifiers,
  checkPackaging,
  envProblems,
  isCheckedSource,
  main,
  packageNameOf,
  runCheckPackaging,
  sideEffectProblems,
  undeclaredImportProblems,
  walkFiles,
} from '../check-packaging.mjs';

/**
 * @file The packaging guard's three checks are pure over `{ rel, src }`; the CLI's filesystem,
 * console and exit are ports. Fakes below are a hand-written in-memory tree, never a module mock.
 */

/** In-memory filesystem: keys ending in "/" are directories, everything else a file. */
function fakeFs(tree: Record<string, string>) {
  const isDir = (p: string) => Object.keys(tree).some((k) => k.startsWith(`${p}/`));
  return {
    readFileSync(path: string) {
      const content = tree[path];
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    readdirSync(dir: string) {
      const names = Object.keys(tree)
        .filter((k) => k.startsWith(`${dir}/`))
        .map((k) => k.slice(dir.length + 1).split('/')[0]!);
      return [...new Set(names)];
    },
    statSync(path: string) {
      return { isDirectory: () => isDir(path) };
    },
    realpathSync(path: string) {
      return path;
    },
  };
}

function captureOutput() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, log: (line: string) => out.push(line), error: (line: string) => err.push(line) };
}

const ROOT = '/virtual/pkg';
const SCRIPT_URL = pathToFileURL(`${ROOT}/scripts/check-packaging.mjs`).href;

describe('bareImportSpecifiers', () => {
  it('collects static, re-export, side-effect, dynamic and require specifiers, skipping relatives', () => {
    const src = [
      "import { a } from 'pkg-a';",
      'import type { B } from "@scope/b/sub";',
      "export { c } from 'pkg-c/deep/path';",
      "import 'side-effect-pkg';",
      "const d = await import('pkg-d');",
      "const e = require('pkg-e');",
      "import { local } from './local.js';",
      "import { a as again } from 'pkg-a';",
    ].join('\n');
    expect(bareImportSpecifiers(src)).toEqual(['pkg-a', '@scope/b/sub', 'pkg-c/deep/path', 'side-effect-pkg', 'pkg-d', 'pkg-e']);
  });

  it('ignores imports that only appear inside block or line comments', () => {
    const src = [
      '/* import { x } from "commented-block"; */',
      '// import { y } from "commented-line";',
      "import { z } from 'real-dep'; // trailing note: import 'not-this'",
    ].join('\n');
    expect(bareImportSpecifiers(src)).toEqual(['real-dep']);
  });

  it('does not mistake the "//" of a URL for a comment that would hide the rest of the line', () => {
    expect(bareImportSpecifiers("const u = 'https://cdn.test'; const m = require('real-dep');")).toEqual(['real-dep']);
  });
});

describe('packageNameOf', () => {
  it('maps scoped and unscoped deep specifiers to their installable package', () => {
    expect(packageNameOf('@scope/name/deep/file.js')).toBe('@scope/name');
    expect(packageNameOf('lodash/fp')).toBe('lodash');
    expect(packageNameOf('plain')).toBe('plain');
  });
});

describe('isCheckedSource', () => {
  it('checks shipped .ts sources only', () => {
    expect(isCheckedSource('/r/src/a.ts')).toBe(true);
    expect(isCheckedSource('/r/src/a.test.ts')).toBe(false);
    expect(isCheckedSource('/r/src/__tests__/fixture.ts')).toBe(false);
    expect(isCheckedSource('/r/src/a.js')).toBe(false);
  });
});

describe('undeclaredImportProblems', () => {
  const src = "import 'node:fs';\nimport { a } from 'dep-a';\nimport { p } from 'peer-p';\nimport { m } from '@scope/missing/x';";

  it('accepts dependencies, peerDependencies and node: builtins, and names each undeclared package', () => {
    expect(undeclaredImportProblems({ rel: 'src/x.ts', src, pkg: { dependencies: { 'dep-a': '1' }, peerDependencies: { 'peer-p': '1' } } })).toEqual([
      'src/x.ts: imports "@scope/missing" but it is in neither dependencies nor peerDependencies',
    ]);
  });

  it('treats a manifest with no dependency sections as declaring nothing', () => {
    expect(undeclaredImportProblems({ rel: 'src/x.ts', src, pkg: {} })).toEqual([
      'src/x.ts: imports "dep-a" but it is in neither dependencies nor peerDependencies',
      'src/x.ts: imports "peer-p" but it is in neither dependencies nor peerDependencies',
      'src/x.ts: imports "@scope/missing" but it is in neither dependencies nor peerDependencies',
    ]);
  });
});

describe('sideEffectProblems', () => {
  const withCalls = 'register(thing);\nsetup();\nconst ok = 1;\n  indented();';

  it('reports nothing for a module without top-level calls, whatever sideEffects says', () => {
    expect(sideEffectProblems({ rel: 'src/a.ts', src: 'const x = f();', pkg: { sideEffects: false } })).toEqual([]);
  });

  it('flags top-level calls when the package declares sideEffects: false', () => {
    expect(sideEffectProblems({ rel: 'src/core/a.ts', src: withCalls, pkg: { sideEffects: false } })).toEqual([
      'src/core/a.ts: 2 top-level call(s) = import-time side effects, but "./dist/core/a.js" is not listed in package.json "sideEffects". A bundler may drop this module.',
    ]);
  });

  it('flags a module missing from a sideEffects allow-list and accepts one that is listed', () => {
    expect(sideEffectProblems({ rel: 'src/a.ts', src: withCalls, pkg: { sideEffects: ['./dist/other.js'] } })).toHaveLength(1);
    expect(sideEffectProblems({ rel: 'src/a.ts', src: withCalls, pkg: { sideEffects: ['./dist/a.js'] } })).toEqual([]);
  });

  it('accepts top-level calls when sideEffects is absent or true (no tree-shaking licence given)', () => {
    expect(sideEffectProblems({ rel: 'src/a.ts', src: withCalls, pkg: {} })).toEqual([]);
    expect(sideEffectProblems({ rel: 'src/a.ts', src: withCalls, pkg: { sideEffects: true } })).toEqual([]);
  });
});

describe('envProblems', () => {
  it('flags any process.env read and passes sources that take configuration as parameters', () => {
    expect(envProblems({ rel: 'src/a.ts', src: 'const k = process.env.KEY;' })).toEqual([
      'src/a.ts: reads process.env — a library must not resolve host configuration; take it as a parameter',
    ]);
    expect(envProblems({ rel: 'src/a.ts', src: 'export function f(env: string) { return env; }' })).toEqual([]);
  });
});

describe('checkPackaging', () => {
  it('reports every check per file, in file order then check order', () => {
    const files = [
      { rel: 'src/clean.ts', src: "import { a } from 'dep-a';" },
      { rel: 'src/bad.ts', src: "import { z } from 'undeclared';\ninit();\nconst v = process.env.V;" },
    ];
    expect(checkPackaging({ pkg: { dependencies: { 'dep-a': '1' }, sideEffects: false }, files })).toEqual([
      'src/bad.ts: imports "undeclared" but it is in neither dependencies nor peerDependencies',
      'src/bad.ts: 1 top-level call(s) = import-time side effects, but "./dist/bad.js" is not listed in package.json "sideEffects". A bundler may drop this module.',
      'src/bad.ts: reads process.env — a library must not resolve host configuration; take it as a parameter',
    ]);
  });
});

describe('walkFiles', () => {
  it('lists nested files depth-first through the injected fs port', () => {
    const fs = fakeFs({ '/t/a.ts': '', '/t/sub/b.ts': '', '/t/sub/deeper/c.ts': '' });
    expect(walkFiles({ dir: '/t' }, { fs })).toEqual(['/t/a.ts', '/t/sub/b.ts', '/t/sub/deeper/c.ts']);
  });

  it('defaults to the real filesystem', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-packaging-'));
    try {
      mkdirSync(join(dir, 'nested'));
      writeFileSync(join(dir, 'nested', 'x.ts'), 'export {};');
      expect(walkFiles({ dir })).toEqual([join(dir, 'nested', 'x.ts')]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runCheckPackaging', () => {
  const pkgJson = JSON.stringify({ dependencies: { 'dep-a': '1' }, sideEffects: false });

  it('prints OK with the number of shipped sources checked, skipping tests, and returns 0', () => {
    const fs = fakeFs({
      [`${ROOT}/package.json`]: pkgJson,
      [`${ROOT}/src/a.ts`]: "import { a } from 'dep-a';",
      [`${ROOT}/src/nested/b.ts`]: 'export const b = 1;',
      [`${ROOT}/src/__tests__/t.ts`]: 'const x = process.env.X;',
      [`${ROOT}/src/a.test.ts`]: "import 'undeclared';",
      [`${ROOT}/src/readme.md`]: 'process.env',
    });
    const io = captureOutput();
    expect(runCheckPackaging({ root: ROOT }, { fs, ...io })).toBe(0);
    expect(io.out).toEqual(['check:packaging — OK (2 files checked)']);
    expect(io.err).toEqual([]);
  });

  it('prints a problem count header then each problem with root-relative paths, and returns 1', () => {
    const fs = fakeFs({
      [`${ROOT}/package.json`]: pkgJson,
      [`${ROOT}/src/media/env.ts`]: 'export const v = process.env.V;',
    });
    const io = captureOutput();
    expect(runCheckPackaging({ root: ROOT }, { fs, ...io })).toBe(1);
    expect(io.out).toEqual([]);
    expect(io.err).toEqual([
      'check:packaging — 1 problem(s):\n',
      '  src/media/env.ts: reads process.env — a library must not resolve host configuration; take it as a parameter',
    ]);
  });
});

describe('main', () => {
  const failingTree = {
    [`${ROOT}/package.json`]: '{}',
    [`${ROOT}/src/a.ts`]: 'export const v = process.env.V;',
  };

  it('does nothing when this module is not the process entry point', () => {
    const exits: number[] = [];
    const io = captureOutput();
    const fs = fakeFs(failingTree);
    expect(main({ moduleUrl: SCRIPT_URL, argv: ['node', '/elsewhere/other.mjs'] }, { fs, ...io, exit: (c: number) => exits.push(c) })).toBeUndefined();
    expect(main({ moduleUrl: SCRIPT_URL, argv: ['node'] }, { fs, ...io, exit: (c: number) => exits.push(c) })).toBeUndefined();
    expect([exits, io.out, io.err]).toEqual([[], [], []]);
  });

  it('as the entry point, checks the package one directory above the script and exits 1 on problems', () => {
    const exits: number[] = [];
    const io = captureOutput();
    const code = main({ moduleUrl: SCRIPT_URL, argv: ['node', `${ROOT}/scripts/check-packaging.mjs`] }, { fs: fakeFs(failingTree), ...io, exit: (c: number) => exits.push(c) });
    expect(code).toBe(1);
    expect(exits).toEqual([1]);
    expect(io.err[0]).toBe('check:packaging — 1 problem(s):\n');
  });

  it('as the entry point of a clean package, logs OK and never calls exit', () => {
    const exits: number[] = [];
    const io = captureOutput();
    const fs = fakeFs({ [`${ROOT}/package.json`]: '{}', [`${ROOT}/src/a.ts`]: 'export const a = 1;' });
    expect(main({ moduleUrl: SCRIPT_URL, argv: ['node', `${ROOT}/scripts/check-packaging.mjs`] }, { fs, ...io, exit: (c: number) => exits.push(c) })).toBe(0);
    expect(exits).toEqual([]);
    expect(io.out).toEqual(['check:packaging — OK (1 files checked)']);
  });

  it('resolves the entry path through realpath, so a symlinked invocation still counts as the entry', () => {
    const io = captureOutput();
    const fs = { ...fakeFs({ [`${ROOT}/package.json`]: '{}' }), realpathSync: (p: string) => (p === '/link/cp.mjs' ? `${ROOT}/scripts/check-packaging.mjs` : p) };
    expect(main({ moduleUrl: SCRIPT_URL, argv: ['node', '/link/cp.mjs'] }, { fs, ...io, exit: () => undefined })).toBe(0);
  });

  it('defaults its ports to Node: imported under a test runner it is not the entry and stays inert', () => {
    const entry = process.argv[1]!;
    expect(pathToFileURL(realpathSync(entry)).href).not.toBe(SCRIPT_URL);
    expect(main({ moduleUrl: SCRIPT_URL, argv: process.argv })).toBeUndefined();
  });
});
