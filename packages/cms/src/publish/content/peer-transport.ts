import { describeErrorForLog } from "@jini-ai/core/model-facing-tool-errors";
import { nowIso, type Clock, type HttpRequest, type HttpResponse } from "@jini-ai/core/primitives";
import { bytesMatchSha256 } from "../transfer/blob-staging.js";
import { PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION, type PackedEntity } from "../transfer/index.js";
import { peerHostname, peerUrl } from "./peer-url.js";
import type { PublishContentExportEnvelope } from "./export-bundle.js";

/**
 * @file Task 10 of the publish-content (Publish Content) feature —
 * `ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md` §1.6/§4 task 10.
 *
 * The outbound leg: this instance dialling ANOTHER instance's publish-content routes over the guarded
 * ADR-038 `HttpClientPort` (structurally {@link PeerHttpClient}). Two directions, one importer:
 *
 * - PUSH ({@link pushBundleToPeer} -> {@link confirmPeerImport} -> {@link executePeerImport}):
 *   builds a bundle here, uploads the blobs the peer is missing, stages it there, then drives the
 *   peer's OWN gated `plan`/`confirm`/`execute` ceremony. Every safety property (PLAN_STALE,
 *   single-redemption tokens, "an agent may never confirm", the restore point) is enforced on the
 *   DESTINATION, by the code that owns the destination's data — this driver only relays.
 * - PULL ({@link pullBundleFromPeer}): fetches the peer's export envelope and stages it HERE, so
 *   this instance's own already-built `/import/plan|confirm|execute` runs `planImport` against it.
 *   One importer, two directions — a pull adds no second classification path.
 *
 * ## Vendor neutrality (plan §0b — this file is the one place Task 10 could regress it)
 *
 * A peer is a URL plus a sealed key. Nothing here knows or asks what runs underneath: no app name,
 * no project id, no region, no platform API, and no reference to any single host's CLI or config
 * file. (Stated in the abstract deliberately: plan §0b's own guard is a grep for those literal
 * platform tokens across this directory, and a comment naming them to disclaim them would trip it.)
 * The private-network question is not answered with a single-host-shaped assumption either — it is
 * delegated whole to ADR-038's `EgressPolicy.denyPrivateAddresses` + `devHostAllowlist`, which
 * classify the RESOLVED address, so Railway's and Render's internal DNS names and an AWS VPC
 * address are handled by exactly the same code path with no per-platform branch.
 *
 * ## The credential
 *
 * The opened key exists only as the `Authorization` header of one in-flight request. It is never
 * logged, never placed in a URL (`HttpClientPort` rejects credentials-in-URL outright), never
 * returned in a result, and never interpolated into an error message — {@link toTransportError} is
 * the single funnel for request failures. Diagnostics use fixed local text and HTTP status, never
 * upstream messages or bodies that could echo the credential. `client.ts` additionally strips `Authorization` on any cross-origin redirect,
 * and this feature's policy sets `maxRedirects: 0` so there is no redirect hop at all.
 */

/** The host's secret-shape redactor. REQUIRED, never defaulted: the engine knows no host key
 *  prefix, so only the host can name every credential shape its peers might echo back. */
export type PeerTextRedactor = (required: { text: string }) => { text: string };

/** The one field this module reads from a host egress refusal: its caller-safe sentence. */
export interface PeerEgressRefusal {
  readonly callerSafeMessage: string;
}

/** Everything host-specific the transport needs, bound once by {@link createPeerTransport}. */
export interface PeerTransportHost<K extends string = string> {
  /** Applied to every operator-facing message this module produces. */
  readonly redact: PeerTextRedactor;
  /** Recognises the host egress guard's refusal (else `undefined`), see {@link describePeerEgressRefusal}. */
  readonly asEgressRefusal: (required: { err: unknown }) => PeerEgressRefusal | undefined;
  /** The deployment setting that feeds the egress policy's `devHostAllowlist`. */
  readonly devHostsSetting: string;
  /** The product name a peer is expected to run, used in "is this a ... instance?" diagnostics. */
  readonly productName: string;
  /** The history row kind recorded for a completed peer apply. */
  readonly history: { readonly kind: K };
}

/** The guarded HTTP client seam (the host's ADR-038 `HttpClientPort`, structurally). */
export interface PeerHttpClient {
  send(request: HttpRequest, options?: { redirect?: "follow" | "error" | "manual" }): Promise<HttpResponse>;
}

/** An opened peer credential: in memory only, for the lifetime of one outbound request. */
export interface PeerTransportCredential {
  readonly id: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly remoteWorkspaceId: string;
  /** The opened API key. In memory only, for the lifetime of one outbound request. */
  readonly apiKey: string;
}

/** Machine-readable failure classes a peer call can produce. Distinct codes, because a route maps
 *  each to a different HTTP status and an operator acts on each differently. */
export type PeerTransportErrorCode =
  | "EGRESS_REFUSED"
  | "PEER_UNREACHABLE"
  | "PEER_REJECTED"
  | "PEER_RESPONSE_INVALID"
  /** The operator ticked "Overwrite on live" but the peer doesn't advertise `"overwrite-live"`. */
  | "PEER_CANNOT_OVERWRITE";

/** The single error type every failure in this module surfaces as. `message` is operator-facing:
 *  fixed local diagnostics omit upstream error text; the shared redactor also scrubs secret-shaped
 *  values from route/host context. */
export class PublishContentPeerTransportError extends Error {
  readonly code: PeerTransportErrorCode;
  /** The peer's HTTP status, when there was one. Absent for a refusal or an unreachable host. */
  readonly peerStatus?: number;

  constructor(
    { message, code, redact }: { message: string; code: PeerTransportErrorCode; redact: PeerTextRedactor },
    options: { peerStatus?: number } = {}
  ) {
    super(redact({ text: message }).text);
    this.name = "PublishContentPeerTransportError";
    this.code = code;
    if (options.peerStatus !== undefined) this.peerStatus = options.peerStatus;
  }
}

// A peer's error text can be useful, but another process may echo our Authorization header.
// Keep diagnostics local and fixed: even a bounded excerpt or shape redaction can leak an opaque key.

/**
 * Turns an `EgressRefusedError` into the operator diagnosis this task's brief requires: a message
 * that NAMES `devHostAllowlist` and the exact hostname to add, rather than reading as a generic
 * network error.
 *
 * Why every refusal reaching here is a private-address refusal, by construction — this is the
 * reasoning that lets this function state the cause instead of pattern-matching the message text
 * (which would be fragile and would silently degrade if the wording changed):
 * `client.ts`'s `assertAllowedTarget` refuses exactly three things — a scheme outside
 * `allowedSchemes`, credentials embedded in the URL, and (via `assertNoPrivateAddress`) a
 * non-public resolved address. `normalizePeerBaseUrl` has already refused a non-https URL and a
 * URL carrying userinfo before any peer row could be written, and the peer policy sets
 * `maxRedirects: 0`, so no redirect hop can introduce either. Only the third refusal is reachable.
 *
 * The underlying error's own `callerSafeMessage` is used, never `message`: `message` names the
 * resolved ADDRESS, and echoing that to an operator-facing surface lets a caller who can name any
 * host map internal DNS one request at a time (`errors.ts`'s own reasoning).
 *
 * @complexity O(n) in the base URL length.
 */
