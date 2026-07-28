/**
 * R1: packages/@injini/** must not import foundry/**, examples/**, or AI-Dev-Shop/**.
 * R2: engine packages import each other only by package name (no deep paths) — a relative
 *     import must not escape its own package's `src/`, and a bare `@injini/<name>/<subpath>`
 *     import is forbidden except two specifically-gated subpaths: `@injini/core/internal` and
 *     `@injini/agentic/dom` (the browser half of `@injini/agentic`'s deliberate two-entry-point
 *     split — see `packages/agentic/source-map.md`). Both are exact-literal exceptions, not a
 *     pattern; a third package wanting a second entry point needs its own named exception here.
 * R5: no product-identity strings in packages/@injini/**.
 * R6: `getToolRegistration` (a runtime *value*, not `import type`) may only be imported from
 *     `@injini/core/internal` inside `packages/daemon/**` — closes the tool-handler-authz-bypass
 *     leak found in the 2026-07-19 swarm-consensus debate (Codex GPT-5.6-sol, confirmed by
 *     Gemini/Opus). Type-only imports of that subpath (e.g. `node-host`'s `AnyPack`) are
 *     unrestricted — they carry no runtime capability.
 * R7: removed 2026-07-28 at the user's explicit direction — it blocked a locked package from
 *     importing a package listed in `UNLOCKED.md` unless that entry's `status` was `"stable"`.
 *     The tiered locked/incubating/admitted admission gate this enforced (and the "23 packages
 *     vs. the locked 14" framing behind it, from the 2026-07-19 swarm-consensus debate) is gone;
 *     `UNLOCKED.md` is now a historical record, not an enforced manifest. See that file's own
 *     header for the removal note.
 * R8: every workspace package must declare canonical `jini` classification metadata in its
 *     package.json. This keeps packages physically flat while making the conceptual domain/
 *     runtime grouping machine-readable. `jini.admission` is no longer required or validated —
 *     removed alongside R7 above.
 *     Extension (2026-07-26, `@injini/agentic`'s two-entry-point split): an optional
 *     `jini.entries` map gives a per-export-subpath `runtime` override for the rare package
 *     whose single top-level `runtime` can't describe every subpath — e.g.
 *     `{".": "universal", "./dom": "browser"}`. When present, every key must name a real
 *     `exports` subpath and every `exports` subpath must have a matching key (mismatches in
 *     either direction are exactly the drift worth catching: a typo'd subpath, or a new export
 *     added without recording its runtime), and `entries["."]`, if set, must agree with the
 *     top-level `runtime` field. Absent for every other package — this is opt-in and does not
 *     require editing any package that doesn't need it. See `packages/README.md`.
 *
 * Deliberately a regex-based MVP over `scripts/lib/walk-imports.ts`, not a full
 * `ts.resolveModuleName` AST pass — per the debate's own convergence that this is sufficient
 * for v0. See foundry/docs/jini-port/extraction-plan.md §7 (guardrails) and §12 C-series.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { extractImports, listSourceFiles, REPO_ROOT, stripComments } from './lib/walk-imports.js';

export type Violation = { rule: string; file: string; reason: string };

const FORBIDDEN_TOP_LEVEL_DIRS = ['foundry', 'examples', 'AI-Dev-Shop'];

const PRODUCT_IDENTITY_STRINGS = [
  'Open Design',
  '--od-stamp',
  '/tmp/open-design',
  'opendesign.app',
  'od://',
];
/** Matched separately (word-boundary) to avoid false positives on identifiers like `MOD_FOO`. */
const OD_PREFIX_RE = /\bOD_[A-Z0-9_]*/;

const PACKAGE_DOMAINS = new Set([
  'engine',
  'agent',
  'server',
  'platform',
  'chat',
  'ui',
  'capability',
  'integration',
  'tooling',
]);
const PACKAGE_RUNTIMES = new Set(['universal', 'node', 'browser', 'desktop']);

