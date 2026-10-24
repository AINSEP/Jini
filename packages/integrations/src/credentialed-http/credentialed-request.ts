/**
 * Arbitrary operator-saved provider URLs require an injected guarded HTTP port, rather than raw
 * fetch against an assumed-safe provider catalog. Composition owns DNS/address checks, connection
 * pinning, per-hop redirect checks, response bounds, and cross-origin authorization stripping.
 * This layer adds the credential's persisted origin binding; request input cannot widen it.
 * Confirmation belongs to the calling host: this service executes an allowed verb uniformly and
 * does not introduce a second approval ceremony or expose decrypted credentials to the caller.
 */
import { IntegrationError } from "../argument-error.js";
import { nowIso, type Clock, type HttpClientPort, type HttpResponse, type UUID } from "@jini-ai/core/primitives";
import type { CredentialConnection, CredentialTarget, CredentialResolverPort, CredentialSchemeRegistryPort, CredentialedRequestErrorPolicyPort } from "./ports.js";
import { detectSelfDescribingAuthScheme, type CredentialSchemeRule } from "./auth-schemes.js";
import { redactJsonResponseBody, redactResponseHeaders, resolveRedactedResponseBody } from "./response-redaction.js";
export class CredentialNotFoundError extends IntegrationError {}
// Multiple saved origins support providers with separate API hosts. A single absolute URL keeps
// host/path fields from drifting; compare parsed origins exactly, never prefixes or substrings.
function allowedOriginsFor(record: CredentialTarget): readonly string[] {
  return [...new Set([new URL(record.baseUrl).origin, ...record.additionalHosts])];
}

// Request validation is distinct from validation of stored credentials, which belongs to the resolver.
export class CredentialedRequestValidationError extends IntegrationError {}

// An answered HTTP error is still a normal response. A host-recognized egress refusal retains its
// identity, so callers can distinguish a fixable target rejection from a DNS/timeout failure.
export class CredentialedRequestTransportError extends IntegrationError {}

// Bound a synchronous agent-facing probe; the guarded client's policy timeout may lower this ceiling.
const CREDENTIALED_REQUEST_TIMEOUT_MS = 10_000;

// Response bounds do not bound what a caller can ask the server to SEND. Cap that direction too.
const MAX_REQUEST_BODY_BYTES = 1_000_000;

// Caller headers cannot replace credentials or override the bound host. User-Agent is allowed:
// it carries no secret and does not widen origin binding; the transport's default need not override it.
const FORBIDDEN_REQUEST_HEADER_NAMES: ReadonlySet<string> = new Set(["authorization", "cookie", "host", "proxy-authorization"]);

// Match the HTTP port's verb vocabulary so every validated method is one the transport can send.
const SUPPORTED_METHODS: ReadonlySet<string> = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
type SupportedMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function requireLabel(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new CredentialedRequestValidationError({ message: "label must be a non-empty string" });
  }
  return raw;
}

function validateMethod(raw: unknown): SupportedMethod {
  if (typeof raw !== "string" || !SUPPORTED_METHODS.has(raw)) {
    throw new CredentialedRequestValidationError({ message: "method must be one of GET, POST, PUT, PATCH, DELETE" });
  }
  return raw as SupportedMethod;
}

/** Parse an absolute HTTP(S) request URL without userinfo; no I/O or credential-origin decision.
 * @throws CredentialedRequestValidationError for malformed input.
 * @complexity O(n) parsing for n URL characters. */
function parseRequestUrl(candidate: unknown): URL {
  if (typeof candidate !== "string" || candidate.trim() === "") {
    throw new CredentialedRequestValidationError({ message: "url must be a non-empty string" });
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new CredentialedRequestValidationError({ message: "url must be a valid absolute URL" });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CredentialedRequestValidationError({ message: "url must use http or https" });
  }
  if (parsed.username || parsed.password) {
    throw new CredentialedRequestValidationError({ message: "url must not embed credentials (user:pass@) — the server injects the real Authorization header itself" });
  }
  return parsed;
}

