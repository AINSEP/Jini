/**
 * Arbitrary operator-saved provider URLs require an injected guarded HTTP port, rather than raw
 * fetch against an assumed-safe provider catalog. Composition owns DNS/address checks, connection
 * pinning, per-hop redirect checks, response bounds, and cross-origin authorization stripping.
 * This layer adds the credential's persisted origin binding; request input cannot widen it.
 * Confirmation belongs to the calling host: this service executes an allowed verb uniformly and
 * does not introduce a second approval ceremony or expose decrypted credentials to the caller.
 */
import { IntegrationError } from "../argument-error.js";
import { nowIso, type Clock, type HttpClientPort, type UUID } from "@jini-ai/core/primitives";
import type { CredentialConnection, CredentialTarget, CredentialResolverPort, CredentialSchemeRegistryPort, CredentialedRequestErrorPolicyPort } from "./ports.js";
import { detectSelfDescribingAuthScheme, type CredentialSchemeRule } from "./auth-schemes.js";
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

// Echo endpoints and provider cookies must not return credential-bearing headers to the model,
// even when a value is too short to identify safely by substring matching.
const FORBIDDEN_RESPONSE_HEADER_NAMES: ReadonlySet<string> = new Set(["authorization", "proxy-authorization", "set-cookie", "cookie"]);

// A visible marker explains removal; silently splicing bytes out could alter the response's meaning.
const REDACTED_MARKER = "[REDACTED]";

// Very short tokens can match ordinary words ("ab" inside "abacus"); scrubbing would silently
// mangle unrelated content. The eight-character floor retains normal long API-token responses
// while withholding pathological ones. Dropping a whole response header needs no such floor.
const MIN_SAFE_BODY_REDACTION_TOKEN_LENGTH = 8;

// Withhold the body rather than leak the secret or make unrelated content look like provider output;
// the request still ran, and the marker lets a caller distinguish display limits from auth failure.
const BODY_WITHHELD_SHORT_TOKEN_MARKER = "[body withheld: credential too short to redact safely]";

// Match secrets embedded in diagnostic header values too, not just values equal to a full secret.
// Whole-header removal has no partial-mangling failure mode and therefore applies at any length.
function redactResponseHeaders(headers: Readonly<Record<string, string>>, secrets: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (FORBIDDEN_RESPONSE_HEADER_NAMES.has(key.trim().toLowerCase())) continue;
    if (secrets.some((secret) => secret !== "" && value.includes(secret))) continue;
    result[key] = value;
  }
  return result;
}

// Reflecting responses must not send injected credentials back through the model; retain all other
// provider text instead of replacing the provider's answer with an authentication diagnosis.
function redactSecretSubstrings(text: string, secrets: readonly string[]): string {
  return secrets.reduce((acc, secret) => (secret === "" ? acc : acc.split(secret).join(REDACTED_MARKER)), text);
}

// One-to-three-character suffix matches are too ambiguous to identify a cut-off secret. This
// four-character partial-tail floor gates a different risk from the full-token length floor above.
const MIN_SAFE_TRUNCATED_TAIL_PREFIX_LENGTH = 4;

// A size cap can cut a reflected secret mid-token, so whole-secret replacement alone leaks its
// prefix. Use the longest matching suffix across all secrets to remove the whole fragment; only
// truncated bodies qualify, since matching complete bodies could remove innocent trailing text.
function redactTruncatedTail(body: string, secrets: readonly string[]): string {
  let longestMatch = 0;
  for (const secret of secrets) {
    for (let len = Math.min(secret.length, body.length); len >= MIN_SAFE_TRUNCATED_TAIL_PREFIX_LENGTH; len--) {
      if (body.endsWith(secret.slice(0, len))) {
        longestMatch = Math.max(longestMatch, len);
        break;
      }
    }
  }
  return longestMatch === 0 ? body : body.slice(0, body.length - longestMatch) + REDACTED_MARKER;
}

// Gate on the raw token: a scheme-prefixed header is longer and cannot make a short token safe.
// The second pass is conditional because a complete response has no cap-cut fragment to repair.
function resolveRedactedResponseBody(bodyText: string, token: string, secrets: readonly string[], bodyTruncated: boolean): string {
  if (token.length < MIN_SAFE_BODY_REDACTION_TOKEN_LENGTH) return BODY_WITHHELD_SHORT_TOKEN_MARKER;
  const redacted = redactSecretSubstrings(bodyText, secrets);
  return bodyTruncated ? redactTruncatedTail(redacted, secrets) : redacted;
}

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

