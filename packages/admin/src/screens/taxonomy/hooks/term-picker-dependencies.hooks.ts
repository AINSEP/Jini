import type { AdminTaxonomyWithTerms } from "../api/taxonomy-api.types.js";
import type { TaxonomyApi } from "../api/taxonomy-api.js";
import type { TermPickerPort } from "./term-picker-port.hooks.js";
import { createFakeNewTermFormPort, createNewTermFormPort, type AdminTermCreateCall } from "./new-term-form-dependencies.hooks.js";

/**
 * @file The only place `use-term-picker.hooks.ts` reaches the host-bound taxonomy API client — see `term-picker-
 * port.hooks.ts` for why the split exists.
 */

/** The live implementation over the host-injected {@link TaxonomyApi} and the host's own `me` (its auth client). The host builds it once at
 *  its composition root, the way the redirects host ports bind a module-level singleton. */
export function createTermPickerPort({ api, me }: { api: TaxonomyApi; me: TermPickerPort["me"] }, _optional: Record<string, never> = {}): TermPickerPort {
  return {
    listTaxonomies: () => api.listTaxonomies(),
    assignedTerms: (input) => api.assignedTerms(input),
    assignTerms: (input) => api.assignTerms(input),
    unassignTerms: (input) => api.unassignTerms(input),
    me: () => me(),
    createTerm: createNewTermFormPort({ api }).createTerm,
  };
}

/** Seed state for {@link createFakeTermPickerPort}. */
export interface FakeTermPickerPortOptions {
  /** The taxonomies (with their terms) the picker lists. */
  taxonomies?: AdminTaxonomyWithTerms[];
  /** The term ids the post, page or entry holds before any save. */
  assigned?: string[];
  /** When set, `assignedTerms()` rejects with this. */
  loadError?: Error;
  /** When set, `listTaxonomies()` rejects with this. */
  taxonomiesError?: Error;
  /** When set, `assignTerms()`/`unassignTerms()` reject with this instead of resolving. */
  saveError?: Error;
  /** The admin's effective permissions. Defaults to the owner wildcard `["*"]`. */
  permissions?: string[];
  /** When set, `createTerm()` rejects with this message (see `createFakeNewTermFormPort`). */
  createError?: string;
}

type TermWrite = { kind: "assign" | "unassign"; contentType: string; contentId: string; termIds: string[] };

/**
 * An in-memory {@link TermPickerPort} for tests — "every port gets a fake" (see
 * `assistant-chats-dependencies.hooks.ts`). Keeps the assigned set, so a reload after a save reads
 * what the save wrote, and records every write for assertions.
 */
export function createFakeTermPickerPort(options: FakeTermPickerPortOptions = {}): TermPickerPort & {
  /** Every assign/unassign call this fake has received, in call order. */
  readonly calls: TermWrite[];
  /** Every term `createTerm()` has created, in call order — ids are `fake-1`, `fake-2`, …. */
  readonly created: AdminTermCreateCall[];
} {
  const termPort = createFakeNewTermFormPort({ createError: options.createError });
  const calls: TermWrite[] = [];
  const assigned = new Set(options.assigned ?? []);
  const write = async (kind: TermWrite["kind"], input: Omit<TermWrite, "kind">) => {
    calls.push({ kind, ...input });
    if (options.saveError) throw options.saveError;
    for (const id of input.termIds) {
      if (kind === "assign") assigned.add(id);
      else assigned.delete(id);
    }
  };

  return {
    calls,
    created: termPort.created,
    createTerm: (target, callOptions) => termPort.createTerm(target, callOptions),
    async me() {
      return { effectivePermissions: options.permissions ?? ["*"] };
    },
    async listTaxonomies() {
      if (options.taxonomiesError) throw options.taxonomiesError;
      return { items: options.taxonomies ?? [] };
    },
    async assignedTerms() {
      if (options.loadError) throw options.loadError;
      return { termIds: [...assigned].sort() };
    },
    assignTerms: (input) => write("assign", input),
    unassignTerms: (input) => write("unassign", input),
  };
}