function describePeerEgressRefusal(
  { err, baseUrl, host }: { err: PeerEgressRefusal; baseUrl: string; host: PeerTransportHost },
  _optional = {}
): PublishContentPeerTransportError {
  const hostname = peerHostname({ baseUrl });
  return new PublishContentPeerTransportError({ message: `${err.callerSafeMessage}. '${hostname}' resolves to a private address, so this peer is unreachable ` +
      `until it is added to this deployment's EgressPolicy devHostAllowlist ` +
      `(${host.devHostsSetting}, a comma-separated list of hostnames — add '${hostname}'). ` +
      `This is a deliberate SSRF guard, not a network fault.`, code: "EGRESS_REFUSED", redact: host.redact });
}

/**
 * The single funnel every peer-call failure passes through.
 *
 * @complexity O(n) in the base URL and resulting diagnostic length, including shared redaction.
 */
function toTransportError(
  { err, baseUrl, host }: { err: unknown; baseUrl: string; host: PeerTransportHost },
  _options = {}
): PublishContentPeerTransportError {
  if (err instanceof PublishContentPeerTransportError) return err;
  const refusal = host.asEgressRefusal({ err });
  if (refusal) return describePeerEgressRefusal({ err: refusal, baseUrl, host });
  return new PublishContentPeerTransportError({ message: `the peer at '${peerHostname({ baseUrl })}' could not be reached.${peerNetworkReason({ err })}`, code: "PEER_UNREACHABLE", redact: host.redact });
}

const PEER_NETWORK_REASONS = new Map<string, string>([
  ["ECONNREFUSED", " The peer refused the connection; check that it is running and reachable."],
  ...["ENOTFOUND", "EAI_AGAIN"].map(code => [code, " The peer's hostname could not be resolved; check its address and DNS."] as const),
  ...["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].map(code => [code, " The connection timed out; check the peer and try again."] as const),
  ...["CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID"]
    .map(code => [code, " The peer's TLS certificate could not be verified; repair its certificate before trying again."] as const),
]);

/** Classify local network codes without exposing messages or credential-bearing causes.
 * @complexity O(1), inspecting at most the error and its immediate cause. */
function peerNetworkReason({ err }: { err: unknown }, _options = {}): string {
  if (typeof err !== "object" || err === null) return "";
  const cause = "cause" in err ? err.cause : undefined;
  const code = "code" in err ? err.code : peerCauseCode({ cause });
  return typeof code === "string" ? PEER_NETWORK_REASONS.get(code) ?? "" : "";
}

/** Inspect only the immediate cause; messages and deeper causes never supply diagnostics. */
function peerCauseCode({ cause }: { cause: unknown }, _options: Record<string, never> = {}): unknown {
  return typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined;
}

const PEER_REFUSAL_REASONS = new Map<unknown, string>([
  ["WORKSPACE_NOT_FOUND", "The destination workspace was not found; check the peer's workspace setting."],
  ["PAYLOAD_TOO_LARGE", "The transfer exceeds the peer's size limit; publish a smaller selection."],
  ["PLAN_STALE", "The destination changed since the plan was checked; check what would change again."],
  ["TOKEN_EXPIRED", "The confirmation expired; check and confirm the publish again."],
  ["TOKEN_ALREADY_REDEEMED", "This confirmation was already used; check the publish result before trying again."],
  ["RESTORE_POINT_UNAVAILABLE", "The peer could not create a restore point; repair its backup storage before publishing."],
  ["BUNDLE_NOT_FOUND", "The staged bundle was not found on the peer; send the selection again."],
]);

/** Keep a live incident id alongside safe typed guidance; never echo unknown server errors.
 * Legacy workspace refusals have no code, so only their exact fixed sentinel is recognised.
 * @complexity O(body bytes), one JSON parse and constant-time map lookups. */
function peerRefusalReason({ status, bodyText }: { status: number; bodyText: string }, _options = {}): string | undefined {
  let reason = status === 413 ? PEER_REFUSAL_REASONS.get("PAYLOAD_TOO_LARGE") : undefined;
  if (status === 409) reason = "The peer reported a conflict; check what would change again before retrying.";
  try {
    const body: unknown = JSON.parse(bodyText);
    reason = peerBodyRefusalReason({ status, body }) ?? reason;
    const errorId = peerIncidentId({ body });
    return [reason, errorId].filter(Boolean).join(" ") || undefined;
  } catch {
    // Proxies may return HTML or an empty body; the HTTP status still provides safe guidance.
  }
  return reason;
}

/** UUIDs are the incident envelope contract; do not turn an arbitrary peer field into prose. */
function peerIncidentId({ body }: { body: unknown }, _options = {}): string | undefined {
  if (typeof body !== "object" || body === null || !("errorId" in body)) return undefined;
  if (typeof body.errorId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.errorId)) return undefined;
  return `(error id ${body.errorId})`;
}

/** Prefer a recognised code to the exact legacy sentinel; upstream prose is never returned. */
function peerBodyRefusalReason(
  { status, body }: { status: number; body: unknown },
  _options: Record<string, never> = {}
): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const storageReason = peerStorageRefusalReason({ body });
  if (storageReason) return storageReason;
  if ("code" in body) {
    const reason = PEER_REFUSAL_REASONS.get(body.code);
    if (reason) return reason;
  }
  if (status === 404 && "error" in body && body.error === "workspace was not found") {
    return PEER_REFUSAL_REASONS.get("WORKSPACE_NOT_FOUND");
  }
  return undefined;
}

/** The disk refusal's closed grammar carries operator detail without accepting arbitrary peer prose. */
function peerStorageRefusalReason({ body }: { body: object }, _options = {}): string | undefined {
  if (!("code" in body) || body.code !== "INSUFFICIENT_STORAGE") return undefined;
  if (!("error" in body) || typeof body.error !== "string") return undefined;
  return /^The server's disk is almost full \(\d+ MB free, needs \d+ MB\) — free space or grow the disk\.$/.test(body.error) ? body.error : undefined;
}

/** Per-request timeout for a peer call. A bundle POST is the slow one; 60 s is generous for an API
 *  call and still bounded, so a wedged peer cannot hold an admin request open indefinitely. */
export const PEER_REQUEST_TIMEOUT_MS = 60_000;

/** The narrow blob-read seam the push driver needs — `BlobStorePort`'s read half only, so this
 *  module can never write a blob.
 *
 *  `sha256` joined `storageKey` on both methods (`publish-files-plan-2026-09-24.md` §3, S-F3): a
 *  plain `BlobStorePort` only ever needs `storageKey` and structurally still satisfies this widened
 *  shape (TypeScript checks method-shorthand interface members bivariantly, so a `{storageKey}`-only
 *  implementation is assignable here without change) — `composite-blob-source.ts`'s own
 *  `createCompositePeerBlobSource` is the one implementation that actually reads `sha256`, to fall
 *  back to a `FileBlobIndexPort` lookup and re-verify the bytes it finds there hash to the value the
 *  caller is asking for. Both callers below already have the plain sha in scope when they call these
 *  methods, so passing it through costs nothing. */
