/**
 * R11: every static `import`/`export ... from` relative specifier in `packages/**\/src/**` must
 * carry an explicit file extension (typically `.js`, even for a `.ts`/`.tsx` source file — this
 * repo's established convention, e.g. `packages/renderers-react/src/registry.ts:15`'s
 * `from './types.js'`).
 *
 * **Why this needs a dedicated check.** `tsconfig.base.json` sets `"moduleResolution": "Bundler"`
 * repo-wide, which lets the typechecker accept a relative specifier with no extension at all
 * (`from './Icon'`). That resolves fine through a bundler (Vite, or Vitest's esbuild-backed
 * transform) but throws `ERR_MODULE_NOT_FOUND` under plain Node ESM — exactly what a real,
 * non-bundler consumer hits, and exactly what surfaced this: REF-001 Step C's hardened
 * packaging-verification check (pack the real tarball, actually `import()` it, not just
 * `require.resolve` it) tripped over `@jini-ai/ui`'s `Toast.js` reaching for `./Icon` with no
 * extension. Investigating found this was never `ui`-specific: `renderers-react` had the same gap
 * (11 sites) and it is architecturally repo-wide, since every package inherits the same base
 * tsconfig. Fixed 21 real sites (10 in `ui`, 11 in `renderers-react`) in the same change that adds
 * this check, so it cannot silently recur.
 *
 * **What this deliberately does NOT flag, and why — a false positive this check was built to
 * avoid, not just avoid by luck.** A naive text scan for `from '...'` anywhere in a file's raw
 * content also matches import-shaped syntax sitting inside a STRING LITERAL used as test input,
 * e.g. `packages/mcp/src/client/__tests__/client.test.ts`'s
 * `extractRelativeRefs("import x from './m.tsx'", 'a.tsx', '')` — a real hit during this
 * investigation's own repo-wide sweep (`m.tsx`/`m.ts` do not exist as files; confirmed with
 * `ls`). `stripComments` (shared with the other checks, see `lib/walk-imports.ts`) does not help
 * here — it deliberately preserves string-literal content verbatim, which is correct for its own
 * purpose (this codebase's convention of citing original import paths as porting provenance
 * inside comments) but does nothing for a string literal that merely *looks like* an import.
 *
 * The fix: anchor the match to the START OF A LINE (`^[ \t]*`, multiline). A real static
 * `import`/`export` declaration is, by the ES module spec, only legal at a module's top level —
 * it can never be nested inside an expression — and this codebase is Prettier-formatted, so every
 * real one begins a line with at most leading whitespace. The `mcp` fixture line begins with
 * `expect(extractRelativeRefs(...` — `import` appears mid-line, preceded by `("`, so the
 * line-start anchor excludes it correctly without needing to special-case this or any other file.
 *
 * (`check-chatpane-public-surface.ts`'s `NAMED_IMPORT_RE`/`NAMED_EXPORT_RE` and
 * `lib/walk-imports.ts`'s `FROM_IMPORT_RE` share this same latent false-positive class — neither
 * anchors to line start. Not fixed here: they're shared by R1/R2/R3/R10, and none of them happen
 * to scan a file containing an import-shaped test-input string today, so the risk is latent, not
 * live. Flagging for whoever next touches those regexes rather than widening this change's blast
 * radius into shared, already-relied-upon utilities.)
 *
 * **Scope limit (regex-MVP, matching this codebase's established convention — see
 * `lib/walk-imports.ts`'s own module doc):** only static `import ... from` / `export ... from`
 * declarations are checked. Bare side-effect imports (`import './x'`) and dynamic `import('./x')`
 * calls are not statement-anchored the same way and are out of scope for this pass — none of the
 * 21 real sites found were either form.
 *
 * **A second false positive, found by actually running this against the real repo before
 * trusting the "21" count: `packages/agent-runtime/src/skills/chat-motion-overlay/assets/
 * remotion-template/**`.** This is a vendored Remotion project template (it has its own
 * `package.json`, `tsconfig.json`, `remotion.config.ts`) — skill asset content that gets scaffolded
 * out and built independently by Remotion's own (webpack-based) tooling, never by this monorepo's
 * own `tsc`. `packages/agent-runtime/tsconfig.json` already excludes it
 * (`"exclude": ["src/craft/**", "src/skills/**"]`) for exactly this reason: it isn't part of what
 * `@jini-ai/agent-runtime` compiles or ships. Its extensionless imports are real, but they're not
 * this check's problem — Remotion's own bundler resolves them the same way Vite does for `ui`, so
 * there is no plain-Node-ESM consumer to break. **This check respects every package's own
 * `tsconfig.json` `exclude` list** (parsed once per package, simple `dir` / `dir/**` prefix
 * matching — the only two shapes any package's `exclude` array uses today) rather than
 * hardcoding this one path, so a future package with a similarly-vendored, separately-built
 * subtree is excluded by the same mechanism its own tsconfig already uses to keep it out of that
 * package's build, with no edit needed here.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { Violation } from './check-engine-boundaries.js';
import { listSourceFiles, REPO_ROOT } from './lib/walk-imports.js';

/**
 * `import`/`export`, optionally `type`-qualified, anchored to the start of a line (only leading
 * whitespace before the keyword) — see this file's module doc for why the anchor matters. The
 * clause between the keyword and `from` may span multiple lines (`[\s\S]*?`, non-greedy).
 */
