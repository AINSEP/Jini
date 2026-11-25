import type { ArtifactStorePort } from "@jini-ai/core/contracts/site/devops-deploy";
import { createHash } from "node:crypto";
import { createConsoleLogger, type HttpClientPort, type HttpResponse, type Logger } from "@jini-ai/core/primitives";
import { SiteShareRefusal } from "./share-refusal.js";

/** A prepared share destination: where an artifact is stored, plus the binding a saved record must still match. */
export interface ShareDelivery { readonly provider: string; readonly binding?: string; readonly store: ArtifactStorePort }

/** The slice of a share registry this module reads and writes; the host's registry class satisfies it structurally. */
export interface ShareHostingRegistry {
  readonly directory: string;
  findToken(required: { token: string; file: string }): Promise<{ site: string; sha256: string } | null | undefined>;
  list(required: { site: string }): Promise<readonly { token: string; file: string; shareId: string; site: string }[]>;
  disable(required: { shareId: string; site: string }): Promise<unknown>;
  deleteArtifact(required: { shareId: string }): Promise<unknown>;
}

/** The connected peer's credential, as far as artifact paths and revocation need it. */
export interface SharePeerDeps { readonly credential: { readonly baseUrl: string; readonly remoteWorkspaceId: string } }

/** One request to the connected peer; the host's bound transport accepts this shape. */
export interface SharePeerRequest { method: "PUT" | "DELETE"; path: string; archive?: Uint8Array | undefined; signal?: AbortSignal | undefined }

/** Host values and collaborators the share hosting cannot own. */
export interface ShareHostingDeps<R extends ShareHostingRegistry, P extends SharePeerDeps> {
  /** The host's guarded outbound call to the connected peer. */
  callPeer: (required: { deps: P; request: SharePeerRequest }) => Promise<unknown>;
  /** Joins a peer base URL and path. */
  peerUrl: (required: { baseUrl: string; path: string }) => string;
  /** Records a received artifact in the registry; the one receiver for locally generated and management-uploaded artifacts. */
  receiveArtifact: (required: { registry: R; site: string; token: string; file: string; archive: Buffer }) => Promise<unknown>;
  /** Regex source of a share token (the token capture group of an artifact key). */
  tokenPattern: string;
  /** Regex source of an artifact file name (the file capture group of an artifact key). */
  artifactFilePattern: string;
  /** Provider id recorded for artifacts this server (or its connected peer) delivers itself. */
  serverProvider: string;
  /** Name of the operator setting holding the public origin, quoted in the refusal when it is invalid. */
  publicOriginSetting: string;
}

type ShareDeliverySources<P extends SharePeerDeps> = {
  peer: () => Promise<P | undefined>;
  http: HttpClientPort;
  objectStore: () => Promise<ShareDelivery | undefined>;
  runtime?: () => ShareDelivery;
  /** Where a skipped runtime delivery is reported; defaults to the console. */
  logger?: Pick<Logger, "warn">;
};
type SavedShareDelivery = { provider?: string | undefined; binding?: string | undefined };

/** The delivery constructors and selection a host binds once. */
export interface ShareHosting<R extends ShareHostingRegistry, P extends SharePeerDeps> {
  createRuntimeShareDelivery(required: { registry: R; site: string; publicOrigin: string; http: HttpClientPort }, optional?: Record<string, never>): ShareDelivery;
  createPeerShareDelivery(required: { peer: P; http: HttpClientPort }, optional?: Record<string, never>): ShareDelivery;
  resolveShareDelivery(required: ShareDeliverySources<P>, optional?: SavedShareDelivery): Promise<ShareDelivery | undefined>;
}

/** A 200 anonymous attachment of exactly `bytes`, served uncached, unsniffed and unindexed. */
function isPublicAttachment(required: { response: HttpResponse; bytes?: number | undefined }): boolean {
  const headers = new Headers(required.response.headers);
  if (required.response.status !== 200 || Number(headers.get("content-length")) !== required.bytes || headers.get("cache-control") !== "no-store") return false;
  return headers.get("x-content-type-options") === "nosniff" && headers.get("x-robots-tag") === "noindex, nofollow" && /^attachment(?:;|$)/i.test(headers.get("content-disposition") ?? "");
}