export interface PeerBlobSource {
  exists(input: { sha256: string; storageKey: string }, optional?: {}): Promise<boolean>;
  get(input: { sha256: string; storageKey: string }, optional?: {}): Promise<Uint8Array>;
}

/** Who started a peer publish; the same two literals the deployments history ledger stores. */
export type PeerPublishTrigger = "admin_ui" | "agent_tool";

/** The one history call a peer publish makes (executePeerImport). Composition passes the deployments
 *  history store, and `tsc` checks it against this shape where it is assigned.
 *
 *  `K` is the host's row kind ({@link PeerTransportHost.history}). It defaults to `never` so a host
 *  store whose `recordSuccess` accepts its own closed kind union stays assignable where the kind is
 *  not named (method parameters are compared bivariantly); a bound transport narrows it to the
 *  host's literal. */
export interface PublishHistoryRecorder<K extends string = never> {
  recordSuccess(input: { workspaceId: string; entry: {
    readonly kind: K; readonly target: string; readonly projectName: string; readonly url: string;
    readonly configFields: Readonly<Record<string, string>>; readonly reachable: boolean; readonly status: string;
    readonly publishedAt: string; readonly triggeredBy: PeerPublishTrigger;
  } }): Promise<void>;
}

/** `K`: the host history row kind; see {@link PublishHistoryRecorder}. */
export interface PeerCallDeps<K extends string = never> {
  readonly httpClient: PeerHttpClient;
  readonly credential: PeerTransportCredential;
  /** Local source scope, never the peer's remote workspace. Optional for transport-only consumers. */
  readonly publishHistory?: { store: PublishHistoryRecorder<K>; workspaceId: string; clock: Clock; triggeredBy?: PeerPublishTrigger };
}

/** Internal: {@link PeerCallDeps} once {@link createPeerTransport} has bound the host. */
type HostedPeerDeps = PeerCallDeps<string> & { readonly host: PeerTransportHost };

/** One request to a peer route; see {@link callPeer}. */
export interface PeerRequest {
  method: "GET" | "POST" | "PUT" | "DELETE"; path: string; body?: unknown; archive?: Uint8Array; signal?: AbortSignal;
}

/** Local storage key for a sha256, used by both blob legs. */
export type ComputeStorageKey = (required: { sha256: string }, optional?: Record<string, never>) => string;

/** The extra deps the push leg reads blobs through. */
export interface PeerPushSources {
  blobSource: PeerBlobSource;
  computeStorageKey: ComputeStorageKey;
}

/** The extra deps the pull leg writes blobs through; see {@link pullBlobsFromPeer}. */
export interface PeerPullSinks {
  blobSink: PeerBlobSink;
  workspaceId: string;
  computeStorageKey: ComputeStorageKey;
  maxBlobs?: number;
}

/**
 * One authenticated call to a peer route; share uploads reuse this credential/egress owner.
 *
 * @param path - An absolute route path on the peer, already carrying the peer's OWN workspace id.
 * @returns The parsed JSON body.
 * @throws {PublishContentPeerTransportError} for every failure class — see {@link toTransportError}.
 * @complexity O(1) plus one network round trip and one JSON parse of the response.
 */
async function callPeer(
  { deps, request }: { deps: HostedPeerDeps; request: PeerRequest },
  _optional = {}
): Promise<unknown> {
  const { baseUrl, apiKey } = deps.credential;
  let response;
  try {
    const payload = peerRequestPayload({ request });
    response = await deps.httpClient.send({
      method: request.method,
      url: peerUrl({ baseUrl, path: request.path }),
      headers: {
        // The ONE place the resolved credential is used, and it is deliberately incurious about
        // which kind it got. Two reach here (`features/publish-content/destination-credential.ts`):
        // an explicitly-configured peer's API key, which `dev-auth.ts`'s
        // `API_KEY_AUTHORIZATION_PATTERN` accepts as `Bearer <raw-key>` and whose grants come from
        // its own issuance snapshot (plan §1.2); and a connected destination's short-lived
        // publishing session token, which the destination's `requirePublishTrust` gate recognises
        // ahead of the admin session gate. Both are `Bearer <opaque>` on the wire, so there is
        // still no transport-specific auth mechanism here to get wrong.
        authorization: `Bearer ${apiKey}`,
        ...payload.headers,
      },
      ...payload.content,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      timeoutMs: PEER_REQUEST_TIMEOUT_MS,
      // Publishing can carry a 96 MB bundle. Keep the feature's intended 60 s
      // total budget explicit; the egress policy's 30 s limit is socket inactivity.
      totalDeadlineMs: PEER_REQUEST_TIMEOUT_MS,
    });
  } catch (err) {
    throw toTransportError({ err, baseUrl, host: deps.host });
  }

  if (response.status < 200 || response.status >= 300) {
    const reason = peerRefusalReason({ status: response.status, bodyText: response.bodyText });
    const reasonSuffix = reason ? `. ${reason}` : "";
    const message = isCredentialKindRefusal({ status: response.status, bodyText: response.bodyText })
      ? credentialKindRefusalMessage({ baseUrl })
      : `the peer refused ${request.method} ${request.path} with HTTP ${response.status}${reasonSuffix}`;
    throw new PublishContentPeerTransportError({ message, code: "PEER_REJECTED", redact: deps.host.redact }, { peerStatus: response.status });
  }

  if (response.status === 204) return undefined;
  try {
    return JSON.parse(response.bodyText);
  } catch {
    throw new PublishContentPeerTransportError({ message: `the peer's response to ${request.method} ${request.path} was not JSON — is '${peerHostname({ baseUrl })}' a ${deps.host.productName} instance?`, code: "PEER_RESPONSE_INVALID", redact: deps.host.redact });
  }
}

/**
 * Whether a peer refusal is live's 403 `credential_kind_not_permitted` — on the publish-content
 * routes, only `/import/plan` and `/import/execute` send it, for "Overwrite on live" ticks that
 * arrived under a saved API key (`routes/publish-content/import.ts`'s `mayOverwrite`). A connected
 * computer's publishing session token is never refused this way.
 * @complexity O(n) in the body length (one JSON parse).
 */
function isCredentialKindRefusal({ status, bodyText }: { status: number; bodyText: string }, _optional = {}): boolean {
  if (status !== 403) return false;
  try {
    const body = JSON.parse(bodyText) as { details?: { reason?: unknown } } | null;
    return body?.details?.reason === "credential_kind_not_permitted";
  } catch {
    return false;
  }
}

/** The operator's sentence for {@link isCredentialKindRefusal}, in place of the raw JSON body.
 *  @complexity O(1). */
