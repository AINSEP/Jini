import { defineJsonRoute, ok, routeReply, type JsonRouteAuthorize, type JsonRouteSpec, type RouteReply } from "@jini-ai/core/contracts/server";
import type { NativeFolderPicker } from "../../../fs-files/native-folder-picker.js";

/**
 * @file Admin chat composer's folder button: `GET`/`POST` on
 * `/api/admin/v1/workspaces/:workspaceId/fs-files/folder-picker`. `GET` says whether the button may
 * show; `POST` opens the OS folder dialog ON THE SERVER MACHINE and answers `{ path }` (`null` on
 * Cancel). A browser can never read a dropped folder's path; when the server is the owner's own
 * computer, it can ask the OS instead.
 *
 * The dialog appears on the server's screen, so this exists only when that screen is the caller's:
 * - `localHost` (the host's local-launch decision, the same one local credential copying uses): a
 *   local launch, never a deployed/hosted runtime. Otherwise 404, as if the route did not exist.
 * - the picker has a chooser on this OS. Otherwise 404 too.
 * - `isLocalRequest` (bound to the request by the host): loopback sockets, no forwarding headers, a
 *   loopback Host, same Origin. Otherwise 403 `local-host-only`.
 * - a session credential (an API key never pops a dialog) holding the host's `managePermission` —
 *   the permission that already gates pointing the chat's file tools at a folder, which the composer
 *   does with the picked path (owner/admin only).
 *
 * One dialog at a time per process: a second `POST` while one is open answers 409 `busy`.
 *
 * Every check runs in that order, cheapest and least revealing first, and all of them before the
 * dialog. The foreign-workspace 404 (same `{ error: "not found" }` body) is the host's workspace
 * port; every answer carries `Cache-Control: no-store`. A chooser failure is rethrown untouched: the
 * host answers it with its redacted 500, never echoing the chooser's stderr.
 */

/** The deps both methods read. `isLocalRequest`/`isSessionCredential` are bound per request by the host. */
export interface FsFolderPickerRouteDeps {
  readonly workspaceId: string;
  /** The host's decision that this process is a local launch, not a deployed/hosted runtime. */
  readonly localHost: boolean;
  readonly folderPicker: Pick<NativeFolderPicker, "available" | "pick">;
  /** The host's permission for choosing the chat's folder. */
  readonly managePermission: string;
  /** The credential-kind 403's message (the host's copy). */
  readonly sessionRequiredMessage: string;
  /** Bound to the request: true only for a request from this machine's own screen. */
  readonly isLocalRequest: () => boolean;
  /** Bound to the request: true only when the caller authenticated with a session (not an API key). */
  readonly isSessionCredential: () => boolean;
}

type Input = Record<string, never>;
/** The fields of the authenticated principal this route's host ports read. */
export interface FsFolderPickerPrincipal { id: string }
/** One method's spec; `responseHeaders` is the no-store header every answer carries. */
export type FsFolderPickerRoute<Output> = JsonRouteSpec<Input, Output, FsFolderPickerRouteDeps, FsFolderPickerPrincipal> & { readonly responseHeaders: Readonly<Record<string, string>> };

const BASE_PATH = "/api/admin/v1/workspaces/:workspaceId/fs-files/folder-picker";
const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

/**
 * Every admission check, cheapest and least revealing first. Returns the refusal to answer, or
 * `undefined` once the caller may use the picker. A denied permission throws (the host's 403).
 * @complexity O(1) plus the injected checks.
 */
async function refusal(
  { deps, authorize }: { deps: FsFolderPickerRouteDeps; authorize: JsonRouteAuthorize | undefined },
  _optional: Record<string, never> = {},
): Promise<RouteReply | undefined> {
  if (!deps.localHost || !deps.folderPicker.available) return routeReply({ status: 404, body: { error: "not found" } });
  if (!deps.isLocalRequest()) return routeReply({ status: 403, body: { reasonCode: "local-host-only" } });
  const permission = deps.managePermission;
  if (!deps.isSessionCredential()) {
    return routeReply({ status: 403, body: { error: deps.sessionRequiredMessage, code: "FORBIDDEN", details: { permission, reason: "credential_kind_not_permitted" } } });
  }
  // A mount without an authorizer is a wiring bug, not a caller error, so it fails closed.
  if (!authorize) throw new Error("fs-files folder-picker admin route has no authorizer");
  await authorize({ permission });
  return undefined;
}

/**
 * The `GET`/`POST` pair, sharing one "a dialog is open" slot; create once per process.
 * @complexity O(1); `POST` waits on the user.
 */
export function createFsFolderPickerRoutes(
  _required: Record<string, never> = {},
  _optional: Record<string, never> = {},
): { get: FsFolderPickerRoute<unknown>; post: FsFolderPickerRoute<unknown> } {
  let picking = false;
  const get = defineJsonRoute<Input, unknown, FsFolderPickerRouteDeps, FsFolderPickerPrincipal>({
    method: "get",
    path: BASE_PATH,
    parse: () => ok({ value: {} }),
    handle: async ({ deps, authorize }) => ok({ value: await refusal({ deps, authorize }) ?? { available: true } }),
  });
  const post = defineJsonRoute<Input, unknown, FsFolderPickerRouteDeps, FsFolderPickerPrincipal>({
    method: "post",
    path: BASE_PATH,
    parse: () => ok({ value: {} }),
    handle: async ({ deps, authorize }) => {
      const refused = await refusal({ deps, authorize });
      if (refused) return ok({ value: refused });
      if (picking) return ok({ value: routeReply({ status: 409, body: { reasonCode: "busy" } }) });
      picking = true;
      try {
        return ok({ value: { path: await deps.folderPicker.pick() } });
      } finally {
        picking = false;
      }
    },
  });
  return { get: { ...get, responseHeaders: RESPONSE_HEADERS }, post: { ...post, responseHeaders: RESPONSE_HEADERS } };
}
