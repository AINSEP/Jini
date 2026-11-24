import { expect, it } from "vitest";
import type { HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import { CredentialedRequestValidationError, type CredentialedRequestAuditEntry } from "../../credentialed-http/credentialed-request.js";
import type { CredentialTarget, ResolvedCredential } from "../../credentialed-http/ports.js";
import { CustomCredentialNotFoundError } from "../../credentialed-http/sets/store.js";
import { bindCustomCredentialRequestOperations, type CustomCredentialRequestHostDeps } from "../credentialed-request.js";

/** @file The host binding over the guarded request pipeline: store reads, positional send, egress identity, remedy wording. */

/** A positional host client, the legacy ABI the injected `send` adapts. */
interface PositionalClient { send(request: HttpRequest, options?: { redirect?: string }): Promise<HttpResponse> }

class HostEgressRefusedError extends Error {
  readonly callerSafeMessage: string;
  constructor(details: { message: string }, options: { callerSafeMessage: string }) { super(details.message); this.callerSafeMessage = options.callerSafeMessage; }
}

const target: CredentialTarget = { baseUrl: "https://api.example.test", additionalHosts: [] };
const resolved: ResolvedCredential = { ...target, connection: { token: "tok-secret-1234" } };
type Rows = Readonly<Record<string, ResolvedCredential>>;
interface Deps extends CustomCredentialRequestHostDeps { readonly repo: Rows; readonly httpClient: PositionalClient }

function setup(respond: (request: HttpRequest) => Promise<HttpResponse>) {
  const sent: { request: HttpRequest; options: unknown }[] = [];
  const defaultEntries: CredentialedRequestAuditEntry[] = [];
  const decrypts: string[] = [];
  const httpClient: PositionalClient = { send: async (request, options) => { sent.push({ request, options }); return respond(request); } };
  const deps: Deps = { repo: { stripe: resolved }, httpClient, clock: { nowMs: () => 0 }, loadAuthSchemes: async () => [] };
  const ops = bindCustomCredentialRequestOperations<Deps>({ host: {
    describe: async ({ repo }, { label }) => repo[label] ? { baseUrl: repo[label].baseUrl, additionalHosts: repo[label].additionalHosts } : null,
    resolve: async ({ repo }, { label }) => { decrypts.push(label); return repo[label] ?? null; },
    send: ({ httpClient: client, request }, options) => client.send(request, options),
    EgressRefusedError: HostEgressRefusedError,
    defaultAudit: () => ({ record: (entry) => defaultEntries.push(entry) }),
    savedHostRemedy: "add it in the host's form first",
  } });
  return { ops, deps, sent, defaultEntries, decrypts };
}
const ok = async (): Promise<HttpResponse> => ({ status: 200, headers: {}, bodyText: "{}" });

it("sends through the host's positional client and audits to the default sink when deps carry none", async () => {
  const { ops, deps, sent, defaultEntries } = setup(ok);
  const result = await ops.makeCredentialedRequest(deps, { workspaceId: "w", label: "stripe", method: "GET", url: "https://api.example.test/v1/x" });
  expect(result.status).toBe(200);
  expect(sent).toHaveLength(1);
  expect(sent[0]!.request.url).toBe("https://api.example.test/v1/x");
  expect(defaultEntries.map((entry) => entry.status)).toEqual([200]);
});

it("rebuilds a pipeline not-found as the store's CustomCredentialNotFoundError", async () => {
  const { ops, deps } = setup(ok);
  await expect(ops.verifyCustomCredential(deps, { workspaceId: "w", label: "missing" })).rejects.toBeInstanceOf(CustomCredentialNotFoundError);
  await expect(ops.resolveRequestTarget(deps, { workspaceId: "w", label: "missing", url: "https://api.example.test/" })).rejects.toBeInstanceOf(CustomCredentialNotFoundError);
});

it("appends the host remedy to a saved-hosts refusal and resolves a DELETE target without decrypting", async () => {
  const { ops, deps, decrypts } = setup(ok);
  const refusal = ops.resolveRequestTarget(deps, { workspaceId: "w", label: "stripe", url: "https://other.example.test/" });
  await expect(refusal).rejects.toBeInstanceOf(CredentialedRequestValidationError);
  await expect(refusal).rejects.toThrow(/saved hosts \(.*\) — add it in the host's form first$/);
  expect((await ops.resolveRequestTarget(deps, { workspaceId: "w", label: "stripe", url: "https://api.example.test/a" })).url.href).toBe("https://api.example.test/a");
  expect(decrypts).toEqual([]);
});

it("rethrows the host's egress refusal by identity", async () => {
  const refused = new HostEgressRefusedError({ message: "refused 10.0.0.1" }, { callerSafeMessage: "refused" });
  const { ops, deps } = setup(async () => { throw refused; });
  await expect(ops.makeCredentialedRequest(deps, { workspaceId: "w", label: "stripe", method: "GET", url: "https://api.example.test/" })).rejects.toBe(refused);
});

it("probes through the client passed per call", async () => {
  const { ops, sent } = setup(ok);
  const other: { request: HttpRequest }[] = [];
  const status = await ops.probeCredentialConnection({ connection: resolved.connection, url: "https://api.example.test/me", schemes: [] }, { httpClient: { send: async (request) => { other.push({ request }); return ok(); } } });
  expect(status).toBe("ok");
  expect(other).toHaveLength(1);
  expect(sent).toHaveLength(0);
});