// This binds the original caller URL only. Any redirect comes from the already-approved host;
// the injected transport must recheck its address and strip credentials on cross-origin hops,
// rather than widening its global egress allowlist to make the redirected host reachable.
function resolveAllowedRequestUrl(candidate: unknown, allowedOrigins: readonly string[]): URL {
  const parsed = parseRequestUrl(candidate);
  if (!allowedOrigins.includes(parsed.origin)) {
    throw new CredentialedRequestValidationError({ message: `url '${candidate}' resolves to origin '${parsed.origin}', which is not one of this credential's saved hosts (${allowedOrigins.join(", ")})` });
  }
  return parsed;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Keep one entry's rejection logic separate so the collection validator has a single per-entry call.
function validateHeaderEntry(key: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new CredentialedRequestValidationError({ message: `header '${key}' must be a string value` });
  }
  if (FORBIDDEN_REQUEST_HEADER_NAMES.has(key.trim().toLowerCase())) {
    throw new CredentialedRequestValidationError({ message: `header '${key}' may not be set by the caller — the server injects the real credential's own Authorization header itself` });
  }
  return value;
}

function validateExtraHeaders(raw: unknown): Record<string, string> {
  if (raw === undefined) return {};
  if (!isPlainRecord(raw)) {
    throw new CredentialedRequestValidationError({ message: "headers must be an object of string values" });
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    result[key] = validateHeaderEntry(key, value);
  }
  return result;
}

// Some real APIs accept DELETE bodies; do not invent a verb-specific restriction here.
function validateOptionalBody(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") {
    throw new CredentialedRequestValidationError({ message: "body must be a string when provided" });
  }
  const byteLength = Buffer.byteLength(raw, "utf8");
  if (byteLength > MAX_REQUEST_BODY_BYTES) {
    throw new CredentialedRequestValidationError({ message: `body is ${byteLength} bytes, which exceeds the ${MAX_REQUEST_BODY_BYTES}-byte limit for this tool` });
  }
  return raw;
}

// The scheme vocabulary remains open: trusted registry rules can add schemes without core edits.
type ResolvedAuthorizationScheme =
  | { readonly kind: "self-describing"; readonly scheme: string; readonly value: string }
  | { readonly kind: "basic"; readonly username: string; readonly token: string }
  | { readonly kind: "bearer"; readonly token: string };

// A self-describing token dictates its transport even if an old saved username remains. Both header
// building and diagnostics call this resolver so reported auth can never drift from what was sent.
function resolveAuthorizationScheme(connection: CredentialConnection, schemes: readonly CredentialSchemeRule[]): ResolvedAuthorizationScheme {
  const selfDescribing = detectSelfDescribingAuthScheme({ token: connection.token, rules: schemes });
  if (selfDescribing) {
    return { kind: "self-describing", scheme: selfDescribing.scheme, value: selfDescribing.value };
  }
  if (connection.username) {
    return { kind: "basic", username: connection.username, token: connection.token };
  }
  return { kind: "bearer", token: connection.token };
}

/** Resolve self-describing, Basic, then Bearer precedence for trusted outbound-request executors.
 * Returns a secret-bearing header to those executors only; never expose it in tool/model results,
 * previews or logs. Callers needing only the target must use `resolveRequestTarget` instead. */
// Public so other credential-using operations share precedence; returned secrets belong only in
// outbound headers, never logs or model-facing results. Pass an empty rule set for Basic/Bearer only.
export function buildAuthorizationHeader(required: { connection: CredentialConnection; schemes: readonly CredentialSchemeRule[] }): string {
  const { connection, schemes } = required;
  const resolved = resolveAuthorizationScheme(connection, schemes);
  if (resolved.kind === "self-describing") return `${resolved.scheme} ${resolved.value}`;
  if (resolved.kind === "basic") return `Basic ${buildBasicAuthPayload(resolved.username, resolved.token)}`;
  return `Bearer ${resolved.token}`;
}

// Share the exact encoding with response redaction. An echo of the bare base64 username:token
// payload contains neither the full prefixed header nor the raw token, and must be listed separately.
function buildBasicAuthPayload(username: string, token: string): string {
  return Buffer.from(`${username}:${token}`, "utf8").toString("base64");
}

// Facts never include the token/header/username value. Hints are hedged hypotheses, not diagnoses:
// a missing username once made a Basic-only provider reject every Bearer call with no useful reason.
export interface AuthFailureDiagnostic {
  // Open-ended because trusted registry rules can name self-describing schemes.
  readonly schemeSent: string;
  // Presence alone is safe to report; the username's actual text is never diagnostic material.
  readonly usernameStored: boolean;
  // Only a Bearer 401 supports the scheme hypothesis; a known username or correct embedded scheme
  // leaves expiry/scopes/policy unguessable. A 403 does not justify changing authentication schemes.
  readonly hint?: string;
  // A host may attach a registered remedy pointer; this module never calls the remedy itself.
  readonly remedyToolId?: string;
}

