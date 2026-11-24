import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

/** @file Shared fakes for the skills route-spec tests: a recording authorizer, the refusal reader and fake skill sources. */

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "principal-1" };
export const signal = new AbortController().signal;

/** One recorded authorization: the permission, the entity type and any scope the route passed. */
export type RecordedAuthorize = { permission: string; entityType: string; entityId?: string };

/** A recording `authorize`; when `deny` is set it throws, as the host port's 403 refusal would. */
export function recordingAuthorize(deny = false): {
  authorize: (r: { permission: string; entityType: string }, o?: { entityId?: string }) => Promise<void>; calls: RecordedAuthorize[];
} {
  const calls: RecordedAuthorize[] = [];
  return {
    calls,
    authorize: async ({ permission, entityType }, optional = {}) => {
      calls.push({ permission, entityType, ...optional });
      if (deny) throw new Error(`denied ${permission}`);
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
export const raw = (params: Record<string, string>, body: unknown = {}) => ({ body, query: {}, params });

/** The host's input-error class stand-in: the specs only see it through the injected test. */
export class FakeSkillInputError extends Error {}
export const isSkillInputError = ({ err }: { err: unknown }) => err instanceof FakeSkillInputError;

/** The exact permission/entity every skills route asks for, id-free. */
export const SKILLS_AUTH = [{ permission: "admin.assistant.use", entityType: "skill" }];

/** A source loader over fixed sources that records the options each call passed. */
export function fakeSources(sources: readonly { id: string; directory?: string }[]) {
  const calls: unknown[] = [];
  return { calls, loadSkillSources: async (input: { includeDisabled?: boolean }) => { calls.push(input); return sources; } };
}
