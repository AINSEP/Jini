/**
 * Packaging correctness checks for @jini-ai/cms.
 *
 * These catch a failure class that BOTH repos' typechecks and test suites miss, and that has
 * already bitten this package twice:
 *
 *   1. A concrete adapter imports a native module (argon2, sharp) that is not declared. It compiles,
 *      and in a symlinked workspace it even resolves from the consuming repo during development —
 *      then fails at runtime in production, because Node resolves `require()` from a module's
 *      REALPATH, which for a linked package points into this repo's tree, not the consumer's.
 *   2. A module registers things at import time while the package declares `sideEffects: false`,
 *      licensing a bundler to drop it. That fails closed, silently, and ONLY in a bundled build.
 *   3. A ported module reads `process.env`. A library must never resolve host configuration; the
 *      host passes it in. (This is what made `SeedIdentityInput.ownerPassword` required.)
 *
 * Exit 1 on any violation. Intended to run alongside `tsc --noEmit` and `vitest run`.
 *
 * Structure: the three checks are pure functions over `{ rel, src }` records; filesystem access,
 * console output and the process exit are ports wired to Node defaults only at `main`, the
 * composition edge, so the checks are testable without touching the real tree or the process.
 */
import * as nodeFs from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @typedef {{ readFileSync(path: string, encoding: 'utf8'): string; readdirSync(path: string): string[];
 *   statSync(path: string): { isDirectory(): boolean }; realpathSync(path: string): string }} PackagingFs
 * @typedef {{ dependencies?: Record<string, string>; peerDependencies?: Record<string, string>;
 *   sideEffects?: boolean | string[] }} PackageManifest
 * @typedef {{ rel: string; src: string }} SourceFile
 */

/**
 * Recursively list every file path under `dir`.
 * @param {{ dir: string }} required
 * @param {{ fs?: PackagingFs }} [optional]
 * @returns {string[]} Absolute (dir-joined) file paths, depth-first in `readdirSync` order.
 * @complexity O(n) over directory entries.
 */
export function walkFiles({ dir }, { fs = nodeFs } = {}) {
  return fs.readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return fs.statSync(p).isDirectory() ? walkFiles({ dir: p }, { fs }) : [p];
  });
}

/** Only shipped TypeScript sources are checked; tests never reach a consumer. */
export function isCheckedSource(path) {
  return path.endsWith('.ts') && !/__tests__|\.test\.ts$/.test(path);
}

/**
 * Non-relative module specifiers this source imports (static, dynamic, and require-style).
 *
 * Comments are stripped FIRST. Without that, this file's own prose ("...whose first line was
 * `import type { Express } from \"express\"`") is indistinguishable from a real import, and the
 * check reports confident nonsense. A packaging guard that cries wolf gets muted, so precision
 * here matters more than catching an exotic import form.
 * @param {string} src
 * @returns {string[]} De-duplicated specifiers, `node:` builtins included.
 */
export function bareImportSpecifiers(src) {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const specs = [
    // Statement-position `import ... from "x"` / `export ... from "x"` only.
    ...code.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm),
    // Bare side-effect import at statement position.
    ...code.matchAll(/^\s*import\s*["']([^"']+)["']/gm),
    // Dynamic import and require, which must be call-position.
    ...code.matchAll(/\b(?:await\s+)?import\s*\(\s*["']([^"']+)["']\s*\)/g),
    ...code.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].map((m) => m[1]).filter((s) => !s.startsWith('.'));
  return [...new Set(specs)];
}

/** The installable package a specifier resolves to: `@scope/name` or the first path segment. */
export function packageNameOf(spec) {
  return spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
}

/** Check 1: every bare (non-`node:`) import must be a declared dependency or peerDependency. */
export function undeclaredImportProblems({ rel, src, pkg }) {
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
  return bareImportSpecifiers(src)
    .filter((spec) => !spec.startsWith('node:'))
    .map(packageNameOf)
    .filter((name) => !declared.has(name))
    .map((name) => `${rel}: imports "${name}" but it is in neither dependencies nor peerDependencies`);
}

/** Check 2: import-time side effects must be licensed by the `sideEffects` field. */
export function sideEffectProblems({ rel, src, pkg }) {
  const topLevelCalls = src
    .split('\n')
    .filter((l) => /^[a-zA-Z_$][\w$]*\s*\(/.test(l))
    .length;
  if (topLevelCalls === 0) return [];
  const dist = './' + rel.replace(/^src\//, 'dist/').replace(/\.ts$/, '.js');
  const sideEffectFiles = Array.isArray(pkg.sideEffects) ? pkg.sideEffects : [];
  if (pkg.sideEffects === false || (Array.isArray(pkg.sideEffects) && !sideEffectFiles.includes(dist))) {
    return [
      `${rel}: ${topLevelCalls} top-level call(s) = import-time side effects, but "${dist}" is not listed in package.json "sideEffects". A bundler may drop this module.`,
    ];
  }
  return [];
}

/** Check 3: host configuration read inside the library. */
export function envProblems({ rel, src }) {
  return /process\.env/.test(src)
    ? [`${rel}: reads process.env — a library must not resolve host configuration; take it as a parameter`]
    : [];
}

/**
 * Run all three checks over the given sources, in file order then check order.
 * @param {{ pkg: PackageManifest; files: SourceFile[] }} required
 * @returns {string[]} Human-readable problems; empty means the package is clean.
 */
export function checkPackaging({ pkg, files }) {
  return files.flatMap(({ rel, src }) => [
    ...undeclaredImportProblems({ rel, src, pkg }),
    ...sideEffectProblems({ rel, src, pkg }),
    ...envProblems({ rel, src }),
  ]);
}

/**
 * Read the package at `root`, check every shipped source under `root/src`, and report.
 * @param {{ root: string }} required
 * @param {{ fs: PackagingFs; log: (line: string) => void; error: (line: string) => void }} ports
 * @returns {number} The process exit code: 1 on any problem, otherwise 0.
 */
export function runCheckPackaging({ root }, { fs, log, error }) {
  const pkg = JSON.parse(fs.readFileSync(join(root, 'package.json'), 'utf8'));
  const files = walkFiles({ dir: join(root, 'src') }, { fs }).filter(isCheckedSource);
  const problems = checkPackaging({
    pkg,
    files: files.map((file) => ({ rel: relative(root, file), src: fs.readFileSync(file, 'utf8') })),
  });
  if (problems.length) {
    error(`check:packaging — ${problems.length} problem(s):\n`);
    for (const p of problems) error(`  ${p}`);
    return 1;
  }
  log(`check:packaging — OK (${files.length} files checked)`);
  return 0;
}

/**
 * CLI entry: runs only when this module is the process entry point, so importing it (tests,
 * tooling) has no effect. The package root is this script's parent directory.
 * @param {{ moduleUrl: string; argv: readonly string[] }} required
 * @param {{ fs?: PackagingFs; log?: (line: string) => void; error?: (line: string) => void; exit?: (code: number) => void }} [optional]
 * @returns {number | undefined} The exit code when run as the entry point, otherwise undefined.
 */
export function main({ moduleUrl, argv }, { fs = nodeFs, log = console.log, error = console.error, exit = process.exit } = {}) {
  const entry = argv[1];
  if (!entry || pathToFileURL(fs.realpathSync(entry)).href !== moduleUrl) return undefined;
  const root = new URL('..', moduleUrl).pathname.replace(/\/$/, '');
  const code = runCheckPackaging({ root }, { fs, log, error });
  if (code !== 0) exit(code);
  return code;
}

main({ moduleUrl: import.meta.url, argv: process.argv });
