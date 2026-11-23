/** Gate C1 policy for `metadata.approvedRuntime` (C1, GC.1, GC.2). The list authorizes a named runtime
 * export of a base package's public entry; it is policy, so it changes only alongside the code it describes:
 * - every approval must name a runtime export the head actually ships (a type, a private alias or a removed
 *   export cannot be approved);
 * - an approval may be ADDED only in the change that adds that runtime export to that entry (the pair is
 *   absent from the trusted base's export set) — manual approval growth fails;
 * - an approval may not be DROPPED while its export is still public: silent narrowing is a policy change too.
 * Base export sets are read from the base tree through the same syntactic enumerator as the head.
 */
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { BASE_PACKAGE_NAMES } from './base-entry-policy.js';
import type { DebtFile, DebtViolation } from './injection-debt.js';
import type { SourcePackage } from './package-sources.js';
import { runtimeExportPairs, type ReadFile } from './public-exports.js';

const DEBT_FILE = 'scripts/injection-debt.json';
const listed = (pairs: readonly string[]): string => `${pairs.slice(0, 5).join(', ')}${pairs.length > 5 ? ', …' : ''}`;

/** A reader over the live tree, repo-relative paths. */
export function liveReader(required: { root: string }, _optional: Record<string, never> = {}): ReadFile {
  return path => { try { return readFileSync(join(required.root, path), 'utf8'); } catch { return undefined; } };
}

/**
 * The runtime `<entry>#<export>` pairs the base packages ship in a tree.
 * @param required.read Reader for that tree; package manifests are read through it too.
 * @param required.directories Repo-relative package directories to consider.
 */
export function basePackagePairs(required: { read: ReadFile; directories: readonly string[] }, _optional: Record<string, never> = {}): string[] {
  return required.directories.flatMap(directory => {
    const text = required.read(`${directory}/package.json`);
    const manifest = text === undefined ? undefined : JSON.parse(text) as { name: string; exports?: never };
    return manifest && BASE_PACKAGE_NAMES.includes(manifest.name) ? runtimeExportPairs({ manifest, directory, read: required.read }) : [];
  }).sort();
}

/** Repo-relative directories of the base packages in a workspace scan. */
export function baseDirectories(required: { root: string; packages: readonly SourcePackage[] }, _optional: Record<string, never> = {}): string[] {
  return required.packages.filter(pkg => BASE_PACKAGE_NAMES.includes(pkg.manifest.name))
    .map(pkg => relative(required.root, pkg.directory).split(sep).join('/'));
}

/**
 * Approval-list violations of the head debt file against the head and base export sets.
 * @param required.head The head debt file. @param required.base The trusted base debt file (null: first adoption).
 * @param required.headPairs Runtime pairs the head ships. @param required.basePairs Lazy base pairs (read only when needed).
 */
export function approvalViolations(required: { head: DebtFile; base: DebtFile | null; headPairs: readonly string[]; basePairs: () => readonly string[] }, _optional: Record<string, never> = {}): DebtViolation[] {
  const approved = required.head.metadata?.approvedRuntime ?? [];
  const shipped = new Set(required.headPairs);
  const violations: DebtViolation[] = [];
  const phantom = approved.filter(pair => !shipped.has(pair));
  if (phantom.length > 0) violations.push({ rule: 'injection-debt-invalid', file: DEBT_FILE, reason: `approvals name no public runtime export at the head: ${listed(phantom)}` });
  const baseApproved = required.base?.metadata?.approvedRuntime;
  if (!baseApproved) return violations;
  const before = new Set(baseApproved);
  const added = approved.filter(pair => !before.has(pair) && shipped.has(pair));
  const basePairs = added.length > 0 ? new Set(required.basePairs()) : new Set<string>();
  const manual = added.filter(pair => basePairs.has(pair));
  if (manual.length > 0) violations.push({ rule: 'injection-approval-growth', file: DEBT_FILE, reason: `approvals added for exports that already shipped at the base: ${listed(manual)}` });
  const narrowed = baseApproved.filter(pair => !approved.includes(pair) && shipped.has(pair));
  if (narrowed.length > 0) violations.push({ rule: 'injection-approval-narrowed', file: DEBT_FILE, reason: `approvals dropped while the export is still public: ${listed(narrowed)}` });
  return violations;
}
