import type { JsonRouteAuthorize, RawRouteInputContext, RouteBodyRefusal } from "@jini-ai/core/contracts/server";

import { agentPluginActorId, type AgentPluginRoutePrincipal } from "./shared.js";

/**
 * @file `AGENT_PLUGIN_INSTALL_ZIP` — `POST /api/admin/v1/workspaces/:workspaceId/agent-plugins/install/zip?expectedSha256=<hex>`
 * (2026-10-06). The Agent Plugins screen's "Add a plugin" upload. Raw `application/zip` body, the
 * same transport `routes/plugins/install.ts` uses for site plugins; all install work is
 * `installUploadedAgentPlugin` (`features/agent-plugins/install-upload.ts`), which goes through
 * the one `installAgentPlugin` the bundled seed uses and leaves the plugin switched off.
 *
 * No local-install opt-in (the host's environment switch for site plugins), unlike site plugins: those packages run server code, while
 * nothing in an uploaded Agent Plugin runs (`trusted-plugin-files.ts` trusts bundled digests only).
 * Gated on `admin.plugins.enable`, the permission the enable switch beside it already needs.
 *
 * Answers 201 with the new row in `list.ts`'s shape, or 200 when the same bytes were already there.
 * Error bodies carry a code and a plain message; no host path ever reaches them.
 *
 * `AGENT_PLUGIN_UPDATE_ZIP` — `POST .../agent-plugins/:pluginId/update/zip?expectedSha256=&expectedOldDigest=`
 * (2026-10-21) shares this handler: the same upload checks, then `installUploadedAgentPlugin({ update })`,
 * which hands the candidate to the lifecycle owner's update transaction. `expectedOldDigest` is the
 * row's `archiveDigest` the operator saw; a changed, bundled, pending or downgraded plugin is a 409
 * with the owner's code. Answers 200 with the updated row and any compatibility warnings.
 *
 * w4-routes batch L: moved from the host's hand-written route to this raw spec; the `features/...` and
 * `routes/plugins/...` paths above are the host's (where the injected collaborators live). The zip
 * is read through `raw.readBody`, which reads nothing until called — after the workspace 404, the
 * session, the permission and the update target — so, as before, no unauthorized request gets its
 * body parsed. The host mounts it with `bufferedReply` (its `res.json` answer: `Content-Length`, ETag).
 */

/** One refusal: the HTTP status and the `{ code, error }` body sent with it. */
export interface AgentPluginInstallRefusal {
  readonly status: number;
  readonly body: { readonly code: string; readonly error: string };
}

/** Which installed revision an update replaces: the URL's plugin id and the digest the operator saw. */
export interface AgentPluginUpdateTarget {
  readonly pluginId: string;
  readonly expectedOldDigest: string;
}

/** A checked upload: the zip bytes, the digest the client computed, and whether to replace. */
export interface AgentPluginZipUpload {
  readonly archive: Uint8Array;
  readonly expectedSha256: string;
  readonly replace: boolean;
}

/** What the host's installer reports: the installed id, whether the bytes were already there, any warnings. */
export interface AgentPluginInstallOutcome {
  readonly pluginId: string;
  readonly alreadyInstalled: boolean;
  readonly warnings?: readonly string[];
}

/** The host collaborators the install/update spec needs. */
export interface AgentPluginInstallRouteDeps {
  /** The raw body cap in bytes (the installer's own archive ceiling). */
  readonly maxArchiveBytes: number;
  /** The Agent Plugins name grammar (`plugin.json` `name`), checked on the URL id before it names anything on disk. */
  readonly isPluginName: (required: { readonly value: string }) => boolean;
  /** Installs (or, with `update`, updates) the checked upload as `actor`. Throws the installer's errors. */
  readonly installUpload: (required: AgentPluginZipUpload & { readonly actor: string; readonly update?: AgentPluginUpdateTarget }) => Promise<AgentPluginInstallOutcome>;
  /** The installed plugin's row as the list route reports it, or null when the read model does not list it. */
  readonly installedRow: (required: { readonly pluginId: string }) => Promise<unknown>;
  /** The refusal for a body that could not be read (too large, compressed, truncated). */
  readonly bodyRefusal: (required: { readonly refusal: RouteBodyRefusal }) => AgentPluginInstallRefusal;
  /** The refusal for a known installer error; `undefined` leaves the error to the mount's redacted 500. */
  readonly installRefusal: (required: { readonly error: unknown }) => AgentPluginInstallRefusal | undefined;
}

/** The raw spec shape (structurally an http-kit `RawRouteSpec`); no server-framework type. */
export interface AgentPluginInstallRawRoute<Deps extends AgentPluginInstallRouteDeps = AgentPluginInstallRouteDeps> {
  readonly method: "post";
  readonly path: string;
  readonly bufferedReply: true;
  handle(
    required: { readonly raw: RawRouteInputContext; readonly deps: Deps; readonly context: AgentPluginRoutePrincipal | undefined; readonly authorize: JsonRouteAuthorize },
    optional: { readonly signal: AbortSignal },
  ): Promise<Response>;
}