const ANCHORED_FROM_IMPORT_RE = /^[ \t]*(?:import|export)\s+(?:type\s+)?[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/gm;

/** True if the specifier's final path segment already has a recognizable extension. */
function hasExtension(specifier: string): boolean {
  const lastSegment = specifier.split('/').pop() ?? '';
  const dotIndex = lastSegment.lastIndexOf('.');
  // A dot at position 0 (e.g. `.eslintrc`) or -1 (no dot at all) is not an extension.
  return dotIndex > 0;
}

function isRealFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * A package's own `tsconfig.json` `exclude` entries, read once per package. Every shape in use
 * today (checked across all of `packages/*\/tsconfig.json`) is either a bare directory
 * (`"src/dom"`) or a directory with a `/**` suffix (`"src/skills/**"`) — both mean "this
 * directory and everything under it," so both are handled by the same prefix check. No other
 * glob shape (mid-path wildcards, extension globs) appears anywhere in this repo's package
 * tsconfigs, so this deliberately doesn't implement general glob matching.
 */
function readTsconfigExcludes(packageDir: string): string[] {
  const tsconfigPath = join(packageDir, 'tsconfig.json');
  if (!isRealFile(tsconfigPath)) return [];
  try {
    // tsconfig.json permits `//` comments, which JSON.parse rejects — strip them first. Safe here
    // because none of this repo's tsconfig `exclude` values could contain `//` as real content.
    const stripped = readFileSync(tsconfigPath, 'utf8').replace(/\/\/[^\n]*/g, '');
    const parsed: unknown = JSON.parse(stripped);
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { exclude?: unknown }).exclude)) {
      return (parsed as { exclude: unknown[] }).exclude.filter((e): e is string => typeof e === 'string');
    }
  } catch {
    // Malformed tsconfig is a different check's problem (or would fail `tsc` outright) — this
    // check fails open (scans everything) rather than silencing itself over a parse error.
  }
  return [];
}

/** True if `relPathWithinPackage` (forward-slashed, relative to the package root) falls under
 * one of `excludes`' directories — `"src/skills"` and `"src/skills/**"` both match
 * `"src/skills/foo/bar.ts"` and `"src/skills"` itself, but not `"src/skills-other/x.ts"`. */
function isExcluded(relPathWithinPackage: string, excludes: readonly string[]): boolean {
  return excludes.some((raw) => {
    const dir = raw.endsWith('/**') ? raw.slice(0, -3) : raw;
    return relPathWithinPackage === dir || relPathWithinPackage.startsWith(`${dir}/`);
  });
}

export interface CheckExtensionlessImportsOptions {
  /** Treat this directory as the repo root. Defaults to the real repo root. */
  readonly repoRoot?: string;
  /** Treat this directory as the `packages/` root to scan. Defaults to `<repoRoot>/packages`. */
  readonly packagesDir?: string;
}

export async function checkExtensionlessImports(
  options: CheckExtensionlessImportsOptions = {},
): Promise<Violation[]> {
  const root = options.repoRoot ?? REPO_ROOT;
  const packagesDir = options.packagesDir ?? join(root, 'packages');
  const violations: Violation[] = [];

  let packageDirNames: string[];
  try {
    packageDirNames = readdirSync(packagesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return violations;
  }

  for (const pkgName of packageDirNames) {
    const packageDir = join(packagesDir, pkgName);
    const excludes = readTsconfigExcludes(packageDir);

    for (const absFile of listSourceFiles(packageDir)) {
      const relInPackage = relative(packageDir, absFile).split('\\').join('/');
      if (isExcluded(relInPackage, excludes)) continue;

      const file = relative(root, absFile).split('\\').join('/');
      const content = readFileSync(absFile, 'utf8');

      for (const m of content.matchAll(ANCHORED_FROM_IMPORT_RE)) {
        const specifier = m[1]!;
        // Only relative specifiers are in scope — bare package specifiers (`@jini-ai/x`, `react`)
        // resolve through `node_modules`/`exports` and don't take this extension rule at all.
        if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
        if (hasExtension(specifier)) continue;

        // Best-effort hint for the fix: does the specifier name an existing `.ts`/`.tsx` sibling
        // file (meaning `.js` is the right append), or a directory with its own `index` (meaning
        // `/index.js` is needed instead)? Advisory only — the violation fires either way.
        const resolvedBase = resolve(dirname(absFile), specifier);
        const looksLikeDirectory =
          !isRealFile(`${resolvedBase}.ts`) &&
          !isRealFile(`${resolvedBase}.tsx`) &&
          (isRealFile(join(resolvedBase, 'index.ts')) || isRealFile(join(resolvedBase, 'index.tsx')));

        violations.push({
          rule: 'R11-extensionless-import',
          file,
          reason: `relative import "${specifier}" has no file extension — plain Node ESM requires one (this codebase's convention is "${specifier}.js" even for a .ts/.tsx source file${looksLikeDirectory ? `; this one looks like a directory, so "${specifier}/index.js" instead` : ''})`,
        });
      }
    }
  }

  return violations;
}
