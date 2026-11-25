/** Environment-access ratchet (HW9-env-access, HW12-env-import-time, HW13-env-undeclared-entry). Run directly, or through guard.ts.
 *
 * This script is the host half of `@jini-ai/devops/checks/env-access`: it decides where to look and
 * which files are process entries. Both come from the tree and the package manifests, so there is
 * no hand-kept list to drift.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createConsoleLogger } from '../packages/core/src/primitives/logger.js';
import { createEnvAccessInspector, ENV_ACCESS_RULES } from '../packages/devops/src/checks/env-access.js';
import { runHardwiring, sourceFiles } from '../packages/devops/src/checks/hardwiring-node.js';
import { createHardwiringInspector, diffHardwiringDebt } from '../packages/devops/src/checks/hardwiring.js';
import type { HardwiringViolation } from '../packages/devops/src/checks/hardwiring.js';
import { packageSourceFiles, payloadSourceFiles, sourcePackages } from './lib/package-sources.js';
import type { SourcePackage } from './lib/package-sources.js';
import { declaredEnvNamesFor, JINI_ENTRY_ENV_NAMES } from './jini-env-schema.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEBT_FILE = 'scripts/env-access-debt.json';
const logger = createConsoleLogger({ prefix: '' });
/** A bundler replaces `process.env.NODE_ENV` only in code that is built for these runtimes. */
const BUNDLED_RUNTIMES: ReadonlySet<string> = new Set(['browser', 'dom', 'universal']);
/** Plugin payload folders that ship as published code beside the agent-plugins `src`. */
const PAYLOAD_FOLDER = /^[^/]+\/(?:lib|worker|ui)\/.+\.mjs$/;

interface ScannedFile { file: string; envRoot: boolean; buildDefine: boolean }
type EntryEnvNames = Readonly<Record<string, readonly string[]>>;
/** Which entry declarations to apply; tests scan fixture trees with their own rows. */
interface EnvAccessScanOptions { entryEnvNames?: EntryEnvNames }
type EntryManifest = SourcePackage['manifest'] & { bin?: string | Record<string, string>; jini?: { runtime?: string } };

/** A package's process entries: everything under `src/bin/`, and the source of each manifest `bin` target. */
function isProcessEntry(required: { pkg: SourcePackage; file: string }): boolean {
  const inPackage = relative(required.pkg.directory, required.file).replaceAll('\\', '/');
  if (inPackage.startsWith('src/bin/')) return true;
  const bin = (required.pkg.manifest as EntryManifest).bin;
  const targets = typeof bin === 'string' ? [bin] : Object.values(bin ?? {});
  return targets.some(target => target.replace(/^\.\//, '').replace(/^dist\//, 'src/').replace(/\.js$/, '') === inPackage.replace(/\.[cm]?tsx?$/, ''));
}

function packageFiles(required: { packagesDir: string }): ScannedFile[] {
  return sourcePackages(required).flatMap(pkg => {
    const buildDefine = BUNDLED_RUNTIMES.has((pkg.manifest as EntryManifest).jini?.runtime ?? '');
    return packageSourceFiles({ directory: pkg.directory }, { includeJavaScript: true })
      .filter(file => /\.[cm]?[jt]sx?$/.test(file) && !file.endsWith('.d.ts'))
      .map(file => ({ file, envRoot: isProcessEntry({ pkg, file }), buildDefine }));
  });
}

/** Plugin payloads and examples are published or copied code that the package-source scan never reaches. */
function payloadAndExampleFiles(required: { repoRoot: string }): ScannedFile[] {
  const plugins = join(required.repoRoot, 'packages/agent-plugins');
  const payloads = existsSync(plugins) ? payloadSourceFiles({ directory: plugins })
    .filter(file => PAYLOAD_FOLDER.test(relative(plugins, file).replaceAll('\\', '/'))) : [];
  const examples = join(required.repoRoot, 'examples');
  const exampleSources = existsSync(examples) ? readdirSync(examples, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(entry => sourceFiles({ directory: join(examples, entry.name, 'src') })) : [];
  return [...payloads, ...exampleSources].map(file => ({ file, envRoot: false, buildDefine: false }));
}

/** A declaration for a file the scan does not treat as an entry would silently grant nothing; fail instead. */
function assertDeclaredEntriesExist({ entries, schema }: { entries: ReadonlySet<string>; schema: EntryEnvNames }): void {
  const stale = Object.keys(schema).filter(entry => !entries.has(entry));
  if (stale.length) throw new Error(`${stale.length} env schema row(s) name a file that is not a scanned process entry; fix them in scripts/jini-env-schema.ts.`);
}

/** Scan package source, plugin payloads and examples; no builds, no imports of the scanned code, no network.
 * Each process entry is checked against the names declared for its repo-relative path. */
export function collectEnvAccess(required: { repoRoot: string }, { entryEnvNames = JINI_ENTRY_ENV_NAMES }: EnvAccessScanOptions = {}): HardwiringViolation[] {
  const inspector = createEnvAccessInspector({ compiler: ts, inspector: createHardwiringInspector({ compiler: ts }) });
  const files = [...packageFiles({ packagesDir: join(required.repoRoot, 'packages') }), ...payloadAndExampleFiles(required)]
    .map(scanned => ({ ...scanned, file: relative(required.repoRoot, scanned.file).replaceAll('\\', '/'), path: scanned.file }));
  assertDeclaredEntriesExist({ entries: new Set(files.filter(f => f.envRoot).map(f => f.file)), schema: entryEnvNames });
  return files.flatMap(({ file, path, envRoot, buildDefine }) => inspector.inspect({
    file, source: readFileSync(path, 'utf8'), envRoot, buildDefine,
    ...(envRoot ? { declaredEnvNames: declaredEnvNamesFor({ entry: file }, { schema: entryEnvNames }) } : {}),
  }));
}

/** Guard aggregators receive only new debt; existing occurrences stay visible in the counts. */
export function checkEnvAccess(required: { repoRoot: string } = { repoRoot: root }, options: EnvAccessScanOptions = {}): HardwiringViolation[] {
  const current = collectEnvAccess(required, options);
  const baseline = JSON.parse(readFileSync(join(required.repoRoot, DEBT_FILE), 'utf8')) as { violations: HardwiringViolation[] };
  const diff = diffHardwiringDebt({ baseline: baseline.violations, current });
  for (const rule of ENV_ACCESS_RULES) logger.info({ message: `[hardwiring] ${rule}: ${current.filter(v => v.rule === rule).length} total; ${diff.added.filter(v => v.rule === rule).length} new` });
  if (diff.removed.length) logger.info({ message: `[hardwiring] ${diff.removed.length} stale debt occurrences; remove them from ${DEBT_FILE}.` });
  return diff.added;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // This script runs in the workspace's CommonJS context; keep async CLI settlement off top-level await.
  void runHardwiring({ collect: () => collectEnvAccess({ repoRoot: root }), debtPath: join(root, DEBT_FILE), report: logger,
      baselineComment: '2026-11-16 env-access adoption (HW9, HW12). Occurrence hashes of the env name. Shrink as readers move to their host; never regenerate in CI.' },
    { writeBaseline: process.argv.includes('--write-baseline'), rules: ENV_ACCESS_RULES }).then(added => {
    if (added.length) process.exitCode = 1;
  }).catch(error => {
    logger.error({ message: '[hardwiring] Environment-access audit failed.' }, { error });
    process.exitCode = 1;
  });
}
