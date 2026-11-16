/** Composes the injection rules (L5 base-only edges, L6 base purity, L7 CSS tokens) and the
 * ratchet. `collectInjectionFindings` is every raw finding; `injectionViolations` is what the gate
 * reports after the debt baseline and the owner-approved exceptions are applied. */
import { basePurityFindings } from './base-purity.js';
import { cssTokenFindings, loadThemeTokens } from './css-tokens.js';
import {
  advisoryTestEdges, injectedEdgeFindings, manifestEdges, ownerOf, payloadEdges, productionEdges, testEdges, type Edge,
} from './injection-edges.js';
import { applyDebt, loadDebt, loadExceptions, type DebtViolation, type Finding } from './injection-debt.js';
import type { SourcePackage } from './package-sources.js';

interface Scope { root: string; packages: readonly SourcePackage[] }

function edgesOf(required: { root: string; pkg: SourcePackage }): Edge[] {
  const payload = ownerOf(required.pkg) === 'agent-plugins' ? payloadEdges(required) : [];
  return [...productionEdges(required), ...manifestEdges(required), ...payload];
}

export function collectInjectionFindings(required: Scope, _optional: Record<string, never> = {}): Finding[] {
  const { root, packages } = required;
  const edges = packages.flatMap(pkg => edgesOf({ root, pkg }));
  return [
    ...injectedEdgeFindings({ edges, exceptions: loadExceptions({ root }) }),
    ...basePurityFindings({ root, packages }),
    ...cssTokenFindings({ root, packages, tokens: loadThemeTokens({ root }) }),
  ];
}

/** Cross-package imports in test files: reported as a count, never failing (owner Q5). */
export function advisoryTestFindings(required: Scope, _optional: Record<string, never> = {}): Edge[] {
  return advisoryTestEdges({ edges: required.packages.flatMap(pkg => testEdges({ root: required.root, pkg })) });
}

export function injectionViolations(
  required: Scope,
  { warn = (message: string): void => console.warn(message) }: { warn?: (message: string) => void } = {},
): DebtViolation[] {
  const violations = applyDebt({ findings: collectInjectionFindings(required), debt: loadDebt({ root: required.root }) }, { warn });
  const advisory = advisoryTestFindings(required);
  if (advisory.length > 0) warn(`injection advisory: ${advisory.length} test-only cross-package imports in ${new Set(advisory.map(edge => edge.file)).size} files (not failing)`);
  return violations;
}