function buildAuthFailureDiagnostic(connection: CredentialConnection, status: 401 | 403, schemes: readonly CredentialSchemeRule[]): AuthFailureDiagnostic {
  const usernameStored = connection.username !== undefined;
  const resolved = resolveAuthorizationScheme(connection, schemes);
  const schemeSent = resolved.kind === "self-describing" ? resolved.scheme : resolved.kind === "basic" ? "Basic" : "Bearer";
  // A provider once returned 403 for a missing User-Agent, and suggesting Basic auth led to an
  // ineffective username repair. Scope/policy/header refusals explain 403 too; retain facts without
  // guessing. Gate on the scheme actually sent, not username presence alone.
  if (resolved.kind !== "bearer" || status !== 401) {
    return { schemeSent, usernameStored };
  }
  return {
    schemeSent,
    usernameStored,
    hint:
      "This request was sent with a Bearer token and no saved username. Some providers (e.g. ones that " +
      "authenticate a token against an account username via HTTP Basic) may reject a Bearer-only request " +
      "for that reason — this credential has no username saved. If that's the cause, saving one may fix it.",
  };
}

// Audit metadata only, never secrets or request/response bodies: preserve operational evidence
// without turning a logging sink into another credential store.
export interface CredentialedRequestAuditEntry {
  readonly label: string;
  readonly host: string;
  readonly method: string;
  // Zero distinguishes no response (refusal/DNS/timeout) from any status a provider answered with.
  readonly status: number;
  // Size alone, never the body content.
  readonly bodyBytes: number;
  readonly at: string;
  // Host-approved refusal detail may retain the resolved address withheld from model-facing text;
  // unrelated raw transport errors are not audit material.
  readonly egressRefusal?: string;
}

// Every success, rejection at send time, or transport failure has the same metadata-only vocabulary.
export interface CredentialedRequestAuditPort {
  record(required: { entry: CredentialedRequestAuditEntry }): void;
}

// Per-request audit fields fixed before the send; the status (and any refusal) is added per outcome.
type AuditBase = Omit<CredentialedRequestAuditEntry, "status" | "egressRefusal">;

// Keep the entry's field order identical for every outcome so serialized audit lines stay stable.
function auditEntry(base: AuditBase, status: number): CredentialedRequestAuditEntry {
  return { label: base.label, host: base.host, method: base.method, status, bodyBytes: base.bodyBytes, at: base.at };
}

// A structured line gives deployments an inspectable trail without requiring a database audit sink.
export class ConsoleCredentialedRequestAuditLog implements CredentialedRequestAuditPort {
  constructor(private readonly required: { log: (required: { line: string }) => void; prefix: string }) {}

  record({ entry }: { entry: CredentialedRequestAuditEntry }): void {
    const refusal = entry.egressRefusal !== undefined ? ` egressRefusal=${JSON.stringify(entry.egressRefusal)}` : "";
    this.required.log({
      line: `${this.required.prefix} request label=${entry.label} host=${entry.host} method=${entry.method} status=${entry.status} bodyBytes=${entry.bodyBytes} at=${entry.at}${refusal}`,
    });
  }
}

// Capture ordered metadata for direct audit assertions without parsing formatted log lines.
export class InMemoryCredentialedRequestAuditLog implements CredentialedRequestAuditPort {
  readonly entries: CredentialedRequestAuditEntry[] = [];

  record({ entry }: { entry: CredentialedRequestAuditEntry }): void {
    this.entries.push(entry);
  }
}