function credentialKindRefusalMessage({ baseUrl }: { baseUrl: string }, _optional = {}): string {
  return (
    `${baseUrl} only accepts "Overwrite on live" from a computer connected to it, not from a saved API key. ` +
    `Connect this computer to ${baseUrl}, then publish again.`
  );
}

/** Builds a peer route path under the peer's OWN workspace id. Never this instance's — a peer's
 *  workspace id is stored on the row precisely because the two are unrelated identifiers.
 *  @complexity O(1). */
function peerRoute({ credential, suffix }: { credential: PeerTransportCredential; suffix: string }, _optional = {}): string {
  return `/api/admin/v1/workspaces/${encodeURIComponent(credential.remoteWorkspaceId)}/publish-content${suffix}`;
}

/** @complexity O(1). */
function requireObject(
  { value, what, baseUrl, host }: { value: unknown; what: string; baseUrl: string; host: PeerTransportHost },
  _optional = {}
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PublishContentPeerTransportError({ message: `the peer's ${what} response was not an object — is '${peerHostname({ baseUrl })}' a ${host.productName} instance?`, code: "PEER_RESPONSE_INVALID", redact: host.redact });
  }
  return value as Record<string, unknown>;
}

/** One entity type this bundle held that the peer's own S-F1 capability probe said it cannot
 *  accept — see {@link PushBundleResult.notSupportedByLive}. */
export interface NotSupportedByLiveEntry {
  readonly entityType: string;
  readonly count: number;
}

export interface PushBundleResult {
  /** The bundle id the PEER minted for the staged bundle — required again at execute. */
  readonly bundleId: string;
  /** Blob sha256s actually uploaded on this push (the peer already had the rest). */
  readonly blobsUploaded: readonly string[];
  /** Blob sha256s the peer was missing and this instance does not hold either — every entity that
   *  requires one will be `blocked` by the peer's own planner, which is the fail-closed outcome. */
  readonly blobsUnavailable: readonly string[];
  /** The peer's gated plan, verbatim — `{domain, planId, planHash, details}`. `details` is the
   *  `PublishContentReport` the operator's confirm decision is made against. */
  readonly plan: Record<string, unknown>;
  /** Entity types this bundle held that {@link pushBundleToPeer}'s own capability probe found the
   *  peer cannot accept (an older instance, or a grant that has not opted into that type yet), grouped
   *  with a count. Their entities were removed from the bundle BEFORE anything was staged or
   *  uploaded — never sent, never counted in {@link blobsUploaded}/{@link blobsUnavailable}, and
   *  never appearing as a row in `plan`. Empty when the peer accepted every type, or when the
   *  bundle carried no entities at all (the probe is skipped entirely in that case — see
   *  {@link pushBundleToPeer}). */
  readonly notSupportedByLive: readonly NotSupportedByLiveEntry[];
  /** publish-overwrite-live-plan §4/S7 — whether the peer's own capabilities probe reported the
   *  `"overwrite-live"` feature (`capabilities.ts`'s S6 addition). `false` for an older peer whose
   *  `/capabilities` response carries no `features` array, and `false` also when the probe was
   *  skipped because the bundle carried no entities (see {@link notSupportedByLive}) — there is
   *  nothing to overwrite in that case anyway. The admin dialog and the chat tool (S8/S9) read this
   *  to decide whether to offer any "Overwrite on live" tick at all. Non-empty
   *  `overwriteEntityKeys` sent to a peer without the feature are refused with
   *  `PEER_CANNOT_OVERWRITE` before anything is staged: that peer would silently ignore them. */
  readonly liveCanOverwrite: boolean;
}

/** The fixed set every peer predating S-F1's `/capabilities` route accepts — `bundle-create.ts`'s
 *  original `deploy/publish-trust.json` grant, before `theme-files`/`redirect`/anything newer ever
 *  existed. Used only when the probe below reads an ordinary 404: a peer that old never claimed to
 *  support more, so the absence of the route is read as this fixed answer, not as a failure. */
const LEGACY_PEER_ENTITY_TYPES: readonly string[] = ["post", "page", "media"];

/** The probe answers an older peer gives: 404 to an API key (no such route), 401 to a publishing
 *  credential (route not on its allowlist). See {@link probePeerCapabilities}. */
const LEGACY_PROBE_STATUSES: ReadonlySet<number> = new Set([401, 404]);

/**
 * Probes the peer's own `GET .../capabilities` route (`routes/publish-content/capabilities.ts`) for
 * what it currently accepts.
 *
 * A 404 — the shape Express gives an unmatched route, which is exactly what a peer built before
 * this route existed returns to an API key — is read as {@link LEGACY_PEER_ENTITY_TYPES}, not as an
 * error: that peer never claimed to accept anything else. A 401 is read the same way: an older
 * peer's publishing-credential middleware (`publish-trust-auth.ts`) answers 401 for any route its
 * own `PUBLISH_TRUST_ROUTES` predates, and this route is one. That fallback cannot hide a genuinely
 * refused credential — the very next leg of the push is on that peer's allowlist and fails with
 * its own 401. Every OTHER failure (egress refusal, an unreachable host, any other non-2xx status,
 * a malformed body) propagates unchanged, the same fail-closed posture every other call in this
 * module already takes.
 *
 * @complexity O(1) plus one network round trip.
 */
/** What {@link probePeerCapabilities} learned about a peer: the entity types it currently accepts,
 *  plus the feature flags it advertises (publish-overwrite-live-plan §4/S7's `"overwrite-live"` is
 *  the first one). A peer that predates `features` entirely — the {@link LEGACY_PROBE_STATUSES}
 *  case, or an S-F1-only peer whose response has `entityTypes` but no `features` array — reports an
 *  empty features list: fail-closed, the same posture `entityTypes` itself already takes for that
 *  peer. */
interface PeerCapabilities {
  readonly entityTypes: readonly string[];
  readonly features: readonly string[];
}

/**
 * Refuses a non-empty set of "Overwrite on live" ticks for a peer that doesn't advertise
 * `"overwrite-live"`. Such a peer ignores the body field it doesn't know, so forwarding the ticks
 * would plan and execute WITHOUT the overwrite the operator asked for, and say nothing.
 *
 * @complexity O(1).
 */
function refuseOverwriteOnOlderPeer(
  { credential, capabilities, host }: { credential: PeerTransportCredential; capabilities: PeerCapabilities; host: PeerTransportHost },
  _optional = {}
): void {
  if (capabilities.features.includes("overwrite-live")) return;
  throw new PublishContentPeerTransportError({ message: `${credential.baseUrl} is on an older ${host.productName}, so it can't overwrite these yet. Update ${credential.baseUrl}, then publish again.`, code: "PEER_CANNOT_OVERWRITE", redact: host.redact });
}

