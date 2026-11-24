import type { TaxonomyApi } from "../api/taxonomy-api.js";
import type { MergeTermSectionPort } from "./merge-term-section-port.hooks.js";

/**
 * @file The only place among the taxonomy hooks that reaches the host-bound taxonomy API client for the merge
 * ceremony's three routes — see `merge-term-section-port.hooks.ts` for why the split exists.
 */

/** The live implementation over the host-injected {@link TaxonomyApi}. The host builds it once at
 *  its composition root, the way the redirects host ports bind a module-level singleton. */
export function createMergeTermSectionPort({ api }: { api: TaxonomyApi }, _optional: Record<string, never> = {}): MergeTermSectionPort {
  return {
    planMergeTerm: (target) => api.planMergeTerm(target),
    confirmMergeTerm: (target) => api.confirmMergeTerm(target),
    executeMergeTerm: (target) => api.executeMergeTerm(target),
  };
}

/** Seed state for {@link createFakeMergeTermSectionPort}. */
export interface FakeMergeTermSectionPortOptions {
  /** `overlappingContentCount` the fake's `planMergeTerm` reports — defaults to 0 (no overlap). */
  overlappingContentCount?: number;
  /** When set, `planMergeTerm` rejects with this message instead of succeeding. */
  planError?: string;
  /** When set, `confirmMergeTerm` rejects with this message instead of succeeding. */
  confirmError?: string;
  /** When set, `executeMergeTerm` rejects with this message instead of succeeding. */
  executeError?: string;
}

/**
 * An in-memory {@link MergeTermSectionPort} for tests — the fake that lets a test describe "the
 * plan succeeds with N overlapping items" or "confirm fails" directly, instead of hand-building
 * fetch `Response`s. Shipped alongside the real binding per the pattern's "every port gets a fake"
 * rule (see `assistant-chats-dependencies.hooks.ts`).
 */
export function createFakeMergeTermSectionPort(
  options: FakeMergeTermSectionPortOptions = {}
): MergeTermSectionPort {
  let planCounter = 0;

  return {
    async planMergeTerm({ fromTermId, intoTermId }) {
      if (options.planError) throw new Error(options.planError);
      planCounter += 1;
      return {
        planId: `fake-plan-${planCounter}`,
        planHash: `fake-hash-${planCounter}`,
        details: {
          fromTermId,
          intoTermId,
          overlapLossDisclosed: true,
          overlappingContentCount: options.overlappingContentCount ?? 0,
        },
      };
    },

    async confirmMergeTerm() {
      if (options.confirmError) throw new Error(options.confirmError);
      return { confirmationToken: "fake-confirmation-token" };
    },

    async executeMergeTerm() {
      if (options.executeError) throw new Error(options.executeError);
      return { mergedCount: 1 };
    },
  };
}