/** Dependencies and identity are all required in argument one. No global store or plugin loading. */
export interface CredentialedRequestDeps {
  readonly resolver: CredentialResolverPort;
  // Constructed by composition: feature code must not bypass the guarded outbound seam.
  readonly httpClient: HttpClientPort;
  readonly clock: Clock;
  readonly audit: CredentialedRequestAuditPort;
  readonly schemeRegistry: CredentialSchemeRegistryPort;
}
export interface CredentialedRequestOptions {
  readonly headers?: unknown;
  readonly body?: unknown;
  /** Opt-in structured redaction after transport completeness checks. Existing text callers keep
   * their original body formatting. JSON escapes cannot disguise a reflected credential value;
   * credential-bearing keys and numbers refuse the body rather than changing its schema/types. */
  readonly responseFormat?: "json";
  readonly errorPolicy?: CredentialedRequestErrorPolicyPort;
  readonly diagnosticMapper?: (required: { diagnostic: AuthFailureDiagnostic; status: 401 | 403 }) => AuthFailureDiagnostic;
}
/** Resolve an approved request target without decrypting credentials. */
// Confirmation dialogs need only plaintext label/origins. A declined call should never cost a
// decrypt; the full resolver is reserved for callers that will actually send an authenticated request.
export async function resolveRequestTarget(required: {
  resolver: Pick<CredentialResolverPort, "describe">;
  input: { workspaceId: string; label: string; url: unknown };
}): Promise<{ label: string; url: URL }> {
  const { resolver, input } = required;
  const label = requireLabel(input.label);
  const summary = await resolver.describe({ workspaceId: input.workspaceId, label });
  if (!summary) throw new CredentialNotFoundError({ message: `no custom credential labeled '${label}' in this workspace` });
  return { label, url: resolveAllowedRequestUrl(input.url, allowedOriginsFor(summary)) };
}
// Decrypting path: callers needing only origins must use describe/resolveRequestTarget instead.
// Missing rows fail loudly and resolver decryption failures propagate rather than appearing absent.
async function resolveCredentialOrThrow(deps: Pick<CredentialedRequestDeps, "resolver">, input: { workspaceId: string; label: string }) {
  const resolved = await deps.resolver.resolve(input);
  if (!resolved) throw new CredentialNotFoundError({ message: `no custom credential labeled '${input.label}' in this workspace` });
  return resolved;
}

// Network/ambiguous outcomes are not evidence of a bad credential; a boolean would erase that fact.
export type CustomCredentialCheckStatus = "valid" | "invalid" | "unreachable";

/** A refusal establishes only that this GET was refused, not that the key is invalid. */
export type CredentialConnectionProbeStatus = "ok" | "refused" | "unavailable";

/** Host-owned probe input. The host must resolve the plugin-declared URL against the saved base
 * origin before calling; no credential store or plugin/model-input parser is loaded here. */
export interface CredentialConnectionProbeInput {
  readonly connection: CredentialConnection;
  readonly url: string;
  readonly schemes: readonly CredentialSchemeRule[];
  /** Omit for GET. Explicit methods are checked at runtime, including untyped callers. */
  readonly method?: "GET";
}

/** Send one bodyless GET through the guarded HTTP port without following redirects.
 * @param required Plaintext connection, trusted host-resolved URL and auth-scheme rules.
 * @param options Guarded HTTP client; owns DNS/address policy, peer pinning and response bounds.
 * @returns Only ok/refused/unavailable; no bodies, headers, URLs, secrets or transport errors.
 * @throws CredentialedRequestValidationError with value-free text for non-GET or malformed URLs.
 * @complexity One bounded HTTP send plus O(r) auth matching for r supplied scheme rules.
 * @example await probeCredentialConnection({ connection, url, schemes }, { httpClient });
 */
export async function probeCredentialConnection(
  required: CredentialConnectionProbeInput,
  options: { httpClient: HttpClientPort },
): Promise<CredentialConnectionProbeStatus> {
  if (required.method !== undefined && required.method !== "GET") {
    throw new CredentialedRequestValidationError({ message: "credential probes only support GET" });
  }
  let url: URL;
  try {
    url = parseRequestUrl(required.url);
  } catch {
    // URL parse errors may contain their input; probe failures must never echo caller values.
    throw new CredentialedRequestValidationError({ message: "credential probe requires an absolute HTTP(S) URL without embedded credentials" });
  }
  return classifyCredentialProbeStatus(await sendCredentialGet({ ...required, url, httpClient: options.httpClient }, { strict: true }));
}

/** One bodyless authenticated GET shared by the probe and verification. Returns the HTTP status,
 * or 0 when the transport failed; transport errors are dropped because they can echo request values.
 * `strict` refuses redirects and bounds the whole operation (the probe contract); verification omits
 * it to keep its original follow-redirect, idle-timeout-only policy so its results do not change.
 * @complexity One HTTP send plus O(r) auth matching for r scheme rules. */
