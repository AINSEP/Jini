import assert from "node:assert/strict";
import { test } from "vitest";
import type { HttpClientPort, HttpRequest, HttpResponse, RequestRedirect } from "@jini-ai/core/primitives";
import {
  CredentialedRequestValidationError,
  InMemoryCredentialedRequestAuditLog,
  probeCredentialConnection,
  verifyCustomCredential,
  type CredentialConnectionProbeInput,
  type CredentialedRequestDeps,
} from "../index.js";
import { createCustomCredential, makeWriteDeps } from "./resolver-fixtures.js";

const TOKEN = "synthetic-private-probe-token";
const URL = "https://api.example/v1/user";
const INPUT = { connection: { token: TOKEN }, url: URL, schemes: [] };

/** Capture the complete request and redirect policy while returning a scripted provider outcome. */
function clientFor(outcome: HttpResponse | Error = { status: 200, headers: {}, bodyText: "" }) {
  const requests: HttpRequest[] = [];
  const redirects: (RequestRedirect | undefined)[] = [];
  const httpClient: HttpClientPort = {
    async send({ request }, optional) {
      requests.push(request);
      redirects.push(optional?.redirect);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
  return { httpClient, requests, redirects };
}

test.each([
  [200, "ok"], [204, "ok"], [299, "ok"],
  [401, "refused"], [403, "refused"],
  [301, "unavailable"], [302, "unavailable"], [307, "unavailable"], [308, "unavailable"],
  [400, "unavailable"], [404, "unavailable"], [429, "unavailable"],
  [500, "unavailable"], [503, "unavailable"],
] as const)("probe classifies HTTP %i as %s without exposing a reflected secret", async (status, expected) => {
  const client = clientFor({ status, headers: { "x-echo": TOKEN, location: "https://other.example" }, bodyText: TOKEN });
  const result = await probeCredentialConnection(INPUT, client);
  assert.equal(result, expected);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
  assert.equal(client.requests.length, 1);
});

test("probe sends only one bodyless GET, refuses redirects and bounds its whole operation", async () => {
  const client = clientFor();
  await probeCredentialConnection({ ...INPUT, method: "GET" }, client);
  assert.deepEqual(client.requests, [{
    method: "GET", url: URL, headers: { Authorization: `Bearer ${TOKEN}` },
    timeoutMs: 10_000, totalDeadlineMs: 10_000,
  }]);
  assert.deepEqual(client.redirects, ["error"]);
});

test.each(["POST", "PUT", "PATCH", "DELETE", "HEAD", "get", "", TOKEN])(
  "probe rejects an explicit non-GET method (%s) before sending", async method => {
    const client = clientFor();
    const input = { ...INPUT, method } as unknown as CredentialConnectionProbeInput;
    await assert.rejects(probeCredentialConnection(input, client), error => {
      assert.ok(error instanceof CredentialedRequestValidationError);
      assert.equal(error.message, "credential probes only support GET");
      assert.equal(error.cause, undefined);
      assert.equal(error.stack?.includes(TOKEN), false);
      return true;
    });
    assert.deepEqual(client.requests, []);
  },
);

test("probe never forwards a body smuggled through an untyped caller", async () => {
  const client = clientFor();
  const input = { ...INPUT, body: TOKEN };
  await probeCredentialConnection(input, client);
  assert.equal(Object.hasOwn(client.requests[0]!, "body"), false);
});

test.each([new Error(`network failure: Bearer ${TOKEN}`), new Error(`redirect refused: ${TOKEN}`)])(
  "probe returns unavailable without leaking transport errors", async error => {
    const result = await probeCredentialConnection(INPUT, clientFor(error));
    assert.equal(result, "unavailable");
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
  },
);

test.each([
  { connection: { token: TOKEN }, schemes: [], header: `Bearer ${TOKEN}` },
  { connection: { token: TOKEN, username: "account" }, schemes: [], header: `Basic ${Buffer.from(`account:${TOKEN}`).toString("base64")}` },
  { connection: { token: `FlyV1${TOKEN}`, username: "leftover" }, schemes: [{ id: "fly", prefix: "FlyV1", scheme: "FlyV1" }], header: `FlyV1 ${TOKEN}` },
])("probe reuses authentication precedence for $header", async ({ connection, schemes, header }) => {
  const client = clientFor();
  await probeCredentialConnection({ connection, schemes, url: URL }, client);
  assert.equal(client.requests[0]?.headers.Authorization, header);
});

test.each([`${TOKEN} invalid URL`, `https://account:${TOKEN}@api.example/`, `file:///${TOKEN}`])(
  "probe rejects malformed or credential-bearing URLs without reflecting input", async url => {
    const client = clientFor();
    await assert.rejects(probeCredentialConnection({ ...INPUT, url }, client), error => {
      assert.ok(error instanceof CredentialedRequestValidationError);
      assert.equal(error.message, "credential probe requires an absolute HTTP(S) URL without embedded credentials");
      assert.equal(error.cause, undefined);
      assert.equal(error.stack?.includes(TOKEN), false);
      return true;
    });
    assert.deepEqual(client.requests, []);
  },
);

/** Use the real resolver fixture to exercise verification's path binding and audit boundary. */
async function verificationRig(outcome?: HttpResponse | Error) {
  const base = makeWriteDeps();
  await createCustomCredential(base, {
    workspaceId: "workspace", label: "endpoint", category: "general",
    baseUrl: "https://api.example/v1/", additionalHosts: ["https://other.example"], connection: INPUT.connection,
  });
  const client = clientFor(outcome);
  const audit = new InMemoryCredentialedRequestAuditLog();
  const deps: CredentialedRequestDeps = {
    resolver: base.repo, clock: base.clock, audit, httpClient: client.httpClient,
    schemeRegistry: { load: async () => [] },
  };
  return { deps, client, audit, input: { workspaceId: "workspace", label: "endpoint" } };
}

test.each([[undefined, "https://api.example/"], ["user", URL], ["/owners", "https://api.example/owners"]] as const)(
  "verification resolves path %s while retaining root behavior by default", async (path, expectedUrl) => {
    const rig = await verificationRig();
    const result = await verifyCustomCredential(rig, path === undefined ? {} : { path });
    assert.equal(result.status, "valid");
    assert.equal(rig.client.requests[0]?.url, expectedUrl);
    assert.equal(rig.client.requests[0]?.method, "GET");
    // Verification keeps its pre-probe transport policy: default redirects, idle timeout only.
    assert.deepEqual(rig.client.redirects, [undefined]);
    assert.equal(Object.hasOwn(rig.client.requests[0]!, "totalDeadlineMs"), false);
    assert.deepEqual(rig.audit.entries, [{
      label: "endpoint", host: "api.example", method: "GET", status: 200,
      bodyBytes: 0, at: "2026-08-31T00:00:00.000Z",
    }]);
  },
);

test.each([
  "https://api.example/user", "https://other.example/user", "//api.example/user", "//other.example/user",
  "\\\\other.example/user", "/\\other.example/user", `https://other.example/${TOKEN}`, "data:text/plain,hello", " ",
  "ht\ttps://api.example/user", "/\n/api.example/user",
])("verification rejects absolute, cross-origin or blank paths before sending (%s)", async path => {
  const rig = await verificationRig();
  await assert.rejects(verifyCustomCredential(rig, { path }), error => {
    assert.ok(error instanceof CredentialedRequestValidationError);
    assert.equal(error.message, "probe path must be relative to the saved base URL and remain on its origin");
    assert.equal(error.cause, undefined);
    assert.equal(error.stack?.includes(TOKEN), false);
    return true;
  });
  assert.deepEqual(rig.client.requests, []);
  assert.deepEqual(rig.audit.entries, []);
});

test.each([401, 403])("verification preserves HTTP %i audit and diagnostic semantics through the shared probe", async status => {
  const rig = await verificationRig({ status, headers: { "x-echo": TOKEN }, bodyText: TOKEN });
  const mappedStatuses: number[] = [];
  const result = await verifyCustomCredential(rig, { path: "/user", diagnosticMapper: ({ diagnostic, status }) => {
    mappedStatuses.push(status);
    return { ...diagnostic, remedyToolId: "host.remedy" };
  } });
  assert.equal(result.status, "invalid");
  assert.equal(result.message.includes(`HTTP ${status}`), true);
  assert.deepEqual(result.authDiagnostic, {
    schemeSent: "Bearer", usernameStored: false, remedyToolId: "host.remedy",
    ...(status === 401 ? { hint: "This request was sent with a Bearer token and no saved username. Some providers (e.g. ones that authenticate a token against an account username via HTTP Basic) may reject a Bearer-only request for that reason — this credential has no username saved. If that's the cause, saving one may fix it." } : {}),
  });
  assert.deepEqual(mappedStatuses, [status]);
  assert.equal(rig.audit.entries[0]?.status, status);
  assert.equal(JSON.stringify({ result, audit: rig.audit.entries }).includes(TOKEN), false);
});

test("verification retains unreachable transport handling without leaking a secret in its audit", async () => {
  const rig = await verificationRig(new Error(`failed ${TOKEN}`));
  const result = await verifyCustomCredential(rig, { path: "/user" });
  assert.deepEqual(result, {
    status: "unreachable", message: "Could not reach 'endpoint' to verify this credential — this does not necessarily mean the credential is bad.",
    checkedAt: "2026-08-31T00:00:00.000Z",
  });
  assert.equal(rig.audit.entries[0]?.status, 0);
  assert.equal(JSON.stringify({ result, audit: rig.audit.entries }).includes(TOKEN), false);
});

test("verification with a corrupt stored baseUrl fails with the same value-free error and sends nothing", async () => {
  // Covers resolveVerificationUrl's catch: a stored base that no longer parses (e.g. hand-edited
  // storage) must not echo the stored value nor reach the HTTP client.
  const rig = await verificationRig();
  const resolve = rig.deps.resolver.resolve.bind(rig.deps.resolver);
  const corrupted: CredentialedRequestDeps = {
    ...rig.deps,
    resolver: { ...rig.deps.resolver, resolve: async (input) => {
      const credential = await resolve(input);
      return credential && { ...credential, baseUrl: `not a url ${TOKEN}` };
    } },
  };
  for (const path of [undefined, "/owners"]) {
    await assert.rejects(verifyCustomCredential({ ...rig, deps: corrupted }, path === undefined ? {} : { path }), error => {
      assert.ok(error instanceof CredentialedRequestValidationError);
      assert.equal(error.message, "probe path must be relative to the saved base URL and remain on its origin");
      assert.equal(error.stack?.includes(TOKEN), false);
      return true;
    });
  }
  assert.deepEqual(rig.client.requests, []);
});
