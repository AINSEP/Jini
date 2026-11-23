/** Composes the injection rules (L5 base-only edges, L6 base purity, L7 CSS tokens) and the
 * ratchet. `collectInjectionFindings` is every raw finding; `injectionViolations` is what the gate
 * reports after the debt baseline and the owner-approved exceptions are applied. */
import { basePurityFindings } from './base-purity.js';
import { cssTokenFindings, loadThemeTokens } from './css-tokens.js';
import {
  advisoryTestEdges, hostPresets, injectedEdgeFindings, manifestEdges, ownerOf, payloadEdges, productionEdges, runtimeAdapters, testEdges, type Edge, type EdgeScope,
} from './injection-edges.js';
import {
  applyDebt, asDebtFile, baseRefOptions, debtFileViolations, debtGrowth, gitDebtBase, loadDebtFile, loadExceptions, type DebtEntry, type DebtFile, type DebtViolation, type Finding,
} from './injection-debt.js';
import { resolvedFindings } from './base-entry-policy.js';
import { contractRuntimeFindings } from './contract-runtime.js';
import { baseCommit, fileAtCommit } from './debt-base.mjs';
import type { SourcePackage } from './package-sources.js';
import type { ReadFile } from './public-exports.js';
import { approvalViolations, baseDirectories, basePackagePairs, liveReader } from './runtime-approvals.js';
import { createSpecResolver } from './spec-aliases.js';

interface Scope { root: string; packages: readonly SourcePackage[] }

function scopeOf(required: { root: string; pkg: SourcePackage; packages: readonly SourcePackage[] }): EdgeScope {
  return { root: required.root, pkg: required.pkg, resolve: createSpecResolver({ pkg: required.pkg, packages: required.packages }) };
}

function edgesOf(required: EdgeScope): Edge[] {
  const payload = ownerOf(required.pkg) === 'agent-plugins' ? payloadEdges(required) : [];
  return [...productionEdges(required), ...manifestEdges(required), ...payload];
}

/** Every raw finding. `approvedRuntime` defaults to the checked-in `metadata.approvedRuntime`; the baseline
 * printer passes the live export set instead, so a seed is captured against what actually ships. */
export function collectInjectionFindings(required: Scope, optional: { approvedRuntime?: readonly string[] } = {}): Finding[] {
  const { root, packages } = required;
  const edges = packages.flatMap(pkg => edgesOf(scopeOf({ root, pkg, packages })));
  const presets = hostPresets({ packages });
  const approved = optional.approvedRuntime ?? loadDebtFile({ root }).metadata?.approvedRuntime ?? [];
  return [
    ...injectedEdgeFindings({ edges, exceptions: loadExceptions({ root }), presets, adapters: runtimeAdapters({ packages }) }),
    ...resolvedFindings({ root, packages, approved, presets }),
    ...contractRuntimeFindings({ root, packages }),
    ...basePurityFindings({ root, packages }),
    ...cssTokenFindings({ root, packages, tokens: loadThemeTokens({ root }) }),
  ];
}

/** The runtime pairs the base packages ship in the live tree. */
export function liveRuntimePairs(required: Scope, _optional: Record<string, never> = {}): string[] {
  return basePackagePairs({ read: liveReader({ root: required.root }), directories: baseDirectories(required) });
}

/** A reader over the trusted base tree (INJECTION_BASE_REF), resolved once. */
function gitBaseReader(root: string): ReadFile {
  let commit: string | undefined;
  return path => fileAtCommit({ root, commit: (commit ??= baseCommit({ root }, baseRefOptions())), file: path });
}

/** Cross-package imports in test files: reported as a count, never failing (owner Q5). */
export function advisoryTestFindings(required: Scope, _optional: Record<string, never> = {}): Edge[] {
  return advisoryTestEdges({ edges: required.packages.flatMap(pkg => testEdges(scopeOf({ root: required.root, pkg, packages: required.packages }))), presets: hostPresets({ packages: required.packages }) });
}

/** `debtBase` reads the debt file at the trusted base commit (default: git, INJECTION_BASE_REF or HEAD);
 * `baseRead` reads any file of that base tree (default: git), for the base export set. */
export interface InjectionOptions { warn?: (message: string) => void; debtBase?: () => readonly DebtEntry[] | DebtFile | null; baseRead?: ReadFile }

export function injectionViolations(required: Scope, optional: InjectionOptions = {}): DebtViolation[] {
  const warn = optional.warn ?? ((message: string): void => console.warn(message));
  const file = loadDebtFile({ root: required.root });
  const base = asDebtFile((optional.debtBase ?? (() => gitDebtBase({ root: required.root })))());
  const baseRead = optional.baseRead ?? gitBaseReader(required.root);
  const basePairs = (): string[] => basePackagePairs({ read: baseRead, directories: baseDirectories(required) });
  const violations = [
    ...debtFileViolations({ file, base }),
    ...approvalViolations({ head: file, base, headPairs: liveRuntimePairs(required), basePairs }),
    ...debtGrowth({ base, debt: file.entries }, file.metadata ? { metadata: file.metadata } : {}),
    ...applyDebt({ findings: collectInjectionFindings(required), debt: file.entries }),
  ];
  const advisory = advisoryTestFindings(required);
  if (advisory.length > 0) warn(`injection advisory: ${advisory.length} test-only cross-package imports in ${new Set(advisory.map(edge => edge.file)).size} files (not failing)`);
  return violations;
}
