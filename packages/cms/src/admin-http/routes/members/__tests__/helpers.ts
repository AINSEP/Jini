import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import type { AdminMemberSource } from "../../../http/members.js";
import type { MemberErrorClassifier } from "../shared.js";

/** @file Shared fakes for the members route-spec tests: a fixed member row, a recording authorizer, the refusal reader and a classifier. */

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "principal-1" };
export const signal = new AbortController().signal;

/** The members library owns its error classes; the specs only see them through the injected classifier. */
export class FakeMemberNotFoundError extends Error {}
export class FakeMemberConflictError extends Error {}
export class FakeMemberValidationError extends Error {}

/** The host's classifier, as a host would write it: by class, anything else unclassified. */
export const classifyMemberError: MemberErrorClassifier = ({ err }) => {
  if (err instanceof FakeMemberNotFoundError) return "not-found";
  if (err instanceof FakeMemberConflictError) return "conflict";
  if (err instanceof FakeMemberValidationError) return "validation";
  return undefined;
};

/** A stored member carrying fields the admin DTO must never forward (`note`, `fields`, `credentialsRevokedAt`). */
export function fakeMember(overrides: Partial<AdminMemberSource> = {}): AdminMemberSource & Record<string, unknown> {
  return {
    id: "member-1", workspaceId: WORKSPACE_ID, email: "person@example.com", name: "Pat", status: "active",
    emailVerifiedAt: "2026-10-08T00:00:00.000Z", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z", version: 3,
    note: "operator-only", fields: { "ext.demo.tier": "gold" }, credentialsRevokedAt: "2026-10-09T00:00:00.000Z", ...overrides,
  };
}

/** The serialized form of {@link fakeMember}: exactly the nine admin fields, none of the internal ones. */
export function fakeMemberDto(overrides: Partial<AdminMemberSource> = {}): Record<string, unknown> {
  const member = fakeMember(overrides);
  return {
    id: member.id, workspaceId: member.workspaceId, email: member.email, name: member.name, status: member.status,
    emailVerifiedAt: member.emailVerifiedAt, createdAt: member.createdAt, updatedAt: member.updatedAt, version: member.version,
  };
}

/** One recorded authorization: the permission, the entity type and, for by-id routes, the entity id. */
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
export const raw = (params: Record<string, string>, query: Record<string, unknown> = {}, body: unknown = {}) => ({ body, query, params });
