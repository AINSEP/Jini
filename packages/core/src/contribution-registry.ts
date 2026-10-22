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