const DIGEST = /^[a-f0-9]{64}$/;
const validation = (error: string): AgentPluginInstallRefusal => ({ status: 400, body: { code: "VALIDATION_ERROR", error } });
const DIGEST_REFUSAL = validation("expectedSha256 must be the file's lowercase hex SHA-256.");
const NOT_ZIP_REFUSAL = validation("An application/zip upload is required.");
const REPLACE_REFUSAL = validation("replace must be true or false.");
const PLUGIN_ID_REFUSAL = validation("pluginId is not a valid Agent Plugin id.");
const OLD_DIGEST_REFUSAL = validation("expectedOldDigest must be the installed revision's lowercase hex SHA-256.");

/** A JSON answer as the host's `res.status(s).json(body)` wrote it. @complexity O(n) in the body. */
function jsonReply({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

/** Whether `value` is a refusal rather than a checked value. @complexity O(1). */
function isRefusal(value: object): value is AgentPluginInstallRefusal {
  return "status" in value;
}

/**
 * Checks the query and reads the raw zip body, in this order: digest, content type, body, replace.
 * Runs only after authorization, so no unauthorized request gets its body parsed.
 * @complexity O(b) in body bytes, capped by `maxArchiveBytes`.
 */
async function readZipUpload({ raw, deps }: { raw: RawRouteInputContext; deps: AgentPluginInstallRouteDeps }): Promise<AgentPluginZipUpload | AgentPluginInstallRefusal> {
  const expectedSha256 = raw.query.expectedSha256;
  if (typeof expectedSha256 !== "string" || !DIGEST.test(expectedSha256)) return DIGEST_REFUSAL;
  // ZIP parsing follows authorization, as in `routes/plugins/install.ts`.
  const read = await raw.readBody({ type: "raw", mediaType: "application/zip", limit: deps.maxArchiveBytes });
  if (!read.ok) return read.refusal.reason === "media-type" ? NOT_ZIP_REFUSAL : deps.bodyRefusal({ refusal: read.refusal });
  const replace = raw.query.replace;
  if (replace !== undefined && replace !== "true" && replace !== "false") return REPLACE_REFUSAL;
  return { archive: read.value, expectedSha256, replace: replace === "true" };
}

/** The update target from the URL and query, or the refusal for a malformed one. A plain install
 *  has no target. Checked after authorization and before the body is read.
 *  @complexity O(1). */
function readUpdateTarget({ raw, deps }: { raw: RawRouteInputContext; deps: AgentPluginInstallRouteDeps }): { update?: AgentPluginUpdateTarget } | AgentPluginInstallRefusal {
  if (raw.params.pluginId === undefined) return {};
  const pluginId = raw.params.pluginId;
  // The Agent Plugins name grammar (`plugin.json` `name`), owned by Jini's manifest parser: the URL id
  // is checked against it before it names anything on disk.
  if (!deps.isPluginName({ value: pluginId })) return PLUGIN_ID_REFUSAL;
  const expectedOldDigest = raw.query.expectedOldDigest;
  if (typeof expectedOldDigest !== "string" || !DIGEST.test(expectedOldDigest)) return OLD_DIGEST_REFUSAL;
  return { update: { pluginId, expectedOldDigest } };
}

/** Target, body, install and the answer; a known installer error is its refusal, anything else is thrown. */
async function installOrRefuse({ raw, deps, actor }: { raw: RawRouteInputContext; deps: AgentPluginInstallRouteDeps; actor: string }): Promise<Response> {
  try {
    const target = readUpdateTarget({ raw, deps });
    if (isRefusal(target)) return jsonReply(target);
    const upload = await readZipUpload({ raw, deps });
    if (isRefusal(upload)) return jsonReply(upload);
    const result = await deps.installUpload({ ...upload, actor, ...target });
    const agentPlugin = await deps.installedRow({ pluginId: result.pluginId });
    // An update replaces an existing row, so it is never 201.
    const status = result.alreadyInstalled || target.update ? 200 : 201;
    return jsonReply({ status, body: { alreadyInstalled: result.alreadyInstalled, warnings: result.warnings ?? [], agentPlugin } });
  } catch (error) {
    // A 500 is redacted for the client, so the operator's log is the only place its cause survives:
    // the mount's failure path logs it (secret-redacted) under the errorId the reply carries.
    const refusal = deps.installRefusal({ error });
    if (!refusal) throw error;
    return jsonReply(refusal);
  }
}

/**
 * The shared handler: permission first (before any input check), then `installOrRefuse`.
 * @complexity O(b) in body bytes plus the injected installer.
 */
async function handleInstall({ raw, deps, context, authorize }: Parameters<AgentPluginInstallRawRoute["handle"]>[0]): Promise<Response> {
  const actor = agentPluginActorId({ context });
  await authorize({ permission: "admin.plugins.enable" });
  return installOrRefuse({ raw, deps, actor });
}

/** `AGENT_PLUGIN_INSTALL_ZIP`. */
export const agentPluginInstallZipRoute: AgentPluginInstallRawRoute = {
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/agent-plugins/install/zip",
  bufferedReply: true,
  handle: (required) => handleInstall(required),
};

/** `AGENT_PLUGIN_UPDATE_ZIP` — the same handler; the `:pluginId` segment makes it an update. */
export const agentPluginUpdateZipRoute: AgentPluginInstallRawRoute = {
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/agent-plugins/:pluginId/update/zip",
  bufferedReply: true,
  handle: (required) => handleInstall(required),
};
