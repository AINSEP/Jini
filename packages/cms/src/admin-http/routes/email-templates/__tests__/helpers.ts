import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import type { EmailTemplateErrorDeps } from "../shared.js";

/** @file Shared fakes for the email-templates route-spec tests: the host's error classes as predicates, a recording authorizer, the refusal reader. */

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "principal-1" };
export const signal = new AbortController().signal;
/** The host's raw-HTML permission is injected, so the tests use a value no real host ships. */
export const EDIT_HTML_PERMISSION = "test.edit_html";

/** Stand-ins for the platform operation errors the host recognizes with predicates. */
export class FakeNotFound extends Error {}
export class FakeInput extends Error {}
export class FakeVersionConflict extends Error {}

export const errorDeps: EmailTemplateErrorDeps = {
  isTemplateNotFound: ({ err }) => err instanceof FakeNotFound,
  isTemplateInput: ({ err }) => err instanceof FakeInput,
  isTemplateVersionConflict: ({ err }) => err instanceof FakeVersionConflict,
};

/** One recorded authorization: the permission, the entity type (always empty here) and no entity id. */
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

/** A route-input context as the host's adapter builds it. */
export const raw = (params: Record<string, string>, body: unknown = {}, query: Record<string, unknown> = {}) => ({ body, query, params });
