import { defineJsonRoute, ok, type JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { pluginActorId, type PluginsRoutePrincipal } from "./shared.js";

/**
 * @file `PUT /api/admin/v1/workspaces/:workspaceId/project-keys/:keyId/use` — attach or detach one saved
 * project key for this site. Admin and chat share the same attachment owner and per-kind save permission.
 * Only the installation owner's own session may change saved-key grants: the session-only rule is the
 * host's mount gate (before this spec runs); the owner check and its copy are here, host-injected.
 */

/** The project key store fields this route reads. */
export interface ProjectKeyUsePort {
  /** The save permission of the key's kind. @throws An error named `ToolInputError` for an unknown key (answered 400). */
  permissionFor(required: { keyId: string }): Promise<string>;
  use(required: { keyId: string; use: boolean }): Promise<unknown>;
}

/** The deps this route reads. */
export interface ProjectKeyUseRouteDeps {
  workspaceId: string;
  /** The installation owner's principal id (`undefined` when none is known: nobody passes the check). */
  ownerPrincipalId(): Promise<string | undefined>;
  /** The host's 403 copy for a session that is not the owner's. */
  ownerOnlyMessage: string;
  /** The project key store; absent answers 503. */
  projectKeys: ProjectKeyUsePort | undefined;
}

function isProjectKeyUseInput(input: unknown, _optional: Record<string, never> = {}): input is { use: boolean } {
  const record = input as Record<string, unknown> | null;
  return !!record && typeof record.use === "boolean" && !Object.keys(record).some((key) => key !== "use");
}

/** Typed input refusals the key store raises are matched by name (the class lives in the host's tool layer). */
function rejectToolInput({ err }: { err: unknown }, _optional: Record<string, never> = {}): never {
  if (err instanceof Error && err.name === "ToolInputError") rejectRoute({ status: 400, error: err.message });
  throw err;
}

/**
 * Owner check, store presence, body rule, then the base read permission BEFORE the key lookup (so a
 * denied reader learns nothing about which keys exist), then the key's own save permission, then the use.
 * @complexity O(1) plus the injected store and authorizer.
 */
async function useProjectKey(
  { deps, authorize, principalId, keyId, body }: { deps: ProjectKeyUseRouteDeps; authorize: JsonRouteAuthorize | undefined; principalId: string; keyId: string; body: unknown },
  _optional: Record<string, never> = {},
): Promise<unknown> {
  if (principalId !== await deps.ownerPrincipalId()) rejectRoute({ status: 403, error: deps.ownerOnlyMessage });
  if (!deps.projectKeys) rejectRoute({ status: 503, error: "This site has no project key store." });
  if (!isProjectKeyUseInput(body)) rejectRoute({ status: 400, error: "use must be true or false" });
  if (!authorize) throw new Error("plugins admin route has no authorizer");
  await authorize({ permission: "custom-credentials.read" });
  const permission = await deps.projectKeys.permissionFor({ keyId });
  await authorize({ permission });
  return deps.projectKeys.use({ keyId, use: body.use });
}

/** The project key use route; the body rule runs after the owner and store checks, so it is read in `handle`. */
export const projectKeyUseRoute = defineJsonRoute<{ keyId: string; body: unknown }, unknown, ProjectKeyUseRouteDeps, PluginsRoutePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/project-keys/:keyId/use",
  parse: (raw) => ok({ value: { keyId: String(raw.params.keyId), body: raw.body } }),
  handle: async ({ input, deps, context, authorize }) => {
    const principalId = pluginActorId({ context });
    try {
      return ok({ value: await useProjectKey({ deps, authorize, principalId, ...input }) });
    } catch (err) {
      return rejectToolInput({ err });
    }
  },
});