interface JiniPackageMetadata {
  readonly domain: string;
  readonly kind: string;
  readonly runtime: string;
  /**
   * Optional per-entry-point runtime override, e.g. `{".": "universal", "./dom": "browser"}` —
   * for the rare package (currently only `@injini/agentic`) whose single top-level `runtime`
   * cannot describe every subpath in its `exports` map. `null` when the package doesn't set it,
   * which is the overwhelming majority — `entries` is opt-in precisely so no existing package
   * needs to be touched to keep validating cleanly (see `packages/README.md`).
   */
  readonly entries: Readonly<Record<string, string>> | null;
}

interface PackageRecord {
  readonly directory: string;
  readonly packageName: string;
  readonly metadata: JiniPackageMetadata | null;
}

function packageNameOf(repoRelPath: string): string | null {
  const m = /^packages\/([^/]+)\//.exec(repoRelPath);
  return m ? m[1]! : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates the optional `jini.entries` extension (R8, see this file's module doc) and returns
 * the parsed map, or `null` when the package doesn't set it. Pushes a violation for every: key
 * that isn't a real `exports` subpath, `exports` subpath missing a key, invalid runtime value,
 * or disagreement between `entries["."]` and the top-level `runtime` field.
 */
function resolveJiniEntries(
  rawEntries: unknown,
  rawExports: unknown,
  runtime: string,
  file: string,
  violations: Violation[],
): Readonly<Record<string, string>> | null {
  if (rawEntries === undefined) return null;

  if (!isRecord(rawEntries)) {
    violations.push({
      rule: 'R8-package-metadata',
      file,
      reason: 'jini.entries must be an object mapping export subpaths to runtimes',
    });
    return null;
  }

  const exportKeys = isRecord(rawExports) ? new Set(Object.keys(rawExports)) : new Set<string>();
  const entries: Record<string, string> = {};

  for (const [subpath, value] of Object.entries(rawEntries)) {
    if (typeof value !== 'string' || !PACKAGE_RUNTIMES.has(value)) {
      violations.push({
        rule: 'R8-package-metadata',
        file,
        reason: `invalid jini.entries[${JSON.stringify(subpath)}] runtime ${JSON.stringify(value)}`,
      });
      continue;
    }
    entries[subpath] = value;
    if (!exportKeys.has(subpath)) {
      violations.push({
        rule: 'R8-package-metadata',
        file,
        reason: `jini.entries[${JSON.stringify(subpath)}] has no matching "exports" subpath — entries must name real export paths`,
      });
    }
  }

  for (const exportKey of exportKeys) {
    if (!(exportKey in rawEntries)) {
      violations.push({
        rule: 'R8-package-metadata',
        file,
        reason: `"exports" subpath ${JSON.stringify(exportKey)} has no matching jini.entries key — a package that declares per-entry runtimes must cover every export`,
      });
    }
  }

  if (entries['.'] !== undefined && entries['.'] !== runtime) {
    violations.push({
      rule: 'R8-package-metadata',
      file,
      reason: `jini.entries["."] (${JSON.stringify(entries['.'])}) disagrees with jini.runtime (${JSON.stringify(runtime)}) — the root entry's runtime must match the top-level field`,
    });
  }

  return entries;
}

/**
 * Which of `candidates` (directory names directly under `packages/`) git ignores.
 *
 * R8 must skip these. Tool output occasionally lands inside `packages/` — a `graphify update` run
 * launched without `GRAPHIFY_OUT` writes a whole `packages/graphify-out/` tree (observed
 * 2026-07-27; its `.graphify_root` marker read `.` instead of the repo path). That directory is
 * build output, is matched by the `graphify-out/` rule in `.gitignore`, and is not a package — but
 * R8 saw a directory with no `package.json` and failed the whole guard run.
 *
 * Delegates to `git check-ignore` rather than parsing `.gitignore`, so the answer matches git
 * exactly — negations, nested ignore files, `core.excludesFile`, all of it.
 *
 * **Fails open by design.** No git binary, not a repo, or any unexpected error yields an empty set,
 * which means every directory is checked exactly as before. The dangerous direction here is
 * skipping a real package, so an unreadable ignore state must never silence a check.
 */
function gitIgnoredDirectories(packagesDir: string, candidates: readonly string[]): Set<string> {
  if (candidates.length === 0) return new Set();
  try {
    const stdout = execFileSync('git', ['check-ignore', '--stdin'], {
      cwd: packagesDir,
      input: candidates.join('\n'),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return new Set(stdout.split('\n').map((line) => line.trim()).filter(Boolean));
  } catch {
    // `git check-ignore` exits 1 to mean "none of these are ignored" — a real answer, and one whose
    // correct result is the same empty set every other failure mode produces.
    return new Set();
  }
}

function loadPackageRecords(
  root: string,
  packagesDir: string,
  violations: Violation[],
): Map<string, PackageRecord> {
  const records = new Map<string, PackageRecord>();

  const directories = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const ignored = gitIgnoredDirectories(packagesDir, directories);

  for (const directory of directories) {
    if (ignored.has(directory)) continue;

    const manifestPath = join(packagesDir, directory, 'package.json');
    const file = relative(root, manifestPath).split('\\').join('/');
    const packageName = `@injini/${directory}`;

    if (!existsSync(manifestPath)) {
      violations.push({
        rule: 'R8-package-metadata',
        file,
        reason: `package directory "${directory}" is missing package.json`,
      });
      records.set(directory, { directory, packageName, metadata: null });
      continue;
    }

    let manifest: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (!isRecord(parsed)) throw new Error('root value is not an object');
      manifest = parsed;
    } catch (error) {
      violations.push({
        rule: 'R8-package-metadata',
        file,
        reason: `invalid package.json: ${error instanceof Error ? error.message : String(error)}`,
      });
      records.set(directory, { directory, packageName, metadata: null });
      continue;
    }

    if (manifest.name !== packageName) {
      violations.push({
        rule: 'R8-package-metadata',
        file,
        reason: `package name must be "${packageName}" (found ${JSON.stringify(manifest.name)})`,
      });
    }

    const rawMetadata = manifest.jini;
    if (!isRecord(rawMetadata)) {
      violations.push({
        rule: 'R8-package-metadata',
        file,
        reason: 'missing canonical jini metadata (domain, kind, runtime)',
      });
      records.set(directory, { directory, packageName, metadata: null });
      continue;
    }

    const runtime = typeof rawMetadata.runtime === 'string' ? rawMetadata.runtime : '';
    const entries = resolveJiniEntries(rawMetadata.entries, manifest.exports, runtime, file, violations);

    const metadata: JiniPackageMetadata = {
      domain: typeof rawMetadata.domain === 'string' ? rawMetadata.domain : '',
      kind: typeof rawMetadata.kind === 'string' ? rawMetadata.kind : '',
      runtime,
      entries,
    };

    if (!PACKAGE_DOMAINS.has(metadata.domain)) {
      violations.push({
        rule: 'R8-package-metadata',
        file,
        reason: `invalid jini.domain ${JSON.stringify(rawMetadata.domain)}`,
      });
    }
    if (metadata.kind.trim().length === 0) {
      violations.push({
        rule: 'R8-package-metadata',
        file,
        reason: 'jini.kind must be a non-empty string',
      });
    }
    if (!PACKAGE_RUNTIMES.has(metadata.runtime)) {
      violations.push({
        rule: 'R8-package-metadata',
        file,
        reason: `invalid jini.runtime ${JSON.stringify(rawMetadata.runtime)}`,
      });
    }

    records.set(directory, { directory, packageName, metadata });
  }

  return records;
}

export interface CheckEngineBoundariesOptions {
  /** Treat this directory as the repo root for both scanning and path classification. */
  readonly repoRoot?: string;
  /** Treat this directory as the packages/ root. Defaults to `<repoRoot>/packages`. */
  readonly packagesDir?: string;
}

/**
 * @param options Overrides so `scripts/lib/self-test.ts` can run this exact function against
 * known-bad fixtures in a temp directory and prove it still detects them, instead of trusting
 * that the implementation hasn't silently regressed to a no-op (the failure mode this whole
 * check was built to fix).
 */
export async function checkEngineBoundaries(
  options: CheckEngineBoundariesOptions = {},
): Promise<Violation[]> {
  const root = options.repoRoot ?? REPO_ROOT;
  const violations: Violation[] = [];
  const packagesDir = options.packagesDir ?? join(root, 'packages');
  const files = listSourceFiles(packagesDir);
  const packageRecords = loadPackageRecords(root, packagesDir, violations);

  for (const absFile of files) {
    const file = relative(root, absFile).split('\\').join('/');
    const ownPackage = packageNameOf(file);
    // Comment-stripped so module-doc provenance citations (e.g. "the OD_DATA_DIR env var name
    // ... was removed") don't get flagged as a live violation — see stripComments's doc.
    const content = stripComments(readFileSync(absFile, 'utf8'));

    // R5: product-identity strings.
    for (const needle of PRODUCT_IDENTITY_STRINGS) {
      if (content.includes(needle)) {
        violations.push({ rule: 'R5-neutrality', file, reason: `product-identity string "${needle}"` });
      }
    }
    if (OD_PREFIX_RE.test(content)) {
      const match = OD_PREFIX_RE.exec(content);
      violations.push({
        rule: 'R5-neutrality',
        file,
        reason: `product-identity prefix "${match ? match[0] : 'OD_'}"`,
      });
    }

    for (const ref of extractImports(absFile)) {
      const spec = ref.specifier;

      if (spec.startsWith('.')) {
        // R1 / R2: resolve the relative import and classify where it lands.
        const resolvedAbs = resolve(dirname(absFile), spec);
        const resolvedRel = relative(root, resolvedAbs).split('\\').join('/');
        const topSegment = resolvedRel.split('/')[0] ?? '';

        if (FORBIDDEN_TOP_LEVEL_DIRS.includes(topSegment)) {
          violations.push({ rule: 'R1-boundary', file, reason: `relative import "${spec}" resolves into ${topSegment}/` });
          continue;
        }
        if (topSegment === 'packages') {
          const targetPackage = packageNameOf(resolvedRel);
          if (targetPackage && ownPackage && targetPackage !== ownPackage) {
            violations.push({
              rule: 'R2-deep-path',
              file,
              reason: `relative import "${spec}" reaches into another package's src (${targetPackage}) — import by package name instead`,
            });
          }
        }
        continue;
      }

      if (spec.startsWith('@injini/')) {
        const withoutScope = spec.slice('@injini/'.length);
        const slashIdx = withoutScope.indexOf('/');
        const targetPackage = slashIdx === -1 ? withoutScope : withoutScope.slice(0, slashIdx);
        const targetPackageName = `@injini/${targetPackage}`;
        const subpath = slashIdx === -1 ? null : withoutScope.slice(slashIdx + 1);

        if (subpath !== null) {
          if (spec === '@injini/core/internal') {
            // R6: only a VALUE import of getToolRegistration from outside @injini/daemon is a leak.
            // Type-only imports (node-host's AnyPack/MissingTokenIds) are unrestricted.
            if (!ref.typeOnly && ownPackage !== 'daemon') {
              violations.push({
                rule: 'R6-internal-leak',
                file,
                reason: 'value import of @injini/core/internal outside packages/daemon — bypasses the ToolExecutor authz gate',
              });
            }
          } else if (spec === '@injini/agentic/dom') {
            // R2 exception #2 (2026-07-26 extraction): @injini/agentic ships two entry points on
            // purpose — a DOM-free root and a browser-only "./dom" half, split across two
            // tsconfigs so the root's DOM-free guarantee stays compile-time (see
            // packages/agentic/source-map.md's "The DOM split"). @injini/chat-react genuinely needs
            // the DOM half (createDomPageDriver) and there is no third package for it to live in
            // without adding to the sprawl this rule exists to bound. Gated to this exact literal,
            // not a pattern — no other package's subpath is exempted by this branch.
          } else {
            violations.push({
              rule: 'R2-deep-path',
              file,
              reason: `deep-path import "${spec}" — only bare "@injini/${targetPackage}" (or the gated @injini/core/internal / @injini/agentic/dom) is allowed`,
            });
          }
        }

      }
    }
  }

  return violations;
}
