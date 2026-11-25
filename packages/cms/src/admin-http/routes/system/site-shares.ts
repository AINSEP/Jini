import type { JsonRouteAuthorize, RawRouteInputContext, RouteBodyRefusal } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

/**
 * @file The admin site-share (export) routes under `…/workspaces/:workspaceId/site-shares`: export
 * history and creation, static export options and creation, acknowledgement, revocation, and the
 * connected-computer artifact upload/deletion. Server-neutral raw specs (K1 §9.3) so every answer keeps
 * the hand-written route's wire: `Cache-Control: no-store` on every outcome, the route's own
 * `{ code, message }` bodies with a fixed step label, and the upload body read only after the gates.
 *
 * Gate order (each spec): the host mount's workspace refusal → a connected-computer session refused on
 * admin operations → RBAC (or the publishing grant on the two artifact routes) → the backend's
 * availability → the route's own input. Every other failure — the backend's own refusals, unexpected
 * faults, upload parser refusals — is the host's `failureReply`, given the step label, so its copy,
 * statuses and incident reporting stay the host's. The ZIP download (a streamed file) and the saved-keys
 * password reveal are not here: they stay host routes.
 */

/** The backend calls the admin operations make. Method syntax on purpose: the host binds its own types. */
export interface SiteShareRouteBackend {
  list(required: Record<string, never>): Promise<unknown>;
  create(required: { principalId: string; signal: AbortSignal } & Record<string, unknown>): Promise<unknown>;
  staticOptions(required: Record<string, never>): Promise<unknown>;
  acknowledge(required: { shareId: string }): Promise<unknown>;
  revoke(required: { shareId: string }): Promise<unknown>;
  /** The expiry day counts the current share destination honours, besides Never; omitted means Never only. */
  expiryChoices?(required: Record<string, never>): Promise<readonly unknown[]>;
}

/** The principal fields these routes read. */
export interface SiteSharePrincipal { readonly id: string }

/** What one failure reply is given: the step label and the request facts the host's copy is derived from. */
export interface SiteShareFailureArgs {
  readonly error: unknown;
  readonly step: string;
  readonly method: string;
  readonly path: string;
  /** Whether the request carried an authenticated principal (details are disclosed only then). */
  readonly authenticated: boolean;
}

/** A body refusal of the artifact upload, handed to the host's `failureReply` for its own copy. */
export class SiteShareUploadRefusal extends Error {
  constructor(readonly refusal: RouteBodyRefusal) { super(`site share upload body refused: ${refusal.reason}`); }
}

/** What the host injects. Method syntax on purpose: the host binds its own principal and backend types. */
export interface SiteShareRouteDeps {
  readonly workspaceId: string;
  /** Read per request: the backend exists only with a site folder and private artifact storage. */
  backend(): SiteShareRouteBackend | undefined;
  /** Whether this request authenticated with a publishing (connected-computer) credential. */
  isPublishTrusted(required: { context: SiteSharePrincipal }): boolean;
  /** The create body (`{}` or `{ jobId }`); throws the host's input refusal. */
  readCreateInput(required: { body: unknown }): Record<string, unknown> & { jobId?: string; expiresInDays?: 7 | 30 | 90 | null };
  /** The static export body; throws the host's input refusal. */
  readStaticInput(required: { body: unknown }): Record<string, unknown> & { expiresInDays?: 7 | 30 | 90 | null };
  /** Whether `token`/`file` name a share artifact the host's registry accepts. */
  isArtifactIdentity(required: { token: string; file: string }): boolean;
  /** The host's refusal for an upload that is not a share artifact (identity, media type or bytes). */
  invalidArtifact(): unknown;
  /** Stores an uploaded artifact; tokens are never reused, so a replay is the host's refusal. */
  receiveArtifact(required: { backend: SiteShareRouteBackend; token: string; file: string; archive: Uint8Array }): Promise<{ shareId: string; bytes: number; sha256: string }>;
  /** Disables and deletes the artifact; `false` when no export carries that token and file. */
  removeArtifact(required: { backend: SiteShareRouteBackend; token: string; file: string }): Promise<boolean>;
  /** The host's failure answer: its refusals keep their status, anything else is a reported incident. */
  failureReply(required: SiteShareFailureArgs): { status: number; body: unknown };
  /** The upload's byte ceiling. */
  readonly maxArchiveBytes: number;
}

type SiteShareHandleArgs = { readonly raw: RawRouteInputContext; readonly deps: SiteShareRouteDeps; readonly context: SiteSharePrincipal | undefined; readonly authorize: JsonRouteAuthorize };

/** The server-neutral raw route (K1 §9.3), structurally an http-kit `RawRouteSpec`. */
export interface SiteShareRoute {
  readonly method: "get" | "post" | "put" | "delete";
  readonly path: string;
  readonly bufferedReply: true;
  readonly responseHeaders: Readonly<Record<string, string>>;
  handle(required: SiteShareHandleArgs, optional: { readonly signal: AbortSignal }): Promise<Response>;
}