async function probePeerCapabilities(deps: HostedPeerDeps): Promise<PeerCapabilities> {
  const { credential } = deps;
  let probed: Record<string, unknown>;
  try {
    probed = requireObject({ value: await callPeer({ deps, request: { method: "GET", path: peerRoute({ credential, suffix: "/capabilities" }) } }), what: "capabilities", baseUrl: credential.baseUrl, host: deps.host });
  } catch (err) {
    if (err instanceof PublishContentPeerTransportError && LEGACY_PROBE_STATUSES.has(err.peerStatus ?? 0)) {
      return { entityTypes: LEGACY_PEER_ENTITY_TYPES, features: [] };
    }
    throw err;
  }

  if (!Array.isArray(probed.entityTypes) || !probed.entityTypes.every((entityType) => typeof entityType === "string")) {
    throw new PublishContentPeerTransportError({ message: `the peer's capabilities response carried no 'entityTypes' array — is '${peerHostname({ baseUrl: credential.baseUrl })}' a ${deps.host.productName} instance?`, code: "PEER_RESPONSE_INVALID", redact: deps.host.redact });
  }
  const features =
    Array.isArray(probed.features) && probed.features.every((feature) => typeof feature === "string")
      ? (probed.features as string[])
      : [];
  return { entityTypes: probed.entityTypes as string[], features };
}

/**
 * Narrows a bundle to the entity types a peer just reported it accepts, so the whole-bundle refusal
 * `bundle-create.ts`'s own grant check produces for ONE unsupported type never happens at all.
 *
 * The excluded entities are counted and grouped by type rather than silently dropped — that grouping
 * is exactly {@link PushBundleResult.notSupportedByLive}, which the caller surfaces to a person.
 * `blobManifest` is recomputed from
 * the SURVIVING entities only, mirroring `export-bundle.ts`'s `selectBundleEntities`: a push must
 * never upload bytes that belong solely to an entity it is about to leave behind.
 *
 * @complexity O(e) time and space in the bundle's entity count.
 */
function trimBundleToCapabilities(
  bundle: PublishContentExportEnvelope,
  acceptedEntityTypes: readonly string[]
): { bundle: PublishContentExportEnvelope; notSupportedByLive: readonly NotSupportedByLiveEntry[] } {
  const accepted = new Set(acceptedEntityTypes);
  const kept: PackedEntity[] = [];
  const excludedCounts = new Map<string, number>();
  for (const entity of bundle.entities) {
    if (accepted.has(entity.entityType)) kept.push(entity);
    else excludedCounts.set(entity.entityType, (excludedCounts.get(entity.entityType) ?? 0) + 1);
  }
  if (excludedCounts.size === 0) return { bundle, notSupportedByLive: [] };

  const requiredBlobs = new Set<string>();
  for (const entity of kept) for (const sha of entity.requiredBlobs) requiredBlobs.add(sha);

  return {
    bundle: { ...bundle, entities: kept, blobManifest: Array.from(requiredBlobs) },
    notSupportedByLive: Array.from(excludedCounts, ([entityType, count]) => ({ entityType, count })),
  };
}

/**
 * Push step 1: stage a bundle on the peer and obtain its gated plan.
 *
 * Order is load-bearing: blobs FIRST, then the bundle, then the plan. The peer's `planImport` marks
 * an entity `blocked` when a required blob is absent there, so uploading after planning would
 * produce a plan that is wrong the moment it is acted on.
 *
 * @param required.bundle - Built by `buildExportBundle` from THIS instance's registered types.
 * @param required.overwriteEntityKeys - publish-overwrite-live-plan §4/S7 — the operator's
 * "Overwrite on live" ticks, forwarded verbatim to the peer's `/import/plan` (undefined stays
 * undefined on the wire, never becomes `[]` or `null`; see the peer's own `readOverwriteEntityKeys`
 * doc on why absent must mean "force nothing" rather than an empty, real answer).
 * @param required.blobSource - Read-only access to this instance's blob store.
 * @throws {PublishContentPeerTransportError} on any peer failure.
 * @complexity O(b + 1) network round trips for `b` missing blobs, plus one probe, one stage and one
 * plan. Memory is O(selected manifest size + size of the largest single blob) — hashes are checked
 * as a batch before uploading; blob bytes are uploaded one at a time, never collected.
 */
async function pushBundleToPeer(
  { deps, required }: {
    deps: HostedPeerDeps & PeerPushSources;
    required: { bundle: PublishContentExportEnvelope; overwriteEntityKeys?: readonly string[] };
  },
  _optional = {}
): Promise<PushBundleResult> {
  const { credential } = deps;

  // S-F1: probe, then trim, BEFORE any blob is probed or uploaded — an excluded entity's blobs must
  // never be sent either. Skipped for an empty bundle: trimming nothing needs no round trip, the
  // same short-circuit the blob probe below already takes for an empty `blobManifest`. An empty
  // bundle also leaves `liveCanOverwrite` at its fail-closed `false` default (S7) — there is nothing
  // in it to overwrite.
  let bundle = required.bundle;
  let notSupportedByLive: readonly NotSupportedByLiveEntry[] = [];
  let liveCanOverwrite = false;
  const wantsOverwrite = (required.overwriteEntityKeys?.length ?? 0) > 0;
  if (bundle.entities.length > 0 || wantsOverwrite) {
    const capabilities = await probePeerCapabilities(deps);
    liveCanOverwrite = capabilities.features.includes("overwrite-live");
    if (wantsOverwrite) refuseOverwriteOnOlderPeer({ credential, capabilities, host: deps.host });
    const trimmed = trimBundleToCapabilities(bundle, capabilities.entityTypes);
    bundle = trimmed.bundle;
    notSupportedByLive = trimmed.notSupportedByLive;
  }

  const { blobsUploaded, blobsUnavailable } = await uploadMissingPeerBlobs(deps, { bundle });

  const staged = requireObject({ value: await callPeer({ deps, request: {
      method: "POST",
      path: peerRoute({ credential, suffix: "/bundles" }),
      body: {
        artifactFormatVersion: bundle.artifactFormatVersion,
        hashVersion: bundle.hashVersion,
        sourceLabel: bundle.sourceLabel,
        entities: bundle.entities,
        blobManifest: bundle.blobManifest,
      },
    } }), what: "bundle staging", baseUrl: credential.baseUrl, host: deps.host });
  const bundleId = staged.bundleId;
  if (typeof bundleId !== "string") {
    throw new PublishContentPeerTransportError({ message: `the peer staged the bundle but returned no 'bundleId'`, code: "PEER_RESPONSE_INVALID", redact: deps.host.redact });
  }

  const plan = requireObject({
    value: await callPeer({ deps, request: {
      method: "POST",
      path: peerRoute({ credential, suffix: "/import/plan" }),
      // publish-overwrite-live-plan §4/S7 — `undefined` here reaches the peer's `/import/plan` as an
      // absent field, which its `readOverwriteEntityKeys` reads as "force nothing", the same
      // absent-means-unforced reading `selectedEntityKeys` already relies on for this same call.
      body:
        required.overwriteEntityKeys === undefined
          ? { bundleId }
          : { bundleId, overwriteEntityKeys: required.overwriteEntityKeys },
    } }),
    what: "import plan",
    baseUrl: credential.baseUrl,
    host: deps.host,
  });

  return { bundleId, blobsUploaded, blobsUnavailable, plan, notSupportedByLive, liveCanOverwrite };
}