async function sendCredentialGet(
  required: { connection: CredentialConnection; url: URL; schemes: readonly CredentialSchemeRule[]; httpClient: HttpClientPort },
  optional: { strict?: boolean } = {},
): Promise<number> {
  try {
    const response = await required.httpClient.send({ request: {
      method: "GET", url: required.url.href,
      headers: { Authorization: buildAuthorizationHeader(required) },
      timeoutMs: CREDENTIALED_REQUEST_TIMEOUT_MS,
      ...(optional.strict ? { totalDeadlineMs: CREDENTIALED_REQUEST_TIMEOUT_MS } : {}),
    } }, optional.strict ? { redirect: "error" } : undefined);
    return response.status;
  } catch {
    return 0;
  }
}

/** Classify only affirmative success/refusal; redirects and all other statuses are inconclusive. */
function classifyCredentialProbeStatus(status: number): CredentialConnectionProbeStatus {
  if (status >= 200 && status < 300) return "ok";
  if (isAuthRejectionStatus(status)) return "refused";
  return "unavailable";
}

// 401 and 403 are the only affirmative authentication rejections; both classification and
// diagnostics key off this one predicate so they cannot disagree.
function isAuthRejectionStatus(status: number): status is 401 | 403 {
  return status === 401 || status === 403;
}

// Wording may change without changing the three-way classification contract.
function buildVerificationMessage(label: string, status: number, outcome: CustomCredentialCheckStatus): string {
  if (outcome === "valid") return `'${label}' accepted this credential.`;
  if (outcome === "invalid") {
    return `'${label}' rejected this credential (HTTP ${status}) — it is invalid, expired, or missing required permissions.`;
  }
  return `Could not get a clear accept or reject from '${label}' (HTTP ${status}) — this does not necessarily mean the credential is bad.`;
}

export interface CustomCredentialVerificationResult {
  readonly status: CustomCredentialCheckStatus;
  readonly message: string;
  readonly checkedAt: string;
  readonly authDiagnostic?: AuthFailureDiagnostic;
}

export interface CustomCredentialVerificationOptions extends CredentialedRequestOptions {
  /** Trusted plugin-declared path relative to baseUrl; omission keeps the origin-root probe. */
  readonly path?: string;
}

/** Resolve an optional relative probe path against the saved primary base, never additional hosts.
 * Invalid stored URLs/paths produce value-free errors before any HTTP send.
 * @complexity O(n) URL parsing for n URL/path characters; no I/O. */
function resolveVerificationUrl(baseUrl: string, path: unknown): URL {
  try {
    const base = parseRequestUrl(baseUrl);
    if (path === undefined) return new URL("/", base);
    // Schemes and network-path references ("//host") are absolute, even when they repeat the saved host.
    if (typeof path === "string" && path.trim() !== "" && !/[\u0000-\u001f\u007f]/.test(path) && !/^([a-z][a-z\d+.-]*:|[\\/]{2})/i.test(path.trim())) {
      return resolveAllowedRequestUrl(new URL(path, base).href, [base.origin]);
    }
  } catch {
    // Fall through: URL errors can echo their input, so every failure gets the same value-free text.
  }
  throw new CredentialedRequestValidationError({ message: "probe path must be relative to the saved base URL and remain on its origin" });
}

/** Probe the origin root or a trusted relative path; retain verification messages, diagnostics and audit.
 * @param required Resolver/HTTP/audit ports and workspace-bound credential identity.
 * @param optional Optional relative path and existing diagnostic mapping policy.
 * @returns The existing valid/invalid/unreachable result, without response bodies or secrets.
 * @throws CredentialedRequestValidationError for invalid labels/paths; resolver/registry errors propagate.
 * @complexity One credential resolution, registry load and bounded HTTP probe; O(r) scheme matching.
 * @example await verifyCustomCredential({ deps, input }, { path: "/user" });
 */
