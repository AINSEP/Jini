/** Hardwiring audit ratchet. Run directly without executing guard.ts's self-test suite. */
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { runHardwiring } from '../packages/devops/src/checks/hardwiring-node.js';
import { createHardwiringInspector, diffHardwiringDebt, HARDWIRING_RULES } from '../packages/devops/src/checks/hardwiring.js';
import type { HardwiringViolation } from '../packages/devops/src/checks/hardwiring.js';
import { sourcePackages, packageSourceFiles } from './lib/package-sources.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const debtPath = join(root, 'scripts/hardwiring-debt.json');

function pluginIdentity(file: string): string | undefined {
  return file.replaceAll('\\', '/').match(/(?:^|\/)packages\/(agent-plugins|plugins)(?:\/|$)/)?.[1];
}

/** Scan actual package source, including nested packages; no builds, imports of production code or network. */
export function collectHardwiring(required: { repoRoot: string }, _options: Record<string, never> = {}): HardwiringViolation[] {
  const inspector = createHardwiringInspector({ compiler: ts });
  const violations: HardwiringViolation[] = [];
  for (const pkg of sourcePackages({ packagesDir: join(required.repoRoot, 'packages') })) {
    const manifest = pkg.manifest as typeof pkg.manifest & { jini?: { runtime?: string } };
    const server = manifest.jini?.runtime !== 'browser' && manifest.jini?.runtime !== 'dom';
    for (const file of packageSourceFiles({ directory: pkg.directory }, { includeJavaScript: true })) {
      if (!/\.[cm]?[jt]sx?$/.test(file) || file.endsWith('.d.ts')) continue;
      violations.push(...inspector.inspect({ file: relative(required.repoRoot, file).replaceAll('\\', '/'), source: readFileSync(file, 'utf8'), mode: 'jini', server,
        pluginIdentity,
        resolveImport: (specifier) => {
          const pluginPackage = specifier.match(/^@jini-ai\/(agent-plugins|plugins)(?:\/|$)/)?.[1];
          if (pluginPackage) return `packages/${pluginPackage}`;
          return specifier.startsWith('.') ? resolve(dirname(file), specifier) : undefined;
        },
      }));
    }
  }
  return violations;
}

/** Existing guard aggregators receive only new debt; all old occurrences remain visible in JSON/counts. */
export function checkHardwiring(required: { repoRoot: string } = { repoRoot: root }, _options: Record<string, never> = {}): HardwiringViolation[] {
  const current = collectHardwiring(required);
  const baseline = JSON.parse(readFileSync(join(required.repoRoot, 'scripts/hardwiring-debt.json'), 'utf8')) as { violations: HardwiringViolation[] };
  const diff = diffHardwiringDebt({ baseline: baseline.violations, current });
  for (const rule of HARDWIRING_RULES) console.log(`[hardwiring] ${rule}: ${current.filter((v) => v.rule === rule).length} total; ${diff.added.filter((v) => v.rule === rule).length} new`);
  if (diff.removed.length) console.log(`[hardwiring] ${diff.removed.length} stale debt occurrences; remove them from scripts/hardwiring-debt.json.`);
  return diff.added;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // This script runs in the workspace's CommonJS context; keep async CLI settlement off top-level await.
  void runHardwiring({ collect: () => collectHardwiring({ repoRoot: root }), debtPath,
      baselineComment: '2026-10-09 hardwiring adoption. Identifying-value occurrence hashes. Shrink after cleanup; never regenerate in CI.' },
    { writeBaseline: process.argv.includes('--write-baseline') }).then(added => {
    if (added.length) process.exitCode = 1;
  }).catch(error => {
    console.error(`[hardwiring] ${error instanceof Error ? error.message : 'Hardwiring audit failed.'}`);
    process.exitCode = 1;
  });
}
