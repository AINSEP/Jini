import { createHttpClient } from "@jini-ai/platform/http/guarded";
import type { HttpClientPort, HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import { CredentialedRequestValidationError } from "../contracts/credentialed-request-errors.js";
import type { ResolvedCredential } from "../credentialed-http/ports.js";
import { prepareSavedRequestDefinition } from "./definition.js";
import { projectSavedRequestResponse } from "./projection.js";
import type { SavedRequestDefinition, SavedRequestDeps, SavedRequestResult } from "./types.js";
import { requireCondition, SavedRequestError, snapshot } from "./validation.js";

/** Execute an already-authorized host definition with visitor data. The model supplies only input;
 * callers must recheck live policy/consent/quotas before calling. No retries of ambiguous effects.
 * @param required Host ports, mounted workspace, saved definition and untrusted input.
 * @param options Optional cancellation; the guard also imposes a whole-request 10s deadline.
 * @returns Positively projected data explicitly marked untrusted.
 * @throws SavedRequestError with value-free public refusal codes.
 * @complexity O(n) bounded validation plus one credential resolution and one guarded HTTP send. */
export async function executeSavedRequest(
  { deps, workspaceId, definition: raw, input: rawInput }: { deps: SavedRequestDeps; workspaceId: string; definition: unknown; input: unknown },
  options: { signal?: AbortSignal } = {},
): Promise<SavedRequestResult> {
  const { definition, validator } = prepareSavedRequestDefinition({ value: raw });
  const input = validatedInput({ validator, value: rawInput });
  const bound = bindRequest({ definition, input });
  let responseReceived = false;
  try {
    requireCondition({ valid: !deps.forbiddenOrigins.some(origin => new URL(origin).hostname === new URL(definition.url).hostname) });
    options.signal?.throwIfAborted();
    const credential = await resolveCredential({ deps, workspaceId, definition });
    options.signal?.throwIfAborted();
    const response = await deps.executeCredentialedRequest({
      deps: {
        resolver: { describe: async () => credential, resolve: async () => credential },
        schemeRegistry: deps.schemeRegistry, audit: deps.audit, clock: deps.clock,
        httpClient: boundedHttpClient({ deps, signal: options.signal, onResponse: () => { responseReceived = true; } }),
      },
      input: { workspaceId, label: definition.credential.id, method: definition.method, url: bound.url },
    }, { body: bound.body, headers: { Accept: "application/json", ...(bound.body === undefined ? {} : { "Content-Type": "application/json" }) }, responseFormat: "json" });
    checkResponse({ response });
    return projectSavedRequestResponse({ bodyText: response.bodyText, output: definition.output });
  } catch (error) {
    if (error instanceof SavedRequestError) throw error;
    // The credential owner audits answered requests before JSON completeness/redaction checks.
    // Preserve those refusals without misclassifying pre-send credential validation failures.
    if (responseReceived && error instanceof CredentialedRequestValidationError) throw new SavedRequestError({ code: "invalid_response" });
    throw new SavedRequestError({ code: "execution_failed" });
  }
}

function validatedInput({ validator, value }: { validator: ReturnType<typeof prepareSavedRequestDefinition>["validator"]; value: unknown }, _options: Record<string, never> = {}): Record<string, unknown> {
  const input = snapshot({ value, maxBytes: 16_384, code: "invalid_input" });
  requireCondition({ valid: validator.validate(input).valid, code: "invalid_input" });
  return input as Record<string, unknown>;
}

function bindRequest({ definition, input }: { definition: SavedRequestDefinition; input: Record<string, unknown> }, _options: Record<string, never> = {}): { url: string; body: string | undefined } {
  const url = new URL(definition.url);
  for (const [key, source] of Object.entries(definition.queryBindings)) {
    if (Object.hasOwn(input, source)) url.searchParams.set(key, String(input[source]));
  }
  const body = { ...definition.staticBody };
  for (const [key, source] of Object.entries(definition.bodyBindings)) {
    if (Object.hasOwn(input, source)) body[key] = input[source];
  }
  snapshot({ value: { url: url.href, body }, maxBytes: 16_384, code: "invalid_input" });
  return { url: url.href, body: Object.keys(body).length === 0 ? undefined : JSON.stringify(body) };
}

async function resolveCredential({ deps, workspaceId, definition }: { deps: SavedRequestDeps; workspaceId: string; definition: SavedRequestDefinition }, _options: Record<string, never> = {}): Promise<ResolvedCredential> {
  const credential = await deps.credentials.resolve({ workspaceId, credentialId: definition.credential.id });
  if (!credential) throw new SavedRequestError({ code: "credential_changed" });
  requireCondition({ valid: credential.revision === definition.credential.revision, code: "credential_changed" });
  requireCondition({ valid: new URL(credential.baseUrl).origin === definition.credential.origin, code: "credential_changed" });
  // Legacy credentials allow additional hosts; visitor release approval covers only the base origin.
  const token = credential.connection.token;
  requireCondition({ valid: !/[\r\n]/.test(token) && !token.includes("\0"), code: "credential_changed" });
  return { ...credential, additionalHosts: [] };
}

function boundedHttpClient({ deps, signal, onResponse }: { deps: SavedRequestDeps; signal: AbortSignal | undefined; onResponse: () => void }, _options: Record<string, never> = {}): HttpClientPort {
  // Equivalent to SINGLE_HOP_HTTPS_EGRESS_POLICY: the product policy stays in host composition.
  // Construct the existing guard here so redirects/dev overrides cannot silently widen this grant.
  const client = createHttpClient({ dns: deps.dns, transport: deps.transport, clock: deps.clock, userAgent: deps.userAgent, policy: {
    allowedSchemes: ["https"], denyPrivateAddresses: true, devHostAllowlist: [], maxRedirects: 0,
    connectTimeoutMs: 10_000, maxResponseBytes: 65_536, maxDecompressedBytes: 65_536,
  } });
  return { async send({ request }) {
    const bounded: HttpRequest = { ...request, totalDeadlineMs: 10_000, maxResponseBytes: 65_536, ...(signal === undefined ? {} : { signal }) };
    const response = await client.send({ request: bounded }, { redirect: "error" });
    onResponse();
    return response;
  } };
}

function checkResponse({ response }: { response: Pick<HttpResponse, "status" | "headers"> }, _options: Record<string, never> = {}): void {
  requireCondition({ valid: response.status >= 200 && response.status < 300, code: "invalid_response" });
  const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key.toLowerCase(), value]));
  const contentType = headers["content-type"]?.split(";")[0]?.trim() ?? "";
  requireCondition({ valid: /^application\/(?:[a-z0-9.-]+\+)?json$/i.test(contentType), code: "invalid_response" });
  // The platform guard caps bytes and the credential owner's JSON mode refuses truncation.
  // Check status/media type after that owner records the real status, before field projection.
}