// Probe the primary saved origin to answer whether the credential works at all, rather than trying
// every additional API host. Provider bodies never belong in verification results; transport failure
// remains "unreachable", and only an affirmative auth rejection has a diagnostic worth attaching.
export async function verifyCustomCredential(required: { deps: CredentialedRequestDeps; input: { workspaceId: UUID; label: unknown } }, optional: CustomCredentialVerificationOptions = {}): Promise<CustomCredentialVerificationResult> {
  const { deps, input } = required;
  const label = requireLabel(input.label);
  const checkedAt = nowIso({ clock: deps.clock });
  const { baseUrl, connection } = await resolveCredentialOrThrow(deps, { workspaceId: input.workspaceId, label });
  const url = resolveVerificationUrl(baseUrl, optional.path);
  const auditBase: AuditBase = { label, host: url.hostname, method: "GET", bodyBytes: 0, at: checkedAt };
  const schemes = await deps.schemeRegistry.load({ workspaceId: input.workspaceId });

  const status = await sendCredentialGet({ connection, url, schemes, httpClient: deps.httpClient });
  deps.audit.record({ entry: auditEntry(auditBase, status) });
  if (status === 0) {
    return { status: "unreachable", message: `Could not reach '${label}' to verify this credential — this does not necessarily mean the credential is bad.`, checkedAt };
  }

  const outcomes = { ok: "valid", refused: "invalid", unavailable: "unreachable" } as const;
  const outcome = outcomes[classifyCredentialProbeStatus(status)];
  const authDiagnostic = isAuthRejectionStatus(status) ? mapAuthDiagnostic(connection, status, schemes, optional) : undefined;
  return { status: outcome, message: buildVerificationMessage(label, status, outcome), checkedAt, ...(authDiagnostic ? { authDiagnostic } : {}) };
}

// A host wrapper can discriminate an actual send from a declined confirmation with one fixed field;
// auth diagnostics accompany redacted provider output, never replace or reinterpret it.
export interface CredentialedRequestExecutedResult {
  readonly executed: true;
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly bodyText: string;
  readonly authDiagnostic?: AuthFailureDiagnostic;
}

// Only a host's confirmation layer produces this outcome, never makeCredentialedRequest itself.
export interface CredentialedRequestDeclinedResult {
  readonly executed: false;
  readonly cancelled: boolean;
  readonly reason?: "expired" | "abandoned";
}

export type CredentialedRequestOutcome = CredentialedRequestExecutedResult | CredentialedRequestDeclinedResult;

export interface MakeCredentialedRequestInput {
  readonly workspaceId: UUID;
  readonly label: unknown;
  readonly method: unknown;
  readonly url: unknown;
}

// Echo endpoints may return bare Basic payloads or bare self-describing values without their scheme
// words. Listing just the raw token and full header missed those leaks. Derive forms from the same
// resolved scheme as header building: a leftover username must not invent a Basic payload never sent.
// Keep an explicit three-way match: grouping self-describing with "not Basic" once silently used
// Bearer's incomplete two-secret list and leaked a reflected bare value.
function buildResponseSecrets(connection: CredentialConnection, authorizationHeader: string, schemes: readonly CredentialSchemeRule[]): readonly string[] {
  const resolvedScheme = resolveAuthorizationScheme(connection, schemes);
  if (resolvedScheme.kind === "self-describing") return [authorizationHeader, connection.token, resolvedScheme.value];
  if (resolvedScheme.kind === "basic") return [authorizationHeader, connection.token, buildBasicAuthPayload(resolvedScheme.username, resolvedScheme.token)];
  return [authorizationHeader, connection.token];
}

function mapAuthDiagnostic(connection: CredentialConnection, status: 401 | 403, schemes: readonly CredentialSchemeRule[], optional: Pick<CredentialedRequestOptions, "diagnosticMapper">): AuthFailureDiagnostic {
  const diagnostic = buildAuthFailureDiagnostic(connection, status, schemes);
  return optional.diagnosticMapper ? optional.diagnosticMapper({ diagnostic, status }) : diagnostic;
}

