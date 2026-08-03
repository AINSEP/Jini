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
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SRC = join(ROOT, 'src');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
]);
const sideEffectFiles = Array.isArray(pkg.sideEffects) ? pkg.sideEffects : [];

function walk(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(SRC).filter((f) => f.endsWith('.ts') && !/__tests__|\.test\.ts$/.test(f));

const problems = [];

for (const file of files) {
  const rel = relative(ROOT, file);
  const src = readFileSync(file, 'utf8');

  // 1. Undeclared bare imports (static, dynamic, and createRequire-style).
  //
  // Comments are stripped FIRST. Without that, this file's own prose ("...whose first line was
  // `import type { Express } from \"express\"`") is indistinguishable from a real import, and the
  // check reports confident nonsense. A packaging guard that cries wolf gets muted, so precision
  // here matters more than catching an exotic import form.
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
  for (const spec of new Set(specs)) {
    if (spec.startsWith('node:')) continue;
    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    if (!declared.has(name)) {
      problems.push(`${rel}: imports "${name}" but it is in neither dependencies nor peerDependencies`);
    }
  }

  // 2. Import-time side effects vs the sideEffects field.
  const topLevelCalls = src
    .split('\n')
    .filter((l) => /^[a-zA-Z_$][\w$]*\s*\(/.test(l))
    .length;
  if (topLevelCalls > 0) {
    const dist = './' + rel.replace(/^src\//, 'dist/').replace(/\.ts$/, '.js');
    if (pkg.sideEffects === false || (Array.isArray(pkg.sideEffects) && !sideEffectFiles.includes(dist))) {
      problems.push(
        `${rel}: ${topLevelCalls} top-level call(s) = import-time side effects, but "${dist}" is not listed in package.json "sideEffects". A bundler may drop this module.`,
      );
    }
  }

  // 3. Host configuration read inside the library.
  if (/process\.env/.test(src)) {
    problems.push(`${rel}: reads process.env — a library must not resolve host configuration; take it as a parameter`);
  }
}

if (problems.length) {
  console.error(`check:packaging — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check:packaging — OK (${files.length} files checked)`);
