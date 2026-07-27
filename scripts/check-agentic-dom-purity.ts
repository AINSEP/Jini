/**
 * R9: `@jini/agentic`'s DOM-free guarantee is compile-time, not conventional — see
 * `packages/agentic/source-map.md`'s "The DOM split". `packages/agentic/tsconfig.json` (the root
 * entry, `.`) excludes `src/dom` and resolves to a DOM-free `lib`; only
 * `packages/agentic/tsconfig.dom.json` (the `./dom` entry) resolves a DOM `lib`, and it is scoped
 * to `src/dom/**` only. Given that, a `document`/`window` reference anywhere outside `src/dom/**`
 * already fails `tsc -p tsconfig.json` with TS2584 — manually verified for this extraction:
 * `tsc --noEmit --strict --lib ES2023 <file with 'document.title'>` exits 2 with
 * `error TS2584: Cannot find name 'document'...`, while the same file compiles clean under
 * `--lib ES2023,DOM,DOM.Iterable`. That per-file guarantee is real and the compiler already
 * enforces it better than any regex this repo could write — so this check does not scan source.
 *
 * What is NOT protected is the CONFIGURATION that produces that guarantee. If `tsconfig.json`'s
 * `exclude` is ever narrowed to stop excluding `src/dom`, or a DOM lib quietly leaks into the root
 * config, or `tsconfig.dom.json`'s `include` widens beyond `src/dom` (so it starts compiling
 * universal code with a DOM lib in scope), the guarantee evaporates silently — no source file
 * changed, so no source-level scan would ever flag it. This check reads the two real config files
 * (resolving one level of `extends`, matching this repo's `tsconfig.base.json -> package
 * tsconfig.json` shape) and asserts:
 *   - the root config's `exclude` still contains an entry that resolves to `src/dom`;
 *   - the root config's effective `lib` still contains no DOM entry;
 *   - the DOM config's `include` still resolves to `src/dom` (or a path nested under it) only —
 *     never `src` or the package root;
 *   - the DOM config's effective `lib` still contains a DOM entry (if this regressed,
 *     `src/dom/dom-page-driver.ts` itself would fail to compile — `pnpm typecheck` already catches
 *     that, but stating it here documents why the split is coherent in both directions, not just
 *     the direction this check exists to protect).
 *
 * Deliberately config-only — no `tsc` subprocess in the steady-state check, matching
 * `check-engine-boundaries.ts`/`check-protocol-purity.ts`'s documented cost profile (fast,
 * deterministic, zero process spawn). `tsc`'s *behaviour* given a correct `lib`/`exclude` pair is
 * a property of the compiler, not of this codebase, and does not regress independent of the
 * configuration drift this check already catches — proven once by hand (see this file's own
 * module doc above) rather than re-spawning `tsc` on every `pnpm guard` run.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { Violation } from './check-engine-boundaries.js';
import { REPO_ROOT } from './lib/walk-imports.js';

const DOM_SUBDIR = 'src/dom';

interface RawTsconfig {
  readonly extends?: string | readonly string[];
  readonly compilerOptions?: Record<string, unknown>;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

function readTsconfig(absPath: string): RawTsconfig {
  const parsed: unknown = JSON.parse(readFileSync(absPath, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  return parsed as RawTsconfig;
}

/**
 * Resolves the effective `compilerOptions` for a tsconfig by walking its `extends` chain and
 * shallow-merging each level's `compilerOptions` on top of its base's (later/leaf keys win) —
 * this matches `tsc`'s real extends semantics for array-valued options like `lib`: a leaf that
 * sets its own `lib` replaces the base's wholesale rather than appending to it, which is exactly
 * what a plain object spread gives for free.
 */
function resolveCompilerOptions(absConfigPath: string, seen: Set<string> = new Set()): Record<string, unknown> {
  if (seen.has(absConfigPath)) return {};
  seen.add(absConfigPath);
  if (!existsSync(absConfigPath)) return {};

  const raw = readTsconfig(absConfigPath);
  const extendsList = raw.extends === undefined ? [] : Array.isArray(raw.extends) ? raw.extends : [raw.extends];

  let merged: Record<string, unknown> = {};
  for (const ext of extendsList) {
    const extAbs = resolve(dirname(absConfigPath), ext);
    merged = { ...merged, ...resolveCompilerOptions(extAbs, seen) };
  }
  return { ...merged, ...(raw.compilerOptions ?? {}) };
}

