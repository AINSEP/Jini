import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import type { ExternalMcpErrorPredicate } from "../shared.js";

/**
 * @file Fakes shared by the external-MCP route spec tests: a recording/denying authorizer, the
 * refusal reader, a raw-request builder and stand-ins for the host's error classes (which live in
 * the host or in other packages, so the specs only ever see them through injected predicates).
 */

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "principal-1" };
export const signal = new AbortController().signal;
export const PERMISSION_CALL = { permission: "admin.integrations.manage", entityType: "integration" };

export type RecordedAuthorize = { permission: string; entityType: string; entityId?: string };

/** An authorizer that records every call and throws for the permissions listed in `denied`. */
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

/** The `{ status, body }` a handler refused with; anything else is rethrown. */
export async function refusalOf(fn: () => unknown): Promise<{ status: number; body: unknown }> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof RouteRefusalError) return error.response;
    throw error;
  }
  throw new Error("expected a route refusal");
}

export const raw = (params: Record<string, string>, body: unknown = {}) => ({ body, query: {}, params });

/** Host-class stand-ins: each predicate below is bound to exactly one of these, as the registrar binds the real class. */
export class FakeValidationError extends Error { constructor(message: string, readonly field: string) { super(message); } }
export class FakeSecretStoreError extends Error {}
export class FakeLoweringError extends Error { readonly code = "TOOL_ACCESS_LOWERING_FAILED"; }
export class FakeApiConnectionError extends Error { constructor(message: string, readonly code: string) { super(message); } }
export class FakeReauthError extends Error { readonly code = "EXTERNAL_MCP_REAUTH_REQUIRED"; readonly settingsLink = "/settings/mcp"; }
export class FakeOAuthError extends Error {
  constructor(message: string, readonly code: string, readonly retryable: boolean, readonly operatorAction: string, readonly retryAfterSeconds?: number) { super(message); }
}

/** The predicate a registrar binds for one error class: `instanceof`, as a guard over the object argument. */
export function instanceOf<E>({ ErrorClass }: { ErrorClass: abstract new (...args: never[]) => E }, _optional: Record<string, never> = {}): ExternalMcpErrorPredicate<E> {
  return (required): required is { err: E } => required.err instanceof ErrorClass;
}

export const isValidationError = instanceOf({ ErrorClass: FakeValidationError });
export const isSecretStoreUnconfiguredError = instanceOf({ ErrorClass: FakeSecretStoreError });

/** The ownership tagger the host binds: built-in when the id is on the runtime's provenance list. */
export function describeOwnershipFor(ids: readonly string[]) {
  return <T extends { serverId: string }>({ server }: { server: T }, _optional: Record<string, never> = {}) => ({ ...server, builtIn: ids.includes(server.serverId) });
}
