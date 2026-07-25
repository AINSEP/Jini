/**
 * R1: packages/@jini/** must not import foundry/**, examples/**, or AI-Dev-Shop/**.
 * R2: engine packages import each other only by package name (no deep paths) — a relative
 *     import must not escape its own package's `src/`, and a bare `@jini/<name>/<subpath>`
 *     import is forbidden except the specifically-gated `@jini/core/internal` subpath.
 * R5: no product-identity strings in packages/@jini/**.
 * R6: `getToolRegistration` (a runtime *value*, not `import type`) may only be imported from
 *     `@jini/core/internal` inside `packages/daemon/**` — closes the tool-handler-authz-bypass
 *     leak found in the 2026-07-19 swarm-consensus debate (Codex GPT-5.6-sol, confirmed by
 *     Gemini/Opus). Type-only imports of that subpath (e.g. `node-host`'s `AnyPack`) are
 *     unrestricted — they carry no runtime capability.
 * R7: a locked package (extraction-plan.md §3's fourteen) may not import a package listed in
 *     `UNLOCKED.md` unless that entry's `status` is `"stable"` — contains package-sprawl found
 *     in the same debate (23 packages vs. the locked 14).
 * R8: every workspace package must declare canonical `jini` classification metadata in its
 *     package.json, and its admission state must agree with `UNLOCKED.md`. This keeps packages
 *     physically flat while making the conceptual domain/runtime grouping machine-readable.
 *
 * Deliberately a regex-based MVP over `scripts/lib/walk-imports.ts`, not a full
 * `ts.resolveModuleName` AST pass — per the debate's own convergence that this is sufficient
 * for v0. See foundry/docs/jini-port/extraction-plan.md §7 (guardrails) and §12 C-series.
 */
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
const PACKAGE_ADMISSIONS = new Set(['locked', 'incubating', 'admitted']);

interface JiniPackageMetadata {
  readonly domain: string;
  readonly kind: string;
  readonly runtime: string;
  readonly admission: string;
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

function loadUnlockedManifest(root: string): Record<string, { status: string }> {
  try {
    const raw = readFileSync(join(root, 'UNLOCKED.md'), 'utf8');
    const fenced = /```json\s*([\s\S]*?)```/.exec(raw);
    if (!fenced) return {};
    return JSON.parse(fenced[1]!);
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadPackageRecords(
  root: string,
  packagesDir: string,
  unlocked: Record<string, { status: string }>,
  violations: Violation[],
): Map<string, PackageRecord> {
  const records = new Map<string, PackageRecord>();

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const directory = entry.name;
    const manifestPath = join(packagesDir, directory, 'package.json');
    const file = relative(root, manifestPath).split('\\').join('/');
    const packageName = `@jini/${directory}`;

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
        reason: 'missing canonical jini metadata (domain, kind, runtime, admission)',
      });
      records.set(directory, { directory, packageName, metadata: null });
      continue;
    }

    const metadata: JiniPackageMetadata = {
      domain: typeof rawMetadata.domain === 'string' ? rawMetadata.domain : '',
      kind: typeof rawMetadata.kind === 'string' ? rawMetadata.kind : '',
      runtime: typeof rawMetadata.runtime === 'string' ? rawMetadata.runtime : '',
      admission: typeof rawMetadata.admission === 'string' ? rawMetadata.admission : '',
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
    if (!PACKAGE_ADMISSIONS.has(metadata.admission)) {
      violations.push({
        rule: 'R8-package-metadata',
        file,
        reason: `invalid jini.admission ${JSON.stringify(rawMetadata.admission)}`,
      });
    }

    const unlockedStatus = unlocked[packageName]?.status;
    const expectedAdmission =
      unlockedStatus === 'incubating' ? 'incubating' : unlockedStatus === 'stable' ? 'admitted' : 'locked';
    if (metadata.admission !== expectedAdmission) {
      violations.push({
        rule: 'R8-package-metadata',
        file,
        reason: `jini.admission "${metadata.admission}" disagrees with UNLOCKED.md (expected "${expectedAdmission}")`,
      });
    }

    records.set(directory, { directory, packageName, metadata });
  }

  for (const packageName of Object.keys(unlocked)) {
    const directory = packageName.startsWith('@jini/') ? packageName.slice('@jini/'.length) : '';
    if (!directory || !records.has(directory)) {
      violations.push({
        rule: 'R8-package-metadata',
        file: 'UNLOCKED.md',
        reason: `admission entry "${packageName}" does not resolve to a workspace package`,
      });
    }
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
  const unlocked = loadUnlockedManifest(root);
  const packageRecords = loadPackageRecords(root, packagesDir, unlocked, violations);

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

      if (spec.startsWith('@jini/')) {
        const withoutScope = spec.slice('@jini/'.length);
        const slashIdx = withoutScope.indexOf('/');
        const targetPackage = slashIdx === -1 ? withoutScope : withoutScope.slice(0, slashIdx);
        const targetPackageName = `@jini/${targetPackage}`;
        const subpath = slashIdx === -1 ? null : withoutScope.slice(slashIdx + 1);

        if (subpath !== null) {
          if (spec === '@jini/core/internal') {
            // R6: only a VALUE import of getToolRegistration from outside @jini/daemon is a leak.
            // Type-only imports (node-host's AnyPack/MissingTokenIds) are unrestricted.
            if (!ref.typeOnly && ownPackage !== 'daemon') {
              violations.push({
                rule: 'R6-internal-leak',
                file,
                reason: 'value import of @jini/core/internal outside packages/daemon — bypasses the ToolExecutor authz gate',
              });
            }
          } else {
            violations.push({
              rule: 'R2-deep-path',
              file,
              reason: `deep-path import "${spec}" — only bare "@jini/${targetPackage}" (or the gated @jini/core/internal) is allowed`,
            });
          }
        }

        // R7: an admitted/locked package may not point down into an incubating package.
        // Package admission now comes from package.json rather than a duplicated hard-coded set.
        const sourceAdmission = ownPackage
          ? packageRecords.get(ownPackage)?.metadata?.admission
          : undefined;
        const targetAdmission = packageRecords.get(targetPackage)?.metadata?.admission;
        if (
          sourceAdmission !== undefined &&
          sourceAdmission !== 'incubating' &&
          targetAdmission === 'incubating'
        ) {
            violations.push({
              rule: 'R7-sprawl',
              file,
              reason: `${sourceAdmission} package "@jini/${ownPackage}" imports incubating package "${targetPackageName}"`,
            });
        }
      }
    }
  }

  return violations;
}
