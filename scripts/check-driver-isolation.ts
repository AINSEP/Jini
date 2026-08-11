/**
 * R12 — driver isolation.
 *
 * A package that ships selectively-installable backends (`@jini-ai/infra`: `./db/core` +
 * `./db/sqlite`) makes a promise its export map alone cannot keep: *importing the neutral entry
 * point must not load a driver*. Node does not tree-shake — whatever the static import graph
 * reaches gets resolved and executed — so a single stray import inside the neutral directory
 * turns an optional peer dependency into a hard one, and a host running Postgres starts
 * compiling `better-sqlite3` for code it never calls. The failure is silent in the repo (where
 * every optional peer is installed as a devDependency) and only surfaces in a consumer's
 * install, which is exactly the class of bug a guard check exists for.
 *
 * The rule, in two parts:
 *
 *  1. **The neutral directory is closed under relative imports.** Any relative specifier that
 *     resolves outside it is a violation. This is what makes transitive reachability impossible
 *     by construction rather than by a graph walk: if nothing inside can reach outside, nothing
 *     outside can be reached indirectly either.
 *  2. **No optional peer dependency may be imported from it.** The forbidden list is not
 *     hardcoded — it is derived from the package's own `peerDependenciesMeta` optional entries.
 *     Marking a new peer optional (adding `pg` later) automatically extends this check with no
 *     edit here, which is the property that keeps it from rotting.
 *
 * Opt-in per package via `jini.neutralEntries` in package.json — a list of package-relative
 * directories (`["src/db/core"]`). Packages without it are not scanned, so this costs nothing
 * for the other twenty-odd packages in the repo.
 *
 * Type-only imports are flagged too, deliberately, for two reasons. The narrow one: this repo
 * sets `verbatimModuleSyntax`, under which `import type { X } from './d.js'` erases but the
 * inline form `import { type X } from './d.js'` emits `import {} from './d.js'` — a real
 * runtime load — and the two are not reliably distinguishable by the shared regex extractor.
 * The broad one: a neutral core depending on a driver's types is a design inversion even when it
 * happens to cost nothing at runtime. Shared types belong in the core, which is where a second
 * driver will look for them.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { Violation } from './check-engine-boundaries.js';
import { extractImports, listSourceFiles, REPO_ROOT } from './lib/walk-imports.js';

interface NeutralTarget {
  /** Package directory name under `packages/`. */
  readonly packageDirName: string;
  /** Absolute path of the package root. */
  readonly packageDir: string;
  /** Package-relative neutral directory, forward-slashed (e.g. `src/db/core`). */
  readonly neutralRel: string;
  /** Absolute path of the neutral directory. */
  readonly neutralDir: string;
  /** Bare specifiers this package declares as optional peers — the derived driver list. */
  readonly optionalPeers: readonly string[];
}

/** `node:`-prefixed builtins are always fine — they ship with the runtime, never with a driver. */
function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith('node:');
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

/**
 * The installable package name a specifier resolves to: `drizzle-orm/better-sqlite3` →
 * `drizzle-orm`, `@scope/pkg/sub` → `@scope/pkg`. Subpath imports of an optional peer are just
 * as load-bearing as its root, so both must map to the same name for the comparison to hold.
 */
