import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import type { AgentPluginRowCandidate } from "../../../http/agent-plugins.js";
import type { AgentPluginSetEnabledErrorPredicates } from "../shared.js";

/** @file Shared fakes for the agent-plugins route-spec tests: a candidate row, a recording authorizer, error classes and the refusal reader. */

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "principal-1" };
export const signal = new AbortController().signal;

/** One installed plugin as the host's read model reports it. */
export function fakeCandidate(overrides: Partial<AgentPluginRowCandidate> = {}): AgentPluginRowCandidate {
  return {
    pluginId: "acme", id: "acme@1", provides: ["cap:a"], displayName: "Acme", summary: undefined, version: "1.0.0", description: undefined,
    keywords: ["k"], enabled: false, skills: [{ name: "s" }], mcpServerIds: ["m"], origin: "installed", hostOk: true, archiveDigest: "sha256:x",
    ...overrides,
  };
}

/** One recorded authorization: permission, entity type and, for by-id routes, the entity id. */
export type RecordedAuthorize = { permission: string; entityType: string; entityId?: string };

/** A recording `authorize`; `denied` permissions throw, as the host port's 403 refusal would. */
export function recordingAuthorize(denied: readonly string[] = []) {
  const calls: RecordedAuthorize[] = [];
  return {
    calls,
    authorize: async ({ permission, entityType }: { permission: string; entityType: string }, optional: { entityId?: string } = {}) => {
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
export const raw = (params: Record<string, string>, body: unknown = {}) => ({ body, query: {}, params });

/** Stand-ins for the host's error classes, so the injected predicates are real `instanceof` checks. */
export class CodedTestError extends Error { constructor(message: string, readonly code: string) { super(message); } }
export class ToolAccessLoweringTestError extends CodedTestError {}
export class HostIncompatibleTestError extends CodedTestError {}
export class UpdateTestError extends CodedTestError {}
export class NotReadyTestError extends CodedTestError {}
export class LinkedTestError extends CodedTestError { constructor(message: string, code: string, readonly providerPluginId: string) { super(message, code); } }
export class NotInstalledTestError extends Error {}
export class UnreadableTestError extends Error {}
export class BusyTestError extends Error {}

/** The predicates a host registrar binds from its real classes. */
export const TEST_ERROR_PREDICATES: AgentPluginSetEnabledErrorPredicates = {
  toolAccessLowering: (e): e is ToolAccessLoweringTestError => e instanceof ToolAccessLoweringTestError,
  hostIncompatible: (e): e is HostIncompatibleTestError => e instanceof HostIncompatibleTestError,
  update: (e): e is UpdateTestError => e instanceof UpdateTestError,
  notReady: (e): e is NotReadyTestError => e instanceof NotReadyTestError,
  linked: (e): e is LinkedTestError => e instanceof LinkedTestError,
  notInstalled: (e): e is NotInstalledTestError => e instanceof NotInstalledTestError,
  activationsUnreadable: (e): e is UnreadableTestError => e instanceof UnreadableTestError,
  activationsBusy: (e): e is BusyTestError => e instanceof BusyTestError,
};

/** Host copy for the two activation-record faults; test values no real host ships. */
export const TEST_COPY = { activationsUnreadable: "test: record unreadable", activationsBusy: "test: record busy" };
