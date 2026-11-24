import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import type { TrashItem } from "../../../../trash/index.js";
import type { TrashEntryGateFn } from "../shared.js";

/** @file Shared fakes for the trash route-spec tests: a fixed row, an entry gate and the refusal reader. */

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "principal-1" };
export const NOW = "2026-10-01T12:00:00.000Z";
export const signal = new AbortController().signal;
/** The host's entry permission is injected, so the tests use a value no real host ships. */
export const ENTRY_PERMISSION = "test.trash_entry";

/** One trashed row, so serialized DTOs can be pinned field by field. */
export function fakeItem(overrides: Partial<TrashItem> = {}): TrashItem {
  return {
    id: "trash-1", workspaceId: WORKSPACE_ID, entityType: "post", entityId: "post-1", displayTitle: "Hello", displaySubtitle: "hello",
    trashedAt: "2026-09-30T12:00:00.000Z", purgeAfter: "2026-10-03T00:00:00.000Z", actorPrincipalId: "principal-1", actorPluginId: null,
    entityVersion: 2, priorMarker: null, ...overrides,
  } as TrashItem;
}

/** A recording entry gate; `allowed: false` refuses with `reason`, as the host's RBAC answer would. */
export function recordingGate(decision: { allowed: boolean; reason: string } = { allowed: true, reason: "matched" }): {
  authorizeEntry: TrashEntryGateFn; calls: { principalId: string }[];
} {
  const calls: { principalId: string }[] = [];
  return {
    calls,
    authorizeEntry: async (input) => {
      calls.push(input);
      return { permission: ENTRY_PERMISSION, ...decision };
    },
  };
}

/** Run `fn` and return the refusal it throws (status + flat body); fails if it does not refuse. */
export async function refusalOf(fn: () => unknown): Promise<{ status: number; body: unknown }> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof RouteRefusalError) return error.response;
    throw error;
  }
  throw new Error("expected a route refusal");
}

/** The raw input a host adapter hands `parse`. */
export const raw = (params: Record<string, string>, body: unknown = {}, query: Record<string, unknown> = {}) => ({ body, query, params });

/** The forbidden entry-gate body the host's `authorizeDirectOrRespond` wrote. */
export const ENTRY_FORBIDDEN = {
  status: 403,
  body: {
    error: `principal '${PRINCIPAL.id}' is not authorized for '${ENTRY_PERMISSION}' (no_grant)`,
    code: "FORBIDDEN", details: { permission: ENTRY_PERMISSION, reason: "no_grant" },
  },
};

/** A port method the test does not expect to be reached. */
export function unexpected(): never {
  throw new Error("unexpected port call");
}