/**
 * Push step 2: confirm the peer's plan and obtain its single-use confirmation token.
 *
 * The "an agent principal may never confirm" guard lives in `gated-mutations/gateway.ts`'s
 * `confirm()` (`AGENT_CANNOT_CONFIRM`) and is enforced on the PEER, against the peer's own view of
 * the calling principal. This driver cannot weaken it: it has no way to assert a principal kind
 * over the wire — the peer derives that itself from the API key it authenticated.
 *
 * @complexity O(1) plus one network round trip.
 */
async function confirmPeerImport(
  { deps, required }: {
    deps: HostedPeerDeps;
    required: { planId: string; planHash: string };
  },
  _optional = {}
): Promise<{ confirmationToken: string }> {
  const confirmed = requireObject({ value: await callPeer({ deps, request: {
      method: "POST",
      path: peerRoute({ credential: deps.credential, suffix: "/import/confirm" }),
      body: { planId: required.planId, planHash: required.planHash },
    } }), what: "import confirm", baseUrl: deps.credential.baseUrl, host: deps.host });
  const confirmationToken = confirmed.confirmationToken;
  if (typeof confirmationToken !== "string") {
    throw new PublishContentPeerTransportError({ message: `the peer confirmed the plan but returned no 'confirmationToken'`, code: "PEER_RESPONSE_INVALID", redact: deps.host.redact });
  }
  return { confirmationToken };
}

/**
 * Push step 3: redeem the token and run the peer's apply.
 *
 * @returns The peer's execute body verbatim (`{restorePointId, runId, changeSetIds, ...}`) — this driver
 * never reshapes a destination's own report.
 * Records completed outbound applies in the injected local ledger; ledger failures only warn.
 * @complexity O(1) plus one network round trip and one ledger append (the peer's apply loop dominates).
 */
async function executePeerImport(
  { deps, required }: {
    deps: HostedPeerDeps;
    required: { bundleId: string; confirmationToken: string; overwriteEntityKeys?: readonly string[] };
  },
  _optional = {}
): Promise<Record<string, unknown>> {
  // Re-probed rather than trusted from the plan step: execute is a separate request, and the peer
  // may have been redeployed in between.
  if ((required.overwriteEntityKeys?.length ?? 0) > 0) {
    refuseOverwriteOnOlderPeer({ credential: deps.credential, capabilities: await probePeerCapabilities(deps), host: deps.host });
  }
  const result = requireObject({ value: await callPeer({ deps, request: {
      method: "POST",
      path: peerRoute({ credential: deps.credential, suffix: "/import/execute" }),
      // publish-overwrite-live-plan §4/S7 — the same forced set confirmed at plan time. A DIFFERENT
      // set here re-derives a different report hash on the peer, and its own PLAN_STALE check
      // refuses it (§4) — no staleness code is needed on this side of the wire either.
      body:
        required.overwriteEntityKeys === undefined
          ? { bundleId: required.bundleId, confirmationToken: required.confirmationToken }
          : {
              bundleId: required.bundleId,
              confirmationToken: required.confirmationToken,
              overwriteEntityKeys: required.overwriteEntityKeys,
            },
    } }), what: "import execute", baseUrl: deps.credential.baseUrl, host: deps.host });
  // HTTP failures already throw. A completed apply may contain conflicts/partial writes; both
  // outcomes remember the destination, but a body explicitly reporting failure never does.
  if (deps.publishHistory && peerApplyCompleted({ result })) {
    try {
      await deps.publishHistory.store.recordSuccess({ workspaceId: deps.publishHistory.workspaceId, entry: {
        kind: deps.host.history.kind, target: deps.credential.id, projectName: "", url: deps.credential.baseUrl,
        configFields: { label: deps.credential.label }, reachable: true, status: "applied",
        publishedAt: nowIso({ clock: deps.publishHistory.clock }), triggeredBy: deps.publishHistory.triggeredBy ?? "admin_ui",
      } });
    } catch (error) {
      // The remote apply already succeeded; bookkeeping must never invite a duplicate retry.
      // Fixed diagnostics exclude credentials, remote bodies and database error parameters.
      console.warn("[publish-content] destination history write failed after remote apply", describeErrorForLog({ err: error }));
    }
  }
  return result;
}

/** A completed (possibly partial) apply names a run; refusals never establish a past destination. */
function peerApplyCompleted({ result }: { result: Record<string, unknown> }): boolean {
  if (typeof result.runId !== "string" || result.ok === false) return false;
  const report = result.report;
  return !(typeof report === "object" && report !== null && "refused" in report && report.refused === true);
}

/**
 * PULL: fetch the peer's export envelope so THIS instance can stage and plan it locally.
 *
 * Deliberately stops at the envelope. Staging and planning are the caller's job, and the caller
 * uses this instance's already-built `stageBundle` + gated `/import/plan` — the same importer a
 * pushed bundle goes through. Nothing in the pull path re-implements classification.
 *
 * This function transfers no blob BYTES — deliberately, and it is no longer a gap: the bytes are
 * {@link pullBlobsFromPeer}'s job, called by the pull route with the `blobManifest` this envelope
 * carries. The split is the same one the push side uses (blobs are their own leg, not a field of
 * the bundle call), and it keeps the envelope fetch a single bounded response.
 *
 * Until 2026-09-19 there was no such function, because the peer exposed `PUT .../blobs/:sha` but no
 * GET — a pulled media entity therefore always ended `blocked` by `planImport`. `media` IS a
 * registered publish-content type (`publish-content-manifest.ts` registers
 * `contributeMediaPublish()`; commits `72e4992c7`/`a9b265ce1`), so that was live, not theoretical:
 * the difference between an empty `blobManifest` and a pull that blocks every image. `blob-get.ts`
 * is the route that closed it.
 *
 * @complexity O(1) network round trip; O(e) memory in the peer's corpus size.
 */
async function pullBundleFromPeer(deps: HostedPeerDeps, _optional = {}): Promise<PublishContentExportEnvelope> {
  const body = requireObject({ value: await callPeer({ deps, request: { method: "GET", path: peerRoute({ credential: deps.credential, suffix: "/export" }) } }), what: "export", baseUrl: deps.credential.baseUrl, host: deps.host });

  if (
    typeof body.artifactFormatVersion !== "number" ||
    typeof body.hashVersion !== "number" ||
    !Array.isArray(body.entities) ||
    !Array.isArray(body.blobManifest)
  ) {
    throw new PublishContentPeerTransportError({ message: `the peer's export was not a publish-content bundle (expected artifactFormatVersion, hashVersion, entities and blobManifest)`, code: "PEER_RESPONSE_INVALID", redact: deps.host.redact });
  }
  if (body.artifactFormatVersion !== PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION) {
    throw new PublishContentPeerTransportError({ message: `the peer exported artifact format version ${String(body.artifactFormatVersion)}, but this instance supports ` +
        `${PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION}`, code: "PEER_RESPONSE_INVALID", redact: deps.host.redact });
  }

  return {
    artifactFormatVersion: body.artifactFormatVersion,
    hashVersion: body.hashVersion,
    sourceLabel: typeof body.sourceLabel === "string" ? body.sourceLabel : deps.credential.label,
    entities: body.entities as PublishContentExportEnvelope["entities"],
    blobManifest: (body.blobManifest as unknown[]).filter((sha): sha is string => typeof sha === "string"),
    // `GET .../export` (the streaming route, `routes/publish-content/export.ts`) does not serialize
    // `skipped` today — only `buildExportBundle` (the push driver) collects it. A pull therefore
    // never surfaces a source-side refusal; out of scope here (this file's own header: the pull path
    // stages an envelope and defers all classification to this instance's own `planImport`, which has
    // no `skipped` concept yet either). Defaulting to empty is a display gap, never a safety one.
    skipped: [],
  };
}