function packageNameOf(specifier: string): string {
  const segments = specifier.split('/');
  if (specifier.startsWith('@')) return segments.slice(0, 2).join('/');
  return segments[0] ?? specifier;
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Optional peers, i.e. every key of `peerDependenciesMeta` whose entry sets `optional: true`. */
function readOptionalPeers(manifest: Record<string, unknown>): string[] {
  const meta = manifest['peerDependenciesMeta'];
  if (!meta || typeof meta !== 'object') return [];
  return Object.entries(meta as Record<string, unknown>)
    .filter(([, v]) => Boolean(v && typeof v === 'object' && (v as { optional?: unknown }).optional === true))
    .map(([name]) => name);
}

function readNeutralEntries(manifest: Record<string, unknown>): string[] {
  const jini = manifest['jini'];
  if (!jini || typeof jini !== 'object') return [];
  const entries = (jini as { neutralEntries?: unknown }).neutralEntries;
  if (!Array.isArray(entries)) return [];
  return entries.filter((e): e is string => typeof e === 'string');
}

function collectTargets(packagesDir: string): NeutralTarget[] {
  const targets: NeutralTarget[] = [];
  let packageDirNames: string[];
  try {
    packageDirNames = readdirSync(packagesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return targets;
  }

  for (const packageDirName of packageDirNames) {
    const packageDir = join(packagesDir, packageDirName);
    const manifest = readJson(join(packageDir, 'package.json'));
    if (!manifest) continue;

    const optionalPeers = readOptionalPeers(manifest);
    for (const neutralRel of readNeutralEntries(manifest)) {
      targets.push({
        packageDirName,
        packageDir,
        neutralRel,
        neutralDir: join(packageDir, neutralRel),
        optionalPeers,
      });
    }
  }
  return targets;
}

/**
 * Resolves a relative specifier to the source file it names. Written `./x.js` per this repo's
 * extensionless-import convention (R11) but backed by `x.ts`, so the `.js` suffix is rewritten
 * before probing. Returns the resolved path even when no file exists — a dangling specifier is
 * a different check's problem, and this one still needs to judge *where it pointed*.
 */
function resolveRelative(fromFile: string, specifier: string): string {
  const base = resolve(dirname(fromFile), specifier);
  const withoutJs = base.endsWith('.js') ? base.slice(0, -3) : base;
  for (const candidate of [`${withoutJs}.ts`, `${withoutJs}.tsx`, join(withoutJs, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return base;
}

/** True if `absPath` is inside `dir` (or is `dir` itself). */
function isInside(dir: string, absPath: string): boolean {
  const rel = relative(dir, absPath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export interface CheckDriverIsolationOptions {
  /** Treat this directory as the repo root. Defaults to the real repo root. */
  readonly repoRoot?: string;
  /** Treat this directory as the `packages/` root to scan. Defaults to `<repoRoot>/packages`. */
  readonly packagesDir?: string;
}

export async function checkDriverIsolation(
  options: CheckDriverIsolationOptions = {},
): Promise<Violation[]> {
  const root = options.repoRoot ?? REPO_ROOT;
  const packagesDir = options.packagesDir ?? join(root, 'packages');
  const violations: Violation[] = [];

  for (const target of collectTargets(packagesDir)) {
    for (const absFile of listSourceFiles(target.neutralDir)) {
      const file = relative(root, absFile).split('\\').join('/');

      for (const ref of extractImports(absFile)) {
        const { specifier } = ref;
        if (isNodeBuiltin(specifier)) continue;

        if (isRelative(specifier)) {
          const resolved = resolveRelative(absFile, specifier);
          if (isInside(target.neutralDir, resolved)) continue;
          violations.push({
            rule: 'R12-driver-isolation',
            file,
            reason: `"${target.neutralRel}" must be closed under relative imports, but "${specifier}" resolves outside it (to ${relative(target.packageDir, resolved).split('\\').join('/')}). A neutral core that reaches a sibling directory can transitively reach that sibling's driver dependencies, which is what makes an optional peer dependency accidentally required. Move the shared code into "${target.neutralRel}".`,
          });
          continue;
        }

        const pkg = packageNameOf(specifier);
        if (!target.optionalPeers.includes(pkg)) continue;
        violations.push({
          rule: 'R12-driver-isolation',
          file,
          reason: `"${target.neutralRel}" imports "${specifier}", but "${pkg}" is an optional peerDependency of @jini-ai/${target.packageDirName} — importing it from the neutral entry point makes it effectively required for every consumer, including ones that installed a different backend. Depend on a port declared in "${target.neutralRel}" and implement it in the driver directory instead.`,
        });
      }
    }
  }

  return violations;
}
