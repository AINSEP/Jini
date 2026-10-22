import { expect, test } from "vitest";
import {
  buildAuthorizationHeader, InMemoryCredentialedRequestAuditLog, makeCredentialedRequest,
  resolveRequestTarget, verifyCustomCredential, CredentialedRequestTransportError,
  type CredentialedRequestDeps,
} from "../index.js";
import { createCustomCredential, makeWriteDeps } from "./resolver-fixtures.js";
import type { HttpRequest } from "@jini-ai/core/primitives";


async function rig(status = 200) {
  const base = makeWriteDeps();
  await createCustomCredential(base, { workspaceId: "workspace", label: "endpoint", category: "general", baseUrl: "https://endpoint.example", connection: { token: "long-synthetic-token" } });
  const requests: HttpRequest[] = [];
  const deps: CredentialedRequestDeps = {
    resolver: base.repo, clock: base.clock, audit: new InMemoryCredentialedRequestAuditLog(),
    schemeRegistry: { load: async () => [] },
    httpClient: { send: async ({ request }) => { requests.push(request); return { status, headers: {}, bodyText: "response" }; } },
  };
  return { base, requests, deps };
}
const input = { workspaceId: "workspace", label: "endpoint", method: "POST", url: "https://endpoint.example/resource" };

test("optional HTTP body and headers live in argument two and reach the client", async () => {
  const { deps, requests } = await rig();
  await makeCredentialedRequest({ deps, input }, { body: "payload", headers: { "content-type": "text/plain" } });
  expect(requests[0]).toEqual({ method: "POST", url: input.url, timeoutMs: 10_000, body: "payload", headers: { "content-type": "text/plain", Authorization: "Bearer long-synthetic-token" } });
});

test("target preview uses describe without resolving plaintext", async () => {
  const { base } = await rig();
  const preview = await resolveRequestTarget({ resolver: base.repo, input });
  expect(preview.url.origin).toBe("https://endpoint.example");
  expect(base.repo.describeCalls).toBe(1);
  expect(base.repo.resolveCalls).toBe(0);
});

test("resolver isolates identical labels across workspaces", async () => {
  const { deps, requests } = await rig();
  await expect(makeCredentialedRequest({ deps, input: { ...input, workspaceId: "other" } })).rejects.toThrow("no custom credential");
  expect(requests).toEqual([]);
});

test("the required scheme registry changes the actual authorization scheme", async () => {
  const { deps, requests, base } = await rig();
  await createCustomCredential(base, { workspaceId: "workspace", label: "endpoint", category: "general", baseUrl: "https://endpoint.example", connection: { token: "OtherV1credential-value", username: "leftover" } });
  await makeCredentialedRequest({ deps, input });
  await makeCredentialedRequest({ deps: { ...deps, schemeRegistry: { load: async () => [{ id: "other", prefix: "OtherV1", scheme: "Other" }] } }, input });
  expect(requests[0]?.headers.Authorization).toBe(`Basic ${Buffer.from("leftover:OtherV1credential-value").toString("base64")}`);
  expect(requests[1]?.headers.Authorization).toBe("Other credential-value");
});

test("host diagnostics add a remedy only for the Bearer 401 hypothesis", async () => {
  const { deps } = await rig(401);
  const baseline = await verifyCustomCredential({ deps, input });
  const treatment = await verifyCustomCredential({ deps, input }, { diagnosticMapper: ({ diagnostic }) => diagnostic.hint ? { ...diagnostic, remedyToolId: "host.set-username" } : diagnostic });
  expect(baseline.authDiagnostic?.remedyToolId).toBeUndefined();
  expect(treatment.authDiagnostic?.remedyToolId).toBe("host.set-username");
  expect(treatment.authDiagnostic?.schemeSent).toBe("Bearer");
});

test("transport error messages cannot reflect the injected authorization", async () => {
  const { deps } = await rig();
  const header = buildAuthorizationHeader({ connection: { token: "long-synthetic-token" }, schemes: [] });
  await expect(makeCredentialedRequest({ deps: { ...deps, httpClient: { send: async () => { throw new Error(`failed ${header}`); } } }, input })).rejects.toThrow(CredentialedRequestTransportError);
  await expect(makeCredentialedRequest({ deps: { ...deps, httpClient: { send: async () => { throw new Error(`failed ${header}`); } } }, input })).rejects.toThrow("failed [REDACTED]");
});