/** The narrow blob-WRITE seam the pull driver needs — `BlobStorePort`'s presence check plus its
 *  create-only write, and nothing else. No `put`, no `remove`: this module can never overwrite or
 *  delete a blob, only add one that is absent. */
export interface PeerBlobSink {
  exists(input: { storageKey: string }, optional?: {}): Promise<boolean>;
  putIfAbsent(input: {
    workspaceId: string;
    sha256: string;
    bytes: Uint8Array;
  }, optional?: {}): Promise<{ storageKey: string; written: boolean }>;
}

/**
 * How many blobs ONE pull will fetch from a peer. A resource bound, not a product limit: the
 * manifest is peer-controlled, and without a ceiling a single pull could hold an admin request open
 * for an unbounded number of round trips. Set to the same value as
 * `PUBLISH_CONTENT_BLOB_PROBE_MAX_SHAS` (the push direction's own cap on the same quantity) so the
 * two directions bound the same thing identically.
 *
 * Exceeding it is not an error and loses nothing: the remainder is reported as
 * `deferredOverCap`, whatever entity needed those blobs is `blocked` by this instance's own
 * `planImport` (the established fail-closed outcome), and a SECOND pull picks them up — the blobs
 * already fetched are skipped by the `exists()` short-circuit, so progress is monotonic.
 */
export const PUBLISH_CONTENT_PULL_MAX_BLOBS = 2000;

/** What one pull's blob leg did, per sha. Four disjoint lists rather than a count, because an
 *  operator acts differently on each: nothing to do for `alreadyPresent`, "the source no longer has
 *  these" for `unavailable`, and "pull again" for `deferredOverCap`. */
export interface PullBlobsResult {
  /** Fetched from the peer, verified against the requested sha, and written to this instance. */
  readonly downloaded: readonly string[];
  /** Already in this instance's blob store — no network call was made for these. */
  readonly alreadyPresent: readonly string[];
  /** The peer answered 404: it no longer holds those bytes. Reported, never thrown — the entity
   *  that requires one is `blocked` by `planImport`, which is a fail-closed plan, not a partial
   *  write. Mirrors `PushBundleResult.blobsUnavailable` on the other direction. */
  readonly unavailable: readonly string[];
  /** Beyond {@link PUBLISH_CONTENT_PULL_MAX_BLOBS} for this request. Fetch them with another pull. */
  readonly deferredOverCap: readonly string[];
}

/**
 * PULL step 2: fetch the blob bytes a pulled envelope requires and store them HERE, so the
 * entities that need them plan as applicable instead of `blocked`.
 *
 * ## The security property this function holds
 *
 * A peer's bytes are UNTRUSTED. `BlobStorePort.putIfAbsent` does not verify that bytes hash to the
 * sha256 it is given — it derives the storage key from that string and writes whatever it was
 * handed (`blob-staging.ts`'s header traces this through both adapters). Since the sha IS the
 * identity throughout this feature, storing unverified bytes would poison content-addressed
 * storage: every later "do you have X?" would answer yes for bytes that are not X, and a `probe`
 * from a third instance would then skip re-uploading the real ones. So every response is hashed
 * with {@link bytesMatchSha256} BEFORE `putIfAbsent`, and a mismatch throws rather than being
 * skipped — a peer serving wrong bytes for a requested hash is corrupt or hostile, and neither is
 * something to continue a pull through. Nothing is written on that path.
 *
 * A 404 is the one peer answer that is NOT an error (see `unavailable` above); every other non-2xx
 * propagates from {@link callPeer} unchanged.
 *
 * @param deps.blobSink - This instance's blob store, write half.
 * @param deps.workspaceId - THIS instance's workspace id. Never the peer's: the bytes are being
 * stored locally, and `putIfAbsent` derives the local storage key from it.
 * @param deps.computeStorageKey - Local storage key for a sha, used for the `exists()` short-circuit.
 * @param deps.maxBlobs - Test seam / operator override for {@link PUBLISH_CONTENT_PULL_MAX_BLOBS}.
 * @returns The four disjoint sha lists described by {@link PullBlobsResult}.
 * @throws {PublishContentPeerTransportError} `PEER_RESPONSE_INVALID` when a peer's bytes do not hash
 * to the sha they were requested by, or the response is not a blob body; other codes per
 * {@link toTransportError}.
 * @complexity O(min(b, maxBlobs)) sequential round trips for `b` distinct shas. Memory is O(size of
 * the largest single blob) — downloaded, verified and written one at a time, never collected (the
 * same bound `pushBundleToPeer` documents for the opposite direction).
 */
async function pullBlobsFromPeer(
  { deps, required }: {
    deps: HostedPeerDeps & PeerPullSinks;
    required: { blobManifest: readonly string[] };
  },
  _optional = {}
): Promise<PullBlobsResult> {
  const maxBlobs = deps.maxBlobs ?? PUBLISH_CONTENT_PULL_MAX_BLOBS;
  const downloaded: string[] = [];
  const alreadyPresent: string[] = [];
  const unavailable: string[] = [];
  const deferredOverCap: string[] = [];

  // Deduplicated: one manifest legitimately names the same blob for many entities (a logo on every
  // page), and fetching it once per reference would multiply the round trips by the reuse factor.
  for (const sha256 of new Set(required.blobManifest)) {
    if (await deps.blobSink.exists({ storageKey: deps.computeStorageKey({ sha256 }) })) {
      alreadyPresent.push(sha256);
      continue;
    }
    // The cap counts FETCHES, not manifest entries: a blob already held costs no round trip, so it
    // must not consume the budget that bounds them.
    if (downloaded.length + unavailable.length >= maxBlobs) {
      deferredOverCap.push(sha256);
    } else {
      const bytes = await fetchVerifiedPeerBlob(deps, { sha256 });
      if (bytes === null) {
        unavailable.push(sha256);
      } else {
        await deps.blobSink.putIfAbsent({ workspaceId: deps.workspaceId, sha256, bytes });
        downloaded.push(sha256);
      }
    }
  }

  return { downloaded, alreadyPresent, unavailable, deferredOverCap };
}

