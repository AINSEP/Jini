import type { DerivedRiskByToolId } from './registration-kit.js';
import type { ToolRegistration } from './tool-registry.js';

/** A domain owns its builder and risk classification; the host binds dependencies and surfaces. */
export interface ToolContributor<TDeps, TSurfaces> {
  readonly domain: string;
  readonly build: (deps: TDeps, surfaces: TSurfaces) => ToolRegistration[];
  readonly risk: DerivedRiskByToolId;
}

/** Post-processing sees the domain registrations; ordering and collision checks belong to the host. */
export interface DerivedToolContributor<TDeps, TSurfaces> {
  readonly domain: string;
  readonly derive: (input: {
    readonly registrations: readonly ToolRegistration[];
    readonly routeDeps: TDeps;
    readonly surfaces: TSurfaces;
  }) => ToolRegistration[];
  readonly risk: DerivedRiskByToolId;
}

/** The two ordered registries belong to one composition root, never shared across workspaces. */
export interface ToolContributions<TDeps, TSurfaces> {
  readonly contributors: ContributionRegistry<ToolContributor<TDeps, TSurfaces>>;
  readonly derivedContributors: ContributionRegistry<DerivedToolContributor<TDeps, TSurfaces>>;
}

/** Replace-by-key registry for host-owned contributions; no singleton or execution surface. */
export interface ContributionRegistry<TContribution> {
  register(required: { contribution: TContribution }): void;
  /** Detached array snapshot; contribution values retain their identity. */
  list(_required: Record<string, never>): readonly TContribution[];
  clear(_required: Record<string, never>): void;
}

/** O(1) register/clear, O(n) list and O(n) retained entries. Replacement preserves position. */
export function createContributionRegistry<TContribution, TKey>(required: {
  keyOf: (required: { contribution: TContribution }) => TKey;
}): ContributionRegistry<TContribution> {
  const contributions = new Map<TKey, TContribution>();
  return {
    register({ contribution }) {
      contributions.set(required.keyOf({ contribution }), contribution);
    },
    list(_required: Record<string, never>) { return [...contributions.values()]; },
    clear(_required: Record<string, never>) { contributions.clear(); },
  };
}