/** No saved binding accepts any delivery; a saved one must name this delivery's own binding. */
function bindingMatches(required: { saved?: string | undefined; actual?: string | undefined }): boolean {
  return required.saved === undefined || required.saved === required.actual;
}

/** The configured object-store delivery when its provider and binding match the saved ones. */
async function resolveObjectStoreDelivery<P extends SharePeerDeps>(required: ShareDeliverySources<P>, optional: SavedShareDelivery = {}): Promise<ShareDelivery | undefined> {
  try {
    const objectStore = await required.objectStore();
    if (!objectStore || (optional.provider && optional.provider !== objectStore.provider)) return undefined;
    return bindingMatches({ saved: optional.binding, actual: objectStore.binding }) ? objectStore : undefined;
  } catch { return undefined; } // Failed credential resolution still leaves a private ZIP download.
}

/** This server's runtime delivery; a misconfigured public origin leaves the object-store/ZIP fallback.
 * The warning carries the refusal code only: the configured origin may hold credentials. */
function runtimeDelivery<P extends SharePeerDeps>(required: ShareDeliverySources<P>): ShareDelivery | undefined {
  try { return required.runtime?.(); } catch (error) {
    const code = error instanceof SiteShareRefusal ? error.code : "UNEXPECTED";
    (required.logger ?? createConsoleLogger({ prefix: "" })).warn({ message: "[site-share] runtime share delivery is misconfigured; falling back to object storage or a private ZIP." }, { meta: { code } });
    return undefined;
  }
}