/** Archive bytes take precedence over JSON when both fields are supplied. */
function peerRequestPayload({ request }: { request: { body?: unknown; archive?: Uint8Array } }, _optional: Record<string, never> = {}): {
  headers: Record<string, string>; content: { body?: string | Uint8Array };
} {
  if (request.archive !== undefined) return { headers: { "content-type": "application/zip" }, content: { body: request.archive } };
  if (request.body === undefined) return { headers: {}, content: {} };
  return { headers: { "content-type": "application/json" }, content: { body: JSON.stringify(request.body) } };
}

/** Probe and upload sequentially before staging, so the peer plans against the uploaded blobs.
 * Refuses out-of-manifest requests before local I/O. O(m + r) validation time and O(m) space for
 * m selected hashes and r requested hashes, followed by sequential blob reads/uploads. */
async function uploadMissingPeerBlobs(
  deps: HostedPeerDeps & PeerPushSources,
  { bundle }: { bundle: PublishContentExportEnvelope },
): Promise<{ blobsUploaded: string[]; blobsUnavailable: string[] }> {
  const { credential } = deps;
  const blobsUploaded: string[] = [];
  const blobsUnavailable: string[] = [];
  if (bundle.blobManifest.length > 0) {
    const probed = requireObject({ value: await callPeer({ deps, request: {
        method: "POST",
        path: peerRoute({ credential, suffix: "/blobs/probe" }),
        body: { shas: bundle.blobManifest },
      } }), what: "blob probe", baseUrl: credential.baseUrl, host: deps.host });
    const missing = Array.isArray(probed.missing) ? (probed.missing as unknown[]).filter((s): s is string => typeof s === "string") : [];
    // Validate the whole request before any local read or upload: a valid prefix must not let a
    // peer obtain bytes from an invalid mixed batch. This is the manifest AFTER capability trimming.
    const selectedHashes = new Set(bundle.blobManifest);
    if (missing.some(sha256 => !selectedHashes.has(sha256))) {
      throw new PublishContentPeerTransportError({ message: "the peer requested a blob outside the selected manifest", code: "PEER_RESPONSE_INVALID", redact: deps.host.redact });
    }

    for (const sha256 of new Set(missing)) {
      const storageKey = deps.computeStorageKey({ sha256 });
      if (!(await deps.blobSource.exists({ sha256, storageKey }))) {
        // Not an error: the bundle names a blob this instance no longer holds. Reported, and the
        // peer's own planner blocks whatever needed it rather than applying half an entity.
        blobsUnavailable.push(sha256);
        continue;
      }
      const bytes = await deps.blobSource.get({ sha256, storageKey });
      await callPeer({ deps, request: {
        method: "PUT",
        path: peerRoute({ credential, suffix: `/blobs/${encodeURIComponent(sha256)}` }),
        body: { dataBase64: Buffer.from(bytes).toString("base64") },
      } });
      blobsUploaded.push(sha256);
    }
  }

  return { blobsUploaded, blobsUnavailable };
}

/** A missing blob is reportable; malformed or mismatched bytes abort before the local write. */
async function fetchVerifiedPeerBlob(deps: HostedPeerDeps, { sha256 }: { sha256: string }): Promise<Uint8Array | null> {
  let body: Record<string, unknown>;
  try {
    body = requireObject({ value: await callPeer({ deps, request: { method: "GET", path: peerRoute({ credential: deps.credential, suffix: `/blobs/${encodeURIComponent(sha256)}` }) } }), what: "blob fetch", baseUrl: deps.credential.baseUrl, host: deps.host });
  } catch (err) {
    if (err instanceof PublishContentPeerTransportError && err.peerStatus === 404) {
      return null;
    }
    throw err;
  }

  if (typeof body.dataBase64 !== "string") {
    throw new PublishContentPeerTransportError({ message: `the peer's response for blob '${sha256}' carried no 'dataBase64' string`, code: "PEER_RESPONSE_INVALID", redact: deps.host.redact });
  }
  // `Buffer.from(..., "base64")` never throws — it drops invalid characters — so a malformed
  // payload is caught by the hash check below rather than by a decode error, which is the check
  // that has to hold anyway.
  const bytes = new Uint8Array(Buffer.from(body.dataBase64, "base64"));

  // The security property this function exists to hold — see the doc above. MUST precede the
  // write: `putIfAbsent` will not catch it.
  if (!bytesMatchSha256({ bytes, claimedSha256: sha256 })) {
    throw new PublishContentPeerTransportError({ message: `the peer's bytes for blob '${sha256}' do not hash to it — refusing to store them under that ` +
        `sha256, because the hash IS the identity this feature addresses content by`, code: "PEER_RESPONSE_INVALID", redact: deps.host.redact });
  }

  return bytes;
}

/**
 * Binds the peer transport to one host. Every function this returns takes the same arguments as
 * before the host seam existed; the host's redactor, egress-refusal recogniser and copy are applied
 * inside, so no caller can produce a peer error that skipped the host's secret redaction.
 *
 * @param required.host - The host values; see {@link PeerTransportHost}. All REQUIRED.
 * @complexity O(1); each returned function costs what its unbound implementation documents.
 */
export function createPeerTransport<K extends string>({ host }: { host: PeerTransportHost<K> }, _optional = {}) {
  const hosted = <D extends PeerCallDeps<K>>(deps: D): D & { readonly host: PeerTransportHost<K> } => ({ ...deps, host });
  return {
    describePeerEgressRefusal: ({ err, baseUrl }: { err: PeerEgressRefusal; baseUrl: string }, _o = {}) =>
      describePeerEgressRefusal({ err, baseUrl, host }),
    callPeer: ({ deps, request }: { deps: PeerCallDeps<K>; request: PeerRequest }, _o = {}) =>
      callPeer({ deps: hosted(deps), request }),
    pushBundleToPeer: (
      { deps, required }: { deps: PeerCallDeps<K> & PeerPushSources; required: { bundle: PublishContentExportEnvelope; overwriteEntityKeys?: readonly string[] } },
      _o = {}
    ) => pushBundleToPeer({ deps: hosted(deps), required }),
    confirmPeerImport: ({ deps, required }: { deps: PeerCallDeps<K>; required: { planId: string; planHash: string } }, _o = {}) =>
      confirmPeerImport({ deps: hosted(deps), required }),
    executePeerImport: (
      { deps, required }: { deps: PeerCallDeps<K>; required: { bundleId: string; confirmationToken: string; overwriteEntityKeys?: readonly string[] } },
      _o = {}
    ) => executePeerImport({ deps: hosted(deps), required }),
    pullBundleFromPeer: (deps: PeerCallDeps<K>, _o = {}) => pullBundleFromPeer(hosted(deps)),
    pullBlobsFromPeer: ({ deps, required }: { deps: PeerCallDeps<K> & PeerPullSinks; required: { blobManifest: readonly string[] } }, _o = {}) =>
      pullBlobsFromPeer({ deps: hosted(deps), required }),
  };
}

/** The bound transport a host composes once and hands to its routes/tools. */
export type PeerTransport = ReturnType<typeof createPeerTransport>;
