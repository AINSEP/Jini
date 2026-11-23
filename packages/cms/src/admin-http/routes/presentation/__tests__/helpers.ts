import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { InMemoryPresentationSettingsRepo } from "../../../../presentation/index.js";
import type { PresentationThemeView } from "../shared.js";

/** @file Shared fakes for the presentation route-spec tests. */

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "principal-1" };
export const signal = new AbortController().signal;

/** One recorded authorization: the permission, the entity type and, when a route names one, the entity id. */
export type RecordedAuthorize = { permission: string; entityType: string; entityId?: string };

/** A recording `authorize`; `denied` permissions throw, as the host port's 403 refusal would. */
export function recordingAuthorize(denied: readonly string[] = []): {
  authorize: (r: { permission: string; entityType: string }, o?: { entityId?: string }) => Promise<void>; calls: RecordedAuthorize[];
} {
  const calls: RecordedAuthorize[] = [];
  return {
    calls,
    authorize: async ({ permission, entityType }, optional = {}) => {
      calls.push({ permission, entityType, ...optional });
      if (denied.includes(permission)) throw new Error(`denied ${permission}`);
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
export const raw = (query: Record<string, unknown> = {}, params: Record<string, string> = {}) => ({ body: {}, query, params });

/** One discovered theme, as the host's discovery would report it. */
export function fakeTheme(id: string, overrides: Omit<Partial<PresentationThemeView>, "manifest"> & { manifest?: Partial<PresentationThemeView["manifest"]> } = {}): PresentationThemeView {
  const { manifest, ...rest } = overrides;
  return {
    dir: `/themes/${id}`, status: "valid", pages: { about: "<p/>" },
    ...rest,
    manifest: { id, name: `Theme ${id}`, tier: "templated", apiVersion: 2, templates: ["post.html", "page.html"], ...manifest },
  };
}

/** A real in-memory presentation repo holding one row for {@link WORKSPACE_ID}. */
export function presentationRepo(activeThemeId = "alpha"): InMemoryPresentationSettingsRepo {
  return new InMemoryPresentationSettingsRepo({}, { initialRows: [{ workspaceId: WORKSPACE_ID, activeThemeId, updatedAt: "2026-11-01T00:00:00.000Z" }] });
}
