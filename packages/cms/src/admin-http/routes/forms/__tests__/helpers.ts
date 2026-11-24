import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import type { FormDefinitionRecord, FormSubmissionRecord } from "../../../../forms/index.js";
import { InMemoryFormDefinitionRepo, InMemoryFormSubmissionRepo } from "../../../../forms/repo.memory.js";

/** @file Shared fakes for the forms route-spec tests. */

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "principal-1" };
export const signal = new AbortController().signal;

/** One fixed form definition, slug `contact`, id `form-1`. */
export function fakeDefinition(overrides: Partial<FormDefinitionRecord> = {}): FormDefinitionRecord {
  return {
    id: "form-1", workspaceId: WORKSPACE_ID, name: "Contact", slug: "contact", fields: [],
    notify: { enabled: false, recipients: [] }, status: "active",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1, ...overrides,
  } as FormDefinitionRecord;
}

/** One fixed submission of {@link fakeDefinition}. */
export function fakeSubmission(overrides: Partial<FormSubmissionRecord> = {}): FormSubmissionRecord {
  return { id: "sub-1", workspaceId: WORKSPACE_ID, formDefinitionId: "form-1", data: { name: "Ada" }, sourceIp: null, submittedAt: "2026-01-02T00:00:00.000Z", ...overrides } as FormSubmissionRecord;
}

/** Real in-memory repos seeded with one definition and one submission. */
export async function seededRepos(): Promise<{ formDefinitionRepo: InMemoryFormDefinitionRepo; formSubmissionRepo: InMemoryFormSubmissionRepo }> {
  const formDefinitionRepo = new InMemoryFormDefinitionRepo();
  const formSubmissionRepo = new InMemoryFormSubmissionRepo();
  await formDefinitionRepo.create(fakeDefinition());
  await formSubmissionRepo.create(fakeSubmission());
  return { formDefinitionRepo, formSubmissionRepo };
}

/** One recorded authorization: the permission, the entity type and, for by-id routes, the entity id. */
export type RecordedAuthorize = { permission: string; entityType: string; entityId?: string };

/** A recording `authorize`, so each test pins the permission, entity type and entity id the route asks for. */
export function recordingAuthorize(): { authorize: (r: { permission: string; entityType: string }, o?: { entityId?: string }) => Promise<void>; calls: RecordedAuthorize[] } {
  const calls: RecordedAuthorize[] = [];
  return { calls, authorize: async ({ permission, entityType }, optional = {}) => { calls.push({ permission, entityType, ...optional }); } };
}

/** An authorizer that refuses like the host's guard port does. */
export const denyingAuthorize = async (): Promise<void> => { throw new RouteRefusalError({ status: 403, body: { error: "denied", code: "FORBIDDEN" } }); };

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

export const raw = (params: Record<string, string>, extra: { body?: unknown; query?: Record<string, unknown> } = {}) => ({ body: extra.body, query: extra.query ?? {}, params });