/** Builds the share delivery constructors and the delivery selection from host values and collaborators. */
export function createShareHosting<R extends ShareHostingRegistry, P extends SharePeerDeps>(deps: ShareHostingDeps<R, P>, _optional: Record<string, never> = {}): ShareHosting<R, P> {
  const artifactKey = new RegExp(`^_share/(${deps.tokenPattern})/(${deps.artifactFilePattern})$`);

  /** Validates a share artifact key and returns its token and file; refuses INVALID_INPUT otherwise. O(key). */
  function parseArtifactKey({ key }: { key: string }, _optional: Record<string, never> = {}): { token: string; file: string } {
    const match = artifactKey.exec(key);
    const [, token, file] = match ?? [];
    if (!token || !file) throw new SiteShareRefusal({ code: "INVALID_INPUT", message: "Invalid share artifact key." });
    return { token, file };
  }

  /** Both delivery variants verify through the same anonymous attachment contract. */
  async function verifyServerShare(required: { http: HttpClientPort; key: string; url: string; expectedUrl: string; present: boolean; bytes?: number | undefined }, optional: { signal?: AbortSignal | undefined } = {}): Promise<boolean> {
    parseArtifactKey({ key: required.key });
    if (required.url !== required.expectedUrl) return false;
    // Never send a destination credential to the anonymous download endpoint.
    const response = await required.http.send({ request: { method: "HEAD", url: required.url, headers: {}, idleTimeoutMs: 15_000, totalDeadlineMs: 20_000, maxResponseBytes: 1024, ...(optional.signal ? { signal: optional.signal } : {}) } }, { redirect: "error" });
    if (!required.present) return response.status === 404 || response.status === 410;
    return isPublicAttachment({ response, bytes: required.bytes });
  }

  /** Public origin is an explicit operator capability, never inferred from a local request Host. */
  function createRuntimeShareDelivery(required: { registry: R; site: string; publicOrigin: string; http: HttpClientPort }, _optional: Record<string, never> = {}): ShareDelivery {
    const origin = URL.parse(required.publicOrigin);
    const invalidOrigin = !origin || origin.protocol !== "https:" || origin.username || origin.password;
    if (invalidOrigin || origin.pathname !== "/" || origin.search || origin.hash) throw new SiteShareRefusal({ code: "STORAGE_SETUP", message: `${deps.publicOriginSetting} must be a public HTTPS origin without a path or credentials.` });
    const store: ArtifactStorePort = {
      async upload({ key, bytes }, _optional = {}) {
        const { token, file } = parseArtifactKey({ key });
        const existing = await required.registry.findToken({ token, file });
        if (existing && (existing.site !== required.site || existing.sha256 !== createHash("sha256").update(bytes).digest("hex"))) throw new SiteShareRefusal({ code: "ARTIFACT_CHANGED", message: "This token already names a different artifact." });
        if (!existing) await deps.receiveArtifact({ registry: required.registry, site: required.site, token, file, archive: Buffer.from(bytes) });
        return { url: `${origin.origin}/${key}` };
      },
      async delete({ key }, _optional = {}) {
        parseArtifactKey({ key });
        const row = (await required.registry.list({ site: required.site })).find(row => key === `_share/${row.token}/${row.file}`);
        if (!row) return;
        await required.registry.disable({ shareId: row.shareId, site: row.site });
        await required.registry.deleteArtifact({ shareId: row.shareId });
      },
      verify: (input, options = {}) => verifyServerShare({ ...input, http: required.http, expectedUrl: `${origin.origin}/${input.key}` }, options),
    };
    return { provider: deps.serverProvider, binding: required.registry.directory, store };
  }

  /** Connected deployment artifact adapter. Reuses publishing credentials and guarded transport;
   * the deployed receiver needs no environment opt-in. The base URL pins revocation to that site. */
  function createPeerShareDelivery(required: { peer: P; http: HttpClientPort }, _optional: Record<string, never> = {}): ShareDelivery {
    const baseUrl = required.peer.credential.baseUrl;
    const artifactPath = ({ key }: { key: string }, _optional: Record<string, never> = {}) => {
      const { token, file } = parseArtifactKey({ key });
      return `/api/admin/v1/workspaces/${encodeURIComponent(required.peer.credential.remoteWorkspaceId)}/site-shares/artifacts/${token}/${file}`;
    };
    return { provider: deps.serverProvider, binding: baseUrl, store: {
      async upload({ key, bytes }, options = {}) {
        await deps.callPeer({ deps: required.peer, request: { method: "PUT", path: artifactPath({ key }), archive: bytes, signal: options.signal } });
        return { url: deps.peerUrl({ baseUrl, path: `/${key}` }) };
      },
      async delete({ key }, options = {}) {
        // DELETE is idempotent, including after a previous successful remote cleanup.
        try { await deps.callPeer({ deps: required.peer, request: { method: "DELETE", path: artifactPath({ key }), signal: options.signal } }); }
        catch (error) { if ((error as { peerStatus?: number }).peerStatus !== 404) throw error; }
      },
      verify: (input, options = {}) => verifyServerShare({ ...input, http: required.http, expectedUrl: deps.peerUrl({ baseUrl, path: `/${input.key}` }) }, options),
    } };
  }

  /** The connected deployed peer, else this server's runtime delivery, when its binding matches. */
  async function resolveServerDelivery(required: ShareDeliverySources<P>, optional: SavedShareDelivery = {}): Promise<ShareDelivery | undefined> {
    try {
      const peer = await required.peer();
      if (peer && bindingMatches({ saved: optional.binding, actual: peer.credential.baseUrl })) return createPeerShareDelivery({ peer, http: required.http });
    } catch { /* An unavailable connection still permits the configured object-store/ZIP fallback. */ }
    const runtime = runtimeDelivery(required);
    return runtime && bindingMatches({ saved: optional.binding, actual: runtime.binding }) ? runtime : undefined;
  }

  /** Selection is shared by create and revoke: connected deployed peer, object store, then ZIP only.
   * A saved binding is mandatory on revoke; a changed default may never delete another site's ZIP. */
  async function resolveShareDelivery(required: ShareDeliverySources<P>, optional: SavedShareDelivery = {}): Promise<ShareDelivery | undefined> {
    if (!optional.provider || optional.provider === deps.serverProvider) {
      const server = await resolveServerDelivery(required, optional);
      if (server || optional.provider) return server;
    }
    // Any object-store provider exposing an artifact store may deliver (not one hard-coded vendor);
    // a saved provider must be the one the site's object store resolves to now.
    return resolveObjectStoreDelivery(required, optional);
  }

  return { createRuntimeShareDelivery, createPeerShareDelivery, resolveShareDelivery };
}