// This binds the original caller URL only. Any redirect comes from the already-approved host;
// the injected transport must recheck its address and strip credentials on cross-origin hops,
// rather than widening its global egress allowlist to make the redirected host reachable.
function resolveAllowedRequestUrl(candidate: unknown, allowedOrigins: readonly string[]): URL {
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

// Only 401/403 affirmatively reject it; redirects and other statuses reaching this classifier say
// nothing about validity. Keep this local rather than coupling independent provider features.
function classifyCustomCredentialStatus(status: number): CustomCredentialCheckStatus {
  if (status >= 200 && status < 300) return "valid";
  if (status === 401 || status === 403) return "invalid";
  return "unreachable";
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

/** Probe the saved origin root and classify 2xx/401/403/other outcomes; audit without returning response bodies. */
// Probe the primary saved origin to answer whether the credential works at all, rather than trying
// every additional API host. Provider bodies never belong in verification results; transport failure
// remains "unreachable", and only an affirmative auth rejection has a diagnostic worth attaching.
export async function verifyCustomCredential(required: { deps: CredentialedRequestDeps; input: { workspaceId: UUID; label: unknown } }, optional: CredentialedRequestOptions = {}): Promise<CustomCredentialVerificationResult> {
  const { deps, input } = required;
  const label = requireLabel(input.label);
  const checkedAt = nowIso({ clock: deps.clock });
  const { baseUrl, connection } = await resolveCredentialOrThrow(deps, { workspaceId: input.workspaceId, label });
  const url = new URL(`${new URL(baseUrl).origin}/`);
  const audit = deps.audit;
  const schemes = await deps.schemeRegistry.load({ workspaceId: input.workspaceId });

  let status: number;
  try {
    const response = await deps.httpClient.send({ request: {
      method: "GET",
      url: url.toString(),
      headers: { Authorization: buildAuthorizationHeader({ connection, schemes }) },
      timeoutMs: CREDENTIALED_REQUEST_TIMEOUT_MS,
    } });
    status = response.status;
  } catch {
    audit.record({ entry: { label, host: url.hostname, method: "GET", status: 0, bodyBytes: 0, at: checkedAt } });
    return { status: "unreachable", message: `Could not reach '${label}' to verify this credential — this does not necessarily mean the credential is bad.`, checkedAt };
  }

  audit.record({ entry: { label, host: url.hostname, method: "GET", status, bodyBytes: 0, at: checkedAt } });
  const outcome = classifyCustomCredentialStatus(status);
  const authDiagnostic = outcome === "invalid" ? mapAuthDiagnostic(connection, status as 401 | 403, schemes, optional) : undefined;
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

function mapAuthDiagnostic(connection: CredentialConnection, status: 401 | 403, schemes: readonly CredentialSchemeRule[], optional: CredentialedRequestOptions): AuthFailureDiagnostic {
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

  const { additionalHosts, baseUrl, connection } = await resolveCredentialOrThrow(deps, { workspaceId: input.workspaceId, label });
  const url = resolveAllowedRequestUrl(input.url, allowedOriginsFor({ baseUrl, additionalHosts }));
  const audit = deps.audit;
  const bodyBytes = body !== undefined ? Buffer.byteLength(body, "utf8") : 0;
  const schemes = await deps.schemeRegistry.load({ workspaceId: input.workspaceId });
  const authorizationHeader = buildAuthorizationHeader({ connection, schemes });
  const responseSecrets = buildResponseSecrets(connection, authorizationHeader, schemes);

  let response;
  try {
    response = await deps.httpClient.send({ request: {
      method,
      url: url.toString(),
      headers: { ...extraHeaders, Authorization: authorizationHeader },
      timeoutMs: CREDENTIALED_REQUEST_TIMEOUT_MS,
      ...(body !== undefined ? { body } : {}),
    } });
  } catch (err) {
    audit.record({ entry: { label, host: url.hostname, method, status: 0, bodyBytes, at, ...(optional.errorPolicy?.isEgressRefusal({ error: err }) ? { egressRefusal: optional.errorPolicy.describeEgressRefusal({ error: err }) } : {}) } });
    // Preserve the host refusal class: wrapping it would make a recoverable target-policy problem
    // indistinguishable from a redacted internal failure at the tool boundary. Audit status stays zero.
    if (optional.errorPolicy?.isEgressRefusal({ error: err })) throw err;
    throw new CredentialedRequestTransportError({ message: `request to '${label}' failed: ${resolveRedactedResponseBody(err instanceof Error ? err.message : String(err), connection.token, responseSecrets, false)}` });
  }

  audit.record({ entry: { label, host: url.hostname, method, status: response.status, bodyBytes, at } });
  const authDiagnostic =
    response.status === 401 || response.status === 403 ? mapAuthDiagnostic(connection, response.status, schemes, optional) : undefined;
  return {
    executed: true,
    status: response.status,
    headers: redactResponseHeaders(response.headers, responseSecrets),
    bodyText: resolveRedactedResponseBody(response.bodyText, connection.token, responseSecrets, response.bodyTruncated === true),
    ...(authDiagnostic ? { authDiagnostic } : {}),
  };
}