/** Validate caller shape and credential origins, send through the guarded HTTP port, then redact response secrets. Transport failures are audited; egress refusal identity is host-defined. */
// Malformed/off-origin requests must fail before any network call. Actual HTTP error responses
// resolve normally so the provider's reason survives; transport failures are distinct throws.
export async function makeCredentialedRequest(required: { deps: CredentialedRequestDeps; input: MakeCredentialedRequestInput }, optional: CredentialedRequestOptions = {}): Promise<CredentialedRequestExecutedResult> {
  const { deps, input } = required;
  const label = requireLabel(input.label);
  const method = validateMethod(input.method);
  const extraHeaders = validateExtraHeaders(optional.headers);
  const body = validateOptionalBody(optional.body);
  const at = nowIso({ clock: deps.clock });

  const credential = await resolveCredentialOrThrow(deps, { workspaceId: input.workspaceId, label });
  const url = resolveAllowedRequestUrl(input.url, allowedOriginsFor(credential));
  const auditBase: AuditBase = { label, host: url.hostname, method, bodyBytes: body !== undefined ? Buffer.byteLength(body, "utf8") : 0, at };
  const schemes = await deps.schemeRegistry.load({ workspaceId: input.workspaceId });
  const authorizationHeader = buildAuthorizationHeader({ connection: credential.connection, schemes });
  const redaction: ResponseRedaction = { connection: credential.connection, schemes, secrets: buildResponseSecrets(credential.connection, authorizationHeader, schemes) };

  let response: HttpResponse;
  try {
    response = await deps.httpClient.send({ request: {
      method,
      url: url.toString(),
      headers: { ...extraHeaders, Authorization: authorizationHeader },
      timeoutMs: CREDENTIALED_REQUEST_TIMEOUT_MS,
      ...(body !== undefined ? { body } : {}),
    } });
  } catch (err) {
    return failTransport({ err, audit: deps.audit, auditBase, redaction }, optional);
  }

  deps.audit.record({ entry: auditEntry(auditBase, response.status) });
  return buildExecutedResult({ response, redaction }, optional);
}

// What redaction and diagnostics need from the resolved credential; never leaves this module.
interface ResponseRedaction {
  readonly connection: CredentialConnection;
  readonly schemes: readonly CredentialSchemeRule[];
  readonly secrets: readonly string[];
}

// Audit every transport failure with status zero, then rethrow. Preserve the host refusal class:
// wrapping it would make a recoverable target-policy problem indistinguishable from a redacted
// internal failure at the tool boundary. Audit status stays zero.
function failTransport(
  required: { err: unknown; audit: CredentialedRequestAuditPort; auditBase: AuditBase; redaction: ResponseRedaction },
  optional: Pick<CredentialedRequestOptions, "errorPolicy">,
): never {
  const { err, audit, auditBase, redaction } = required;
  const egressRefusal = describeEgressRefusal(err, optional.errorPolicy);
  audit.record({ entry: { ...auditEntry(auditBase, 0), ...(egressRefusal !== undefined ? { egressRefusal } : {}) } });
  if (egressRefusal !== undefined) throw err;
  const detail = err instanceof Error ? err.message : String(err);
  throw new CredentialedRequestTransportError({ message: `request to '${auditBase.label}' failed: ${resolveRedactedResponseBody(detail, redaction.connection.token, redaction.secrets, false)}` });
}

// Only a host-recognized refusal yields audit detail; any other failure, or no policy, yields none.
function describeEgressRefusal(err: unknown, policy: CredentialedRequestErrorPolicyPort | undefined): string | undefined {
  return policy?.isEgressRefusal({ error: err }) ? policy.describeEgressRefusal({ error: err }) : undefined;
}

// Redact before returning: headers and body may reflect the injected secrets. A 401/403 adds the
// auth diagnostic alongside the provider's own answer, never in place of it.
function buildExecutedResult(
  required: { response: HttpResponse; redaction: ResponseRedaction },
  optional: Pick<CredentialedRequestOptions, "diagnosticMapper" | "responseFormat">,
): CredentialedRequestExecutedResult {
  const { response, redaction } = required;
  const authDiagnostic = isAuthRejectionStatus(response.status) ? mapAuthDiagnostic(redaction.connection, response.status, redaction.schemes, optional) : undefined;
  return {
    executed: true,
    status: response.status,
    headers: redactResponseHeaders(response.headers, redaction.secrets),
    bodyText: redactExecutedBody({ response, redaction }, optional),
    ...(authDiagnostic ? { authDiagnostic } : {}),
  };
}

/** Keep decoded-string redaction in the credential owner, before any caller's projection. */
function redactExecutedBody(
  { response, redaction }: { response: HttpResponse; redaction: ResponseRedaction },
  options: Pick<CredentialedRequestOptions, "responseFormat"> = {},
): string {
  if (options.responseFormat === "json") {
    if (response.bodyTruncated || response.bodyBytesTruncated) throw new CredentialedRequestValidationError({ message: "JSON response must be complete" });
    try {
      return redactJsonResponseBody({ bodyText: response.bodyText, token: redaction.connection.token, secrets: redaction.secrets });
    } catch {
      throw new CredentialedRequestValidationError({ message: "JSON response must be valid" });
    }
  }
  return resolveRedactedResponseBody(response.bodyText, redaction.connection.token, redaction.secrets, response.bodyTruncated === true);
}
