import type { JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

/**
 * @file Shared gate, param reader and error mapping for the `external-mcp` admin route specs.
 *
 * The workspace + authorization gate is one implementation rather than a copy per route because this
 * family's permission is doing more work than the usual admin gate: a stored row's `command` is
 * spawned as a real child process at daemon boot, so whoever can write here can execute arbitrary
 * code as the host process. That is inherent to configuring an MCP server — it is what every MCP
 * client does, including Claude Code with its own `.mcp.json` — but it means the gate must be
 * site-owner level and must never drift between the read route and the write routes. One
 * implementation is what keeps them from drifting.
 *
 * `admin.integrations.manage` rather than a new permission string, for the reason
 * `Jini packages/mcp/src/federation/trust.ts` already documents for federated CALLS: it is the existing
 * third-party-integration permission, it is site-owner-level rather than editor-level, and a
 * deployment that has already decided who may administer external integrations should not have to
 * decide again.
 *
 * The workspace check is the host's workspace port (same 404 body); the permission check is
 * {@link authorizeExternalMcp}. Error classes live in the host or in other packages, so each route
 * receives its classification as injected predicates and keeps its exact `catch` ladder as a mapping
 * table here; the host's `onError` port writes the thrown refusal body verbatim.
 */

/** The one permission every external-MCP admin route asks for. */
export const EXTERNAL_MCP_PERMISSION = "admin.integrations.manage";

/** The principal fields these routes read: only the id (the PUT's write-grant attribution). */
export interface ExternalMcpRoutePrincipal { id: string }

/** A server row as the routes read it: the id, whether it is on, and whatever else the host's read model carries. */
export interface ExternalMcpServerSummary { serverId: string; enabled: boolean }

/** A read-model row tagged with whether the runtime provisioned it (built-in) or the operator did. */
export type ExternalMcpOwnedServer<T extends { serverId: string } = ExternalMcpServerSummary> = T & { builtIn: boolean };

/** Host collaborator: tags a server row with its built-in ownership (the runtime's provenance list). */
export type ExternalMcpDescribeOwnershipFn = <T extends { serverId: string }>(server: T) => ExternalMcpOwnedServer<T>;

/** A thrown error that carries its own `message` and `code`. */
export interface ExternalMcpCodedError { message: string; code: string }

/** A thrown error naming the invalid field. */
export interface ExternalMcpFieldError { message: string; field: string }

/**
 * Asks the host for `admin.integrations.manage` on the `integration` entity type, with no entity id
 * (the hand-written gate never named one). A mount without an authorizer is a wiring bug: fail closed.
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeExternalMcp({ authorize }: { authorize: JsonRouteAuthorize | undefined }, _optional: Record<string, never> = {}): Promise<void> {
  if (!authorize) throw new Error("external-mcp admin route has no authorizer");
  await authorize({ permission: EXTERNAL_MCP_PERMISSION, entityType: "integration" });
}

/** The authenticated principal's id. @complexity O(1). */
export function externalMcpActorId({ context }: { context: ExternalMcpRoutePrincipal | undefined }, _optional: Record<string, never> = {}): string {
  if (!context) throw new Error("external-mcp admin route has no authenticated principal");
  return context.id;
}

/** One path segment; Express always fills it, the `?? ""` mirrors the hand-written routes. @complexity O(1). */
export function externalMcpParam(params: Record<string, string | undefined>, name: string): string {
  return String(params[name] ?? "");
}

/** One `catch` rung: a predicate and the status + exact body it answers with. */
export interface ExternalMcpErrorMapping {
  readonly matches: (err: unknown) => boolean;
  readonly status: (err: unknown) => number;
  readonly body: (err: unknown) => unknown;
}

/**
 * Refuses with the first matching rung's status and body; anything unmapped is rethrown unchanged
 * so the host's error port answers it as an unexpected (redacted) failure with the route's operation.
 * @complexity O(n) in the mapping table length, a small fixed list per route.
 */
export function rejectExternalMcpError({ err, mappings }: { err: unknown; mappings: readonly ExternalMcpErrorMapping[] }, _optional: Record<string, never> = {}): never {
  const mapping = mappings.find((candidate) => candidate.matches(err));
  if (!mapping) throw err;
  throw new RouteRefusalError({ status: mapping.status(err), body: mapping.body(err) });
}

/** `400 INVALID_MCP_SERVER` with the offending field — the store's validation error, in every route that surfaces it. @complexity O(1). */
export function invalidServerMapping(isValidationError: (err: unknown) => err is ExternalMcpFieldError): ExternalMcpErrorMapping {
  return {
    matches: isValidationError,
    status: () => 400,
    body: (err) => ({ error: (err as ExternalMcpFieldError).message, code: "INVALID_MCP_SERVER", details: { field: (err as ExternalMcpFieldError).field } }),
  };
}

/** `503 SECRET_STORE_UNCONFIGURED` — the missing/rotated site key, one contract for the admin client. @complexity O(1). */
export function secretStoreMapping(isSecretStoreUnconfiguredError: (err: unknown) => err is { message: string }): ExternalMcpErrorMapping {
  return {
    matches: isSecretStoreUnconfiguredError,
    status: () => 503,
    body: (err) => ({ error: (err as { message: string }).message, code: "SECRET_STORE_UNCONFIGURED" }),
  };
}
