import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import type { ExecutionDetectedAgent, ProbeCredentialRequest, ProbeCredentialResolution } from "../execution-shared.js";

/** @file Shared fakes for the assistant execution-probe spec tests. */

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "principal-1" };
export const PERMISSION = "host.assistant.manage";

/** One recorded authorization: the permission, the entity type and any scope the route sent. */
export type RecordedAuthorize = { permission: string; entityType: string; entityId?: string };

/** A recording `authorize`; `deny` throws, as the host port's 403 refusal would. */
export function recordingAuthorize(deny = false): {
  authorize: (r: { permission: string; entityType: string }, o?: { entityId?: string }) => Promise<void>; calls: RecordedAuthorize[];
} {
  const calls: RecordedAuthorize[] = [];
  return {
    calls,
    authorize: async ({ permission, entityType }, ...scope) => {
      calls.push({ permission, entityType, ...(scope[0] ?? {}) });
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
export const raw = (body: unknown = {}) => ({ body, query: {}, params: { workspaceId: WORKSPACE_ID } });

/** A recording credential chokepoint answering `resolution` (default: the typed key, at the requested endpoint). */
export function recordingCredential(resolution?: ProbeCredentialResolution): {
  resolve: (r: ProbeCredentialRequest) => Promise<ProbeCredentialResolution>; calls: ProbeCredentialRequest[];
} {
  const calls: ProbeCredentialRequest[] = [];
  return {
    calls,
    resolve: async (request) => {
      calls.push(request);
      return resolution ?? { ok: true, apiKey: request.typedKey, baseUrl: request.requestedBaseUrl };
    },
  };
}

/** A detected agent with every optional field absent unless overridden. */
export function agent(overrides: Partial<ExecutionDetectedAgent> = {}): ExecutionDetectedAgent {
  return { id: "cli-a", name: "CLI A", available: true, ...overrides };
}
