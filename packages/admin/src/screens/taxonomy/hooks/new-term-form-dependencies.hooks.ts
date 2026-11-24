import type { TaxonomyApi } from "../api/taxonomy-api.js";
import type { NewTermFormPort } from "./new-term-form-port.hooks.js";

/**
 * @file The only place among the taxonomy hooks that reaches the host-bound taxonomy API client for `createTerm` —
 * see `new-term-form-port.hooks.ts` for why the split exists.
 */

/** The live implementation over the host-injected {@link TaxonomyApi}. The host builds it once at
 *  its composition root, the way the redirects host ports bind a module-level singleton. */
export function createNewTermFormPort({ api }: { api: TaxonomyApi }, _optional: Record<string, never> = {}): NewTermFormPort {
  return {
    createTerm: (target, options) => api.createTerm(target, options),
  };
}

/** Seed state for {@link createFakeNewTermFormPort}. */
export interface FakeNewTermFormPortOptions {
  /** When set, `createTerm` rejects with this message instead of succeeding. */
  createError?: string | undefined;
}

/** The exact `target`/`options` pair one `createTerm` call received — recorded for assertions. */
export interface AdminTermCreateCall {
  taxonomyId: string;
  name: string;
  parentId?: string | null | undefined;
}

/**
 * An in-memory {@link NewTermFormPort} for tests — the fake that lets a test describe "the create
 * succeeds" or "the create fails" directly, instead of hand-building fetch `Response`s. Shipped
 * alongside the real binding per the pattern's "every port gets a fake" rule (see
 * `assistant-chats-dependencies.hooks.ts`).
 */
export function createFakeNewTermFormPort(options: FakeNewTermFormPortOptions = {}): NewTermFormPort & {
  /** Every term the fake's `createTerm` has created, in call order. */
  readonly created: AdminTermCreateCall[];
} {
  const created: AdminTermCreateCall[] = [];

  return {
    created,

    async createTerm(target, callOptions = {}) {
      if (options.createError) throw new Error(options.createError);
      created.push({ taxonomyId: target.taxonomyId, name: target.name, parentId: callOptions.parentId });
      return {
        term: {
          id: `fake-${created.length}`,
          taxonomyId: target.taxonomyId,
          parentId: callOptions.parentId ?? null,
          name: target.name,
          status: "active",
          updatedAt: new Date(0).toISOString(),
          version: 1,
        },
      };
    },
  };
}