/** Every outcome, including refusals and failures, is non-cacheable. */
const SITE_SHARE_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({ "Cache-Control": "no-store" });
const ROOT = "/api/admin/v1/workspaces/:workspaceId/site-shares";
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;

/** `res.json(body)`'s bytes and type. @complexity O(n) in the body. */
function jsonReply({ status, body }: { status: number; body: unknown }, _optional: Record<string, never> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

/** One route's work once its gates passed. */
type SiteShareWork = (required: SiteShareHandleArgs & { backend: SiteShareRouteBackend; principal: SiteSharePrincipal | undefined }) => Promise<Response>;

/** Connected-computer session, RBAC (or the publishing grant), then backend availability.
 * @returns The backend, or the refusal to answer. A denial throws the mount's refusal.
 * @complexity O(1) plus the injected authorizer. */
async function gate(
  { deps, context, authorize, step, artifact }: Omit<SiteShareHandleArgs, "raw"> & { step: string; artifact: boolean },
  _optional: Record<string, never> = {},
): Promise<SiteShareRouteBackend | Response> {
  const trusted = context ? deps.isPublishTrusted({ context }) : false;
  // Only the two artifact routes admit connected-computer sessions; admin operations keep RBAC.
  if (trusted && !artifact) return jsonReply({ status: 403, body: { code: "FORBIDDEN", message: `${step} requires an authorized admin session.` } });
  await authorize({ permission: trusted ? "publish_content.apply" : "site-backup.push", entityType: "site-backup" });
  const backend = deps.backend();
  if (!backend) return jsonReply({ status: 503, body: { code: "UNAVAILABLE", message: `${step} requires a site folder and private artifact storage.` } });
  return backend;
}

/** A spec: the gates, then the route's work; any failure but the mount's own refusal is the host's reply.
 * @complexity O(1) plus the route's work. */
function siteShareRoute(
  { method, path, step, artifact = false, work }: { method: SiteShareRoute["method"]; path: string; step: string; artifact?: boolean; work: SiteShareWork },
  _optional: Record<string, never> = {},
): SiteShareRoute {
  return {
    method, path, bufferedReply: true, responseHeaders: SITE_SHARE_RESPONSE_HEADERS,
    handle: async (args) => {
      try {
        const backend = await gate({ ...args, step, artifact });
        if (backend instanceof Response) return backend;
        return await work({ ...args, backend, principal: args.context });
      } catch (error) {
        // The RBAC denial is the mount's own 403, written by its error port.
        if (error instanceof RouteRefusalError) throw error;
        return jsonReply(args.deps.failureReply({ error, step, method: method.toUpperCase(), path, authenticated: args.context !== undefined }));
      }
    },
  };
}

/** The principal id the backend records; the session read fails closed like the gate's. @complexity O(1). */
function principalId({ principal }: { principal: SiteSharePrincipal | undefined }, _optional: Record<string, never> = {}): string {
  if (!principal) throw new Error("site share route reached its work without an authenticated principal");
  return principal.id;
}

/**
 * The list's `expiryChoices`: `null` (Never) first, then the host's whole positive day counts.
 * Why Never is always present and first: it is the default every destination accepts, so an existing
 * link keeps working and a client that picks nothing sends no expiry; a host value that is not a whole
 * positive day count is dropped rather than guessed. @complexity O(choices).
 */
async function listExpiryChoices({ backend }: { backend: SiteShareRouteBackend }, _optional: Record<string, never> = {}): Promise<readonly (number | null)[]> {
  const offered = (await backend.expiryChoices?.({})) ?? [];
  const days = offered.filter((value): value is number => Number.isInteger(value) && (value as number) > 0);
  return [null, ...days];
}

/** `GET …/site-shares`: the export history plus the expiry choices a new export may ask for. */
export const siteShareListRoute: SiteShareRoute = siteShareRoute({
  method: "get", path: ROOT, step: "Export history",
  work: async ({ backend }) => jsonReply({ status: 200, body: { shares: await backend.list({}), expiryChoices: await listExpiryChoices({ backend }) } }),
});

/** `POST …/site-shares`: start an export, or poll one with `{ jobId }`. */
export const siteShareCreateRoute: SiteShareRoute = siteShareRoute({
  method: "post", path: ROOT, step: "Export creation",
  work: async ({ raw, deps, backend, principal }) => {
    const parsed = deps.readCreateInput({ body: raw.body });
    // Job polls cannot change the lifetime promised by the initial create.
    const input = typeof parsed.jobId === "string" ? { jobId: parsed.jobId } : parsed;
    return jsonReply({ status: 200, body: await backend.create({ principalId: principalId({ principal }), signal: new AbortController().signal, ...input }) });
  },
});

/** `GET …/site-shares/static/options`. */
export const siteShareStaticOptionsRoute: SiteShareRoute = siteShareRoute({
  method: "get", path: `${ROOT}/static/options`, step: "Static export options",
  work: async ({ backend }) => jsonReply({ status: 200, body: await backend.staticOptions({}) }),
});

/** `POST …/site-shares/static`. */
export const siteShareStaticCreateRoute: SiteShareRoute = siteShareRoute({
  method: "post", path: `${ROOT}/static`, step: "Static export creation",
  work: async ({ raw, deps, backend, principal }) => {
    const input = deps.readStaticInput({ body: raw.body });
    return jsonReply({ status: 200, body: await backend.create({ principalId: principalId({ principal }), signal: new AbortController().signal, format: "static", ...input }) });
  },
});

/** `POST …/site-shares/:shareId/acknowledge`. */
export const siteShareAcknowledgeRoute: SiteShareRoute = siteShareRoute({
  method: "post", path: `${ROOT}/:shareId/acknowledge`, step: "Export acknowledgement",
  work: async ({ raw, backend }) => jsonReply({ status: 200, body: await backend.acknowledge({ shareId: String(raw.params.shareId) }) }),
});

/** `DELETE …/site-shares/:shareId`. The host registers it after its download route (pinned route order). */
export const siteShareRevokeRoute: SiteShareRoute = siteShareRoute({
  method: "delete", path: `${ROOT}/:shareId`, step: "Export revocation",
  work: async ({ raw, backend }) => jsonReply({ status: 200, body: await backend.revoke({ shareId: String(raw.params.shareId) }) }),
});

/** Whether the bytes start with a ZIP local file header. @complexity O(1). */
function isZipArchive({ value }: { value: Uint8Array }, _optional: Record<string, never> = {}): boolean {
  if (value.length < 4) return false;
  return new DataView(value.buffer, value.byteOffset, 4).getUint32(0, true) === ZIP_LOCAL_FILE_HEADER;
}

/** The upload body, read after the gates; a media-type mismatch is an invalid artifact, not a parser refusal.
 * @complexity O(n) in the body bytes, bounded by `maxArchiveBytes`. */
async function readArchive({ raw, deps }: Pick<SiteShareHandleArgs, "raw" | "deps">, _optional: Record<string, never> = {}): Promise<Uint8Array | undefined> {
  // Raw ZIP parsing runs AFTER authentication and authorization. A base64 JSON upload would
  // inflate a 300 MiB cap and duplicate the full buffer before we could validate it.
  const read = await raw.readBody({ type: "raw", mediaType: "application/zip", limit: deps.maxArchiveBytes });
  if (read.ok) return read.value;
  // Not an application/zip body: the parser leaves the request body as it was, so bytes an earlier
  // host parser already read still count, exactly as the parser registered on the route left them.
  if (read.refusal.reason === "media-type") return raw.body instanceof Uint8Array ? raw.body : undefined;
  throw new SiteShareUploadRefusal(read.refusal);
}

/** `PUT …/site-shares/artifacts/:token/:file`: a connected computer's (or an admin's) ZIP upload. */
export const siteShareArtifactUploadRoute: SiteShareRoute = siteShareRoute({
  method: "put", path: `${ROOT}/artifacts/:token/:file`, step: "Share artifact upload", artifact: true,
  work: async ({ raw, deps }) => {
    const archive = await readArchive({ raw, deps });
    const token = String(raw.params.token), file = String(raw.params.file);
    if (!deps.isArtifactIdentity({ token, file }) || !archive || !isZipArchive({ value: archive })) throw deps.invalidArtifact();
    const backend = deps.backend();
    if (!backend) throw new Error("site share artifact upload has no share backend");
    // Tokens are never reused, including revoked uploads. A replay may not resurrect access.
    const row = await deps.receiveArtifact({ backend, token, file, archive });
    return jsonReply({ status: 201, body: { shareId: row.shareId, bytes: row.bytes, sha256: row.sha256 } });
  },
});

/** `DELETE …/site-shares/artifacts/:token/:file`: answers a bodiless 204 once the artifact is disabled. */
export const siteShareArtifactDeleteRoute: SiteShareRoute = siteShareRoute({
  method: "delete", path: `${ROOT}/artifacts/:token/:file`, step: "Share artifact deletion", artifact: true,
  work: async ({ raw, deps, backend }) => {
    const removed = await deps.removeArtifact({ backend, token: String(raw.params.token), file: String(raw.params.file) });
    if (!removed) return jsonReply({ status: 404, body: { code: "NOT_FOUND", message: "Share artifact deletion failed: this export was not found." } });
    return new Response(null, { status: 204 });
  },
});