/** Strips a trailing glob segment (`/**`, `/*`) and any trailing slash so `src/dom/**` and
 * `src/dom` compare equal to the bare path `src/dom`. */
function normalizeGlob(entry: string): string {
  return entry.replace(/\/\*\*$/, '').replace(/\/\*$/, '').replace(/\/$/, '');
}

function hasDomLibEntry(lib: readonly string[]): boolean {
  return lib.some((entry) => /dom/i.test(entry));
}

export interface CheckAgenticDomPurityOptions {
  /** Treat this directory as the repo root for path classification. */
  readonly repoRoot?: string;
  /** Treat this directory as `@jini/agentic`'s package root. Defaults to `<repoRoot>/packages/agentic`. */
  readonly agenticDir?: string;
}

/**
 * @param options Overrides so `scripts/lib/self-test.ts` can run this exact function against
 * known-bad fixture tsconfig pairs and prove it still detects them, instead of trusting that the
 * implementation hasn't silently regressed to a no-op.
 */
export async function checkAgenticDomPurity(options: CheckAgenticDomPurityOptions = {}): Promise<Violation[]> {
  const root = options.repoRoot ?? REPO_ROOT;
  const agenticDir = options.agenticDir ?? join(root, 'packages', 'agentic');
  const violations: Violation[] = [];

  const rootConfigAbs = join(agenticDir, 'tsconfig.json');
  const domConfigAbs = join(agenticDir, 'tsconfig.dom.json');
  const rootFile = relative(root, rootConfigAbs).split('\\').join('/');
  const domFile = relative(root, domConfigAbs).split('\\').join('/');

  if (!existsSync(rootConfigAbs) || !existsSync(domConfigAbs)) {
    violations.push({
      rule: 'R9-dom-purity',
      file: relative(root, agenticDir).split('\\').join('/'),
      reason: 'expected both tsconfig.json (DOM-free root) and tsconfig.dom.json (browser-only ./dom) — the DOM split this check protects requires both to exist',
    });
    return violations;
  }

  const rootRaw = readTsconfig(rootConfigAbs);
  const domRaw = readTsconfig(domConfigAbs);
  const rootOptions = resolveCompilerOptions(rootConfigAbs);
  const domOptions = resolveCompilerOptions(domConfigAbs);

  const rootLib = Array.isArray(rootOptions.lib) ? rootOptions.lib.map(String) : [];
  const domLib = Array.isArray(domOptions.lib) ? domOptions.lib.map(String) : [];

  if (hasDomLibEntry(rootLib)) {
    violations.push({
      rule: 'R9-dom-purity',
      file: rootFile,
      reason: `effective "lib" (${JSON.stringify(rootLib)}) now includes a DOM entry — the root entry point must resolve to a DOM-free lib so a document/window reference cannot compile outside src/dom`,
    });
  }

  const rootExclude = (rootRaw.exclude ?? []).map(normalizeGlob);
  if (!rootExclude.includes(DOM_SUBDIR)) {
    violations.push({
      rule: 'R9-dom-purity',
      file: rootFile,
      reason: `"exclude" (${JSON.stringify(rootRaw.exclude ?? [])}) no longer excludes "${DOM_SUBDIR}" — the DOM-bearing code could be pulled into the DOM-free compile`,
    });
  }

  const domInclude = (domRaw.include ?? []).map(normalizeGlob);
  const coversOnlyDom =
    domInclude.length > 0 &&
    domInclude.every((entry) => entry === DOM_SUBDIR || entry.startsWith(`${DOM_SUBDIR}/`));
  if (!coversOnlyDom) {
    violations.push({
      rule: 'R9-dom-purity',
      file: domFile,
      reason: `"include" (${JSON.stringify(domRaw.include ?? [])}) covers more than "${DOM_SUBDIR}" — the DOM-bearing config must not compile universal code with a DOM lib in scope`,
    });
  }

  if (!hasDomLibEntry(domLib)) {
    violations.push({
      rule: 'R9-dom-purity',
      file: domFile,
      reason: `effective "lib" (${JSON.stringify(domLib)}) no longer includes a DOM entry — src/dom would fail to compile, which would defeat the split rather than protect it`,
    });
  }

  return violations;
}
