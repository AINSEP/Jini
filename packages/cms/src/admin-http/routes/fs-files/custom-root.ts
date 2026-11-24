import { defineJsonRoute, ok, type JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

/**
 * @file The chat composer's folder control: `GET`/`PUT`/`DELETE` on
 * `/api/admin/v1/workspaces/:workspaceId/fs-files/custom-root` — the operator-facing surface for the
 * filesystem tools' operator-chosen `custom` root.
 *
 * The root lives in a host store that touches the filesystem, so this spec never does: the host
 * injects a read function, a write function and a classifier for its own "that path cannot be a
 * root" error. Which permission guards reading versus changing the root is the host's policy and
 * arrives as two injected strings; the workspace 404, the session principal, the 403 and the
 * redacted 500 are the host's ports.
 *
 * `PUT`/`DELETE` never read anything under the folder they accept — the injected write is
 * contracted to look at the path and a single `stat` only. The route inherits that property rather
 * than re-deriving it.
 */

/** The fields of the authenticated principal this route's host ports read. */
export interface FsCustomRootPrincipal { id: string }

/** What the host's store knows about a workspace's root: usable, never set, or set but gone. */
export interface FsCustomRootStatus {
  /** The usable root, or `undefined` when none was set or the one that was set no longer resolves to a directory. */
  readonly path: string | undefined;
  /** `true` only when a path WAS set but no longer stats as a directory. */
  readonly vanished: boolean;
  /** The set path that vanished; present only when `vanished` is `true`. */
  readonly vanishedPath?: string | undefined;
}

/** Reads the workspace's current root. The host binds the store and the site directory it persists under. */
export type FsCustomRootReadFn = (required: { workspaceId: string }) => FsCustomRootStatus;

/**
 * Sets (a path) or clears (`null`) the workspace's root. Throws the host's invalid-path error for a
 * shape rejection (relative path, missing directory, a file) and anything else for a real failure.
 */
export type FsCustomRootWriteFn = (required: { workspaceId: string; path: string | null }) => void;

/**
 * True iff `err` is the host's "that path cannot be a root" refusal, whose message is safe to echo
 * to the operator. Injected because the error class belongs to the host's store.
 */
export type FsCustomRootRefusalMatcher = (required: { err: unknown }, optional?: Record<string, never>) => boolean;

/** The deps `GET` reads. */
export interface FsCustomRootGetRouteDeps {
  workspaceId: string;
  /** The host's permission for reading which folder is set (the same one that gates reading through it). */
  readPermission: string;
  readCustomRoot: FsCustomRootReadFn;
}

/** The deps `PUT` reads. */
export interface FsCustomRootPutRouteDeps {
  workspaceId: string;
  /** The host's permission for choosing the folder (re-pointing the whole filesystem surface). */
  managePermission: string;
  readCustomRoot: FsCustomRootReadFn;
  writeCustomRoot: FsCustomRootWriteFn;
  isInvalidRootError: FsCustomRootRefusalMatcher;
}

/** The deps `DELETE` reads. */
export interface FsCustomRootDeleteRouteDeps {
  workspaceId: string;
  managePermission: string;
  writeCustomRoot: FsCustomRootWriteFn;
}

/** `GET`'s body: `vanished`/`vanishedPath` are only present when a previously-set folder is gone. */
export type FsCustomRootGetEnvelope = { path: string | null } | { path: null; vanished: true; vanishedPath: string | undefined };

/** `PUT`'s body: the path the store resolved (a key-less body if the folder vanished again at once). */
export interface FsCustomRootPutEnvelope { path: string | undefined }

/** The route has no entity of its own to authorize against; the host's authorizer still wants a type. */
const FS_CUSTOM_ROOT_ENTITY_TYPE = "fs-files-custom-root";

/**
 * Asks the host for one permission. A mount without an authorizer is a wiring bug, not a caller
 * error, so it fails closed.
 * @complexity O(1) plus the injected authorizer.
 */
async function authorizeFsCustomRoot(
  { authorize, permission }: { authorize: JsonRouteAuthorize | undefined; permission: string },
  _optional: Record<string, never> = {},
): Promise<void> {
  if (!authorize) throw new Error("fs-files custom-root admin route has no authorizer");
  await authorize({ permission, entityType: FS_CUSTOM_ROOT_ENTITY_TYPE });
}

/** The body's `path`, untouched: `undefined` for a missing, null or non-object body. @complexity O(1). */
function bodyPath({ body }: { body: unknown }, _optional: Record<string, never> = {}): unknown {
  return typeof body === "object" && body !== null ? (body as { path?: unknown }).path : undefined;
}

/** `GET` — which folder is set. @complexity O(1) plus the injected read. */
export const fsCustomRootGetRoute = defineJsonRoute<Record<string, never>, FsCustomRootGetEnvelope, FsCustomRootGetRouteDeps, FsCustomRootPrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/fs-files/custom-root",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeFsCustomRoot({ authorize, permission: deps.readPermission });
    const status = deps.readCustomRoot({ workspaceId: deps.workspaceId });
    // `vanished`/`vanishedPath` are only present (never `false`/absent-by-omission) when a
    // previously-set folder no longer stats as a directory — additive beyond the original
    // `{ path }` shape, so an existing caller reading only `path` sees no change.
    return ok({ value: status.vanished ? { path: null, vanished: true, vanishedPath: status.vanishedPath } : { path: status.path ?? null } });
  },
});

/** `PUT` — choose the folder. @complexity O(1) plus the injected store calls. */
export const fsCustomRootPutRoute = defineJsonRoute<{ path: unknown }, FsCustomRootPutEnvelope, FsCustomRootPutRouteDeps, FsCustomRootPrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/fs-files/custom-root",
  parse: (raw) => ok({ value: { path: bodyPath({ body: raw.body }) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeFsCustomRoot({ authorize, permission: deps.managePermission });
    // The body check follows authorization, not `parse`: the hand-written route asked permission
    // first, so a caller without the grant sees the 403 whatever it sent.
    if (typeof input.path !== "string" || input.path.length === 0) {
      rejectRoute({ status: 400, error: "'path' is required and must be a non-empty string", code: "VALIDATION_ERROR" });
    }
    try {
      deps.writeCustomRoot({ workspaceId: deps.workspaceId, path: input.path });
      // The store's resolved form (a symlink's canonical path), not an echo of the request.
      return ok({ value: { path: deps.readCustomRoot({ workspaceId: deps.workspaceId }).path } });
    } catch (err) {
      // A shape rejection is the operator's to fix and its message says how; anything else is
      // unexpected, so it is rethrown for the host's redacted 500.
      if (deps.isInvalidRootError({ err })) rejectRoute({ status: 400, error: err instanceof Error ? err.message : String(err), code: "INVALID_PATH" });
      throw err;
    }
  },
});

/** `DELETE` — clear the folder. @complexity O(1) plus the injected write. */
export const fsCustomRootDeleteRoute = defineJsonRoute<Record<string, never>, { path: null }, FsCustomRootDeleteRouteDeps, FsCustomRootPrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/fs-files/custom-root",
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await authorizeFsCustomRoot({ authorize, permission: deps.managePermission });
    deps.writeCustomRoot({ workspaceId: deps.workspaceId, path: null });
    return ok({ value: { path: null } });
  },
});
