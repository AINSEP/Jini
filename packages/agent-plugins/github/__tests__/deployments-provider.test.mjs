import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";

import { createGitHubDeploymentProvider, mapGitHubDeploymentStatus, sendPinned } from "../deployments/github.mjs";

/**
 * @file Regression tests for `../deployments/github.mjs`.
 *
 * Mirrors `src/webhooks/http.memory.ts`'s `RecordingHttpClient` shape (scripted responses in
 * call order, every request recorded) rather than reusing it directly, so this feature's tests do
 * not reach across a feature boundary into `integrations/`'s test infrastructure.
 *
 * Uses `node:test` + `node:assert/strict`, matching this repo's actual test runner
 * (`package.json`'s `test` script: `node --import tsx --test`) — NOT vitest, which several of the
 * peer designs this adapter was built from assumed incorrectly.
 */

class FakeHttpClient {
   calls = [];
   cursor = 0;
  constructor(responses) { this.responses = responses; }

  async send(request) {
    this.calls.push(request);
    const response = this.responses[this.cursor];
    assert.ok(response, `unexpected request: ${request.method} ${request.url}`);
    this.cursor += 1;
    return response;
  }
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const TEST_PRIVATE_KEY_PEM = privateKey;

function jsonResponse(status, body) {
  return { status, headers: {}, bodyText: JSON.stringify(body) };
}

function rawResponse(status, bodyText) {
  return { status, headers: {}, bodyText };
}

/** Always throws — proves the `try/catch` around each `sendPinned` call site (mint, create,
 * poll) surfaces a network failure as a typed, retryable `TRANSPORT_ERROR` instead of an
 * unhandled rejection. */
class ThrowingHttpClient {
  constructor(message) { this.message = message; }
  async send() {
    throw new Error(this.message);
  }
}

/** Like `FakeHttpClient`, but a step may be a thunk that throws instead of a canned response —
 * lets a test succeed on the token mint (call 1) and fail the transport on the second call
 * (deployment create / status poll) without a second class per call site. */
class ScriptedHttpClient {
   calls = [];
   cursor = 0;
  constructor(steps) { this.steps = steps; }

  async send(request) {
    this.calls.push(request);
    const step = this.steps[this.cursor];
    assert.ok(step, `unexpected request: ${request.method} ${request.url}`);
    this.cursor += 1;
    if (typeof step === "function") return step();
    return step;
  }
}

function makeTarget(overrides = {}) {
  return {
    workspaceId: "ws-1",
    id: "target-1",
    environmentId: "env-1",
    providerId: "github",
    label: "Production",
    config: { owner: "acme", repo: "site", environmentName: "production", ...overrides },
    enabled: true,
    createdAtIso: "2026-08-12T00:00:00.000Z",
    version: 1,
  };
}

function makeRelease(overrides = {}) {
  return {
    workspaceId: "ws-1",
    id: "release-1",
    label: "v1.2.3",
    source: { kind: "git-revision", repoUrl: "https://github.com/acme/site", commitSha: "a".repeat(40) },
    createdByPrincipalId: "user-1",
    createdAtIso: "2026-08-12T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function makeContext(http) {
  return {
    credentials: { appId: "1", installationId: "2", privateKeyPem: TEST_PRIVATE_KEY_PEM },
    httpClient: http,
    now: () => Date.parse("2026-08-12T19:00:00Z"),
  };
}

test("startRun mints a token, creates a deployment, and returns a callback-reconciled run ref", async () => {
  const http = new FakeHttpClient([
    jsonResponse(201, { token: "ghs_opaque", expires_at: "2026-08-12T20:00:00Z" }),
    jsonResponse(201, { id: 91 }),
  ]);
  const provider = createGitHubDeploymentProvider();

  const result = await provider.startRun({ target: makeTarget(), release: makeRelease() }, makeContext(http));

  assert.deepEqual(result, { ok: true, providerRunRef: "91", reconciliation: "callback" });
  assert.equal(http.calls.length, 2);
  assert.equal(http.calls[0].url, "https://api.github.com/app/installations/2/access_tokens");
  assert.equal(http.calls[1].url, "https://api.github.com/repos/acme/site/deployments");
  const createBody = JSON.parse(String(http.calls[1].body));
  assert.equal(createBody.ref, "a".repeat(40));
  assert.equal(createBody.environment, "production");
  assert.equal(createBody.production_environment, true);
  assert.deepEqual(createBody, { ref: "a".repeat(40), environment: "production", description: "Tovu deployment of release release-1", auto_merge: false, required_contexts: [], transient_environment: false, production_environment: true });
  const mint = http.calls[0];
  assert.equal(mint.method, "POST");
  assert.deepEqual(JSON.parse(String(mint.body)), { permissions: { deployments: "write" } });
  assert.match(mint.headers.authorization, /^Bearer /);
  const jwt = mint.headers.authorization.slice("Bearer ".length);
  const parts = jwt.split(".");
  assert.equal(parts.length, 3);
  assert.deepEqual(JSON.parse(Buffer.from(parts[0], "base64url").toString()), { alg: "RS256", typ: "JWT" });
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  const now = Date.parse("2026-08-12T19:00:00Z") / 1000;
  assert.deepEqual(claims, { iss: "1", iat: now - 60, exp: now + 9 * 60 });
  assert.ok(claims.exp - claims.iat <= 600);
  assert.equal(verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2], "base64url")), true);
  assert.equal(http.calls[1].method, "POST");
  assert.equal(http.calls[1].headers.authorization, "Bearer ghs_opaque");
  for (const request of http.calls) {
    assert.equal(request.headers.accept, "application/vnd.github+json");
    assert.equal(request.headers["content-type"], "application/json");
    assert.equal(request.headers["x-github-api-version"], "2022-11-28");
  }
});

test("startRun marks staging as non-production and preserves the deployment policy fields", async () => {
  const http = new FakeHttpClient([jsonResponse(201, { token: "staging-token" }), jsonResponse(201, { id: 92 })]);
  const result = await createGitHubDeploymentProvider().startRun({ target: makeTarget({ environmentName: "staging" }), release: makeRelease() }, makeContext(http));
  assert.equal(result.ok, true);
  assert.equal(http.calls.length, 2);
  assert.deepEqual(JSON.parse(String(http.calls[1].body)), { ref: "a".repeat(40), environment: "staging", description: "Tovu deployment of release release-1", auto_merge: false, required_contexts: [], transient_environment: false, production_environment: false });
});

test("startRun rejects an external-artifact release (the honesty constraint)", async () => {
  const http = new FakeHttpClient([jsonResponse(200, {})]);
  const provider = createGitHubDeploymentProvider();

  const result = await provider.startRun(
    { target: makeTarget(), release: makeRelease({ source: { kind: "external-artifact", uri: "https://example.com/x.tgz" } }) },
    makeContext(http)
  );

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "INVALID_RELEASE");
  // No network call was made — the check happens before any credential is even read.
  assert.equal(http.calls.length, 0);
});

test("startRun reports NO_CREDENTIALS_CONFIGURED without ever calling the network", async () => {
  const http = new FakeHttpClient([jsonResponse(200, {})]);
  const provider = createGitHubDeploymentProvider();
  const ctx = { ...makeContext(http), credentials: {} };

  const result = await provider.startRun({ target: makeTarget(), release: makeRelease() }, ctx);

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "NO_CREDENTIALS_CONFIGURED");
  assert.equal(http.calls.length, 0);
});

test("origin pinning: every outbound call stays under https://api.github.com even with hostile owner/repo", async () => {
  const http = new FakeHttpClient([
    jsonResponse(201, { token: "ghs_opaque" }),
    jsonResponse(201, { id: 1 }),
  ]);
  const provider = createGitHubDeploymentProvider();

  const target = makeTarget({ owner: "../../hostile-owner", repo: "../../app/installations/1" });
  const base = makeContext(http);
  const ctx = { ...base, credentials: { ...base.credentials, installationId: "../../hostile-installation" } };
  await provider.startRun({ target, release: makeRelease() }, ctx);
  assert.equal(http.calls.length, 2);
  assert.equal(http.calls[0].url, "https://api.github.com/app/installations/..%2F..%2Fhostile-installation/access_tokens");
  assert.equal(http.calls[1].url, "https://api.github.com/repos/..%2F..%2Fhostile-owner/..%2F..%2Fapp%2Finstallations%2F1/deployments");

  for (const call of http.calls) {
    assert.equal(new URL(call.url).origin, "https://api.github.com");
  }
  // The hostile repo segment must survive as ONE opaque path segment (its "/" characters encoded
  // to %2F) — never split into multiple "/"-delimited segments the URL parser could dot-collapse
  // into an actual path traversal outside /repos/acme/. encodeURIComponent leaves literal "."
  // untouched, which is fine: the danger is unencoded "/", not the dots themselves, and there is
  // exactly one "/" between "acme" and the encoded segment below.
  assert.match(http.calls[1].url, /\/repos\/\.\.%2F\.\.%2Fhostile-owner\/\.\.%2F\.\.%2Fapp%2Finstallations%2F1\/deployments$/);
});

test("sendPinned refuses any request whose resolved origin is not https://api.github.com", async () => {
  // Direct test of the chokepoint itself (see its doc comment): every current adapter call site
  // builds URLs through `githubApiUrl()`, which can only ever resolve under the pinned origin, so
  // an adapter-level test cannot prove this guard is load-bearing — a mutation check confirmed
  // disabling it did not fail any adapter-level test. This is the guard's own proof.
  const http = new FakeHttpClient([jsonResponse(200, {})]);
  const hostile = { method: "GET", url: "https://evil.example.com/steal", headers: {}, timeoutMs: 1000 };

  await assert.rejects(() => sendPinned(http, hostile), /refused to send.*evil\.example\.com/);
  assert.equal(http.calls.length, 0, "the hostile request must never reach the transport");
});

test("pollRun takes the status with the greatest id, not statuses[0] (GitHub documents no response order)", async () => {
  const http = new FakeHttpClient([
    jsonResponse(201, { token: "ghs_opaque" }),
    jsonResponse(200, [
      { id: 1, state: "queued" },
      { id: 3, state: "success" }, // deliberately not first, to falsify a newest-first assumption
      { id: 2, state: "in_progress" },
    ]),
  ]);
  const provider = createGitHubDeploymentProvider();

  const result = await provider.pollRun({ target: makeTarget(), providerRunRef: "42" }, makeContext(http));

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.update.status, "succeeded");
  assert.equal(result.ok && result.update.providerStatusId, "3");
  assert.equal(http.calls.length, 2);
  assert.equal(http.calls[1].url, "https://api.github.com/repos/acme/site/deployments/42/statuses?per_page=100");
  assert.equal(http.calls[1].method, "GET");
  assert.equal(http.calls[1].headers.authorization, "Bearer ghs_opaque");
  assert.equal(http.calls[1].headers.accept, "application/vnd.github+json");
});

test("pollRun returns queued when GitHub has not reported any status yet", async () => {
  const http = new FakeHttpClient([jsonResponse(201, { token: "ghs_opaque" }), jsonResponse(200, [])]);
  const provider = createGitHubDeploymentProvider();

  const result = await provider.pollRun({ target: makeTarget(), providerRunRef: "73" }, makeContext(http));

  assert.deepEqual(result, { ok: true, update: { status: "queued", providerStatusId: null, message: null } });
  assert.equal(http.calls.length, 2);
  assert.equal(http.calls[1].method, "GET");
  assert.equal(http.calls[1].url, "https://api.github.com/repos/acme/site/deployments/73/statuses?per_page=100");
  assert.equal(http.calls[1].headers.authorization, "Bearer ghs_opaque");
});

test("mapGitHubDeploymentStatus covers the real seven-value state enum explicitly", () => {
  const cases = [
    ["error", "failed"],
    ["failure", "failed"],
    ["success", "succeeded"],
    ["inactive", "cancelled"],
    ["in_progress", "running"],
    ["queued", "queued"],
    ["pending", "queued"],
  ];
  for (const [state, expected] of cases) {
    assert.equal(mapGitHubDeploymentStatus({ id: 1, state }).status, expected, `state '${state}'`);
    assert.deepEqual(mapGitHubDeploymentStatus({ id: 23, state, description: "Deployment detail" }), { status: expected, providerStatusId: "23", message: "Deployment detail" });
  }
});

test("mapGitHubDeploymentStatus fails closed to 'running' for an unrecognized future state", () => {
  // Never terminal, so an enum value GitHub adds later cannot be mistaken for success or a
  // permanent failure.
  assert.equal(mapGitHubDeploymentStatus({ id: 1, state: "some_future_state" }).status, "running");
});

test("startRun surfaces a non-2xx token exchange as a typed PROVIDER_ERROR, never a throw", async () => {
  const http = new FakeHttpClient([jsonResponse(403, { message: "installation not found" })]);
  const provider = createGitHubDeploymentProvider();

  const result = await provider.startRun({ target: makeTarget(), release: makeRelease() }, makeContext(http));

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "PROVIDER_ERROR");
  assert.equal(!result.ok && result.error.providerStatus, 403);
  assert.equal(!result.ok && result.error.retryable, false, "a 4xx token-exchange failure is not retryable");
});

test("startRun marks a 5xx token-exchange failure as retryable", async () => {
  const http = new FakeHttpClient([jsonResponse(502, { message: "bad gateway" })]);
  const provider = createGitHubDeploymentProvider();

  const result = await provider.startRun({ target: makeTarget(), release: makeRelease() }, makeContext(http));

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "PROVIDER_ERROR");
  assert.equal(!result.ok && result.error.message, "GitHub installation token exchange failed: 502");
  assert.equal(!result.ok && result.error.providerStatus, 502);
  assert.equal(!result.ok && result.error.retryable, true);
});

test("startRun and pollRun report INVALID_TARGET_CONFIG for each missing or malformed github field", async () => {
  const invalidConfigs = [
    ["owner not a string", { owner: 42 }],
    ["owner empty", { owner: "" }],
    ["repo not a string", { repo: 42 }],
    ["repo empty", { repo: "" }],
    ["environmentName not a string", { environmentName: 42 }],
    ["environmentName empty", { environmentName: "" }],
  ];

  for (const [label, overrides] of invalidConfigs) {
    const http = new FakeHttpClient([jsonResponse(200, {})]);
    const provider = createGitHubDeploymentProvider();
    const target = makeTarget(overrides);

    const startResult = await provider.startRun({ target, release: makeRelease() }, makeContext(http));
    assert.equal(startResult.ok, false, `startRun should reject ${label}`);
    assert.equal(!startResult.ok && startResult.error.code, "INVALID_TARGET_CONFIG", label);
    assert.equal(
      !startResult.ok && startResult.error.message,
      "github target is missing owner/repo/environmentName",
      label
    );

    const pollResult = await provider.pollRun({ target, providerRunRef: "42" }, makeContext(http));
    assert.equal(pollResult.ok, false, `pollRun should reject ${label}`);
    assert.equal(!pollResult.ok && pollResult.error.code, "INVALID_TARGET_CONFIG", label);

    assert.equal(http.calls.length, 0, `${label}: no network call should be made`);
  }
});

test("pollRun reports INVALID_TARGET_CONFIG for a providerRunRef that is not a positive github deployment id", async () => {
  for (const bad of ["0", "-1", "abc", "1.5", "", "007", "../../hostile/run"]) {
    const http = new FakeHttpClient([jsonResponse(200, {})]);
    const provider = createGitHubDeploymentProvider();

    const result = await provider.pollRun({ target: makeTarget(), providerRunRef: bad }, makeContext(http));

    assert.equal(result.ok, false, `providerRunRef '${bad}' should be rejected`);
    assert.equal(!result.ok && result.error.code, "INVALID_TARGET_CONFIG", bad);
    assert.equal(!result.ok && result.error.message, "providerRunRef is not a github deployment id", bad);
    assert.equal(http.calls.length, 0, bad);
  }
});

test("pollRun reports NO_CREDENTIALS_CONFIGURED without ever calling the network", async () => {
  const http = new FakeHttpClient([jsonResponse(200, {})]);
  const provider = createGitHubDeploymentProvider();
  const ctx = { ...makeContext(http), credentials: {} };

  const result = await provider.pollRun({ target: makeTarget(), providerRunRef: "42" }, ctx);

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "NO_CREDENTIALS_CONFIGURED");
  assert.equal(http.calls.length, 0);
});

test("startRun reports NO_CREDENTIALS_CONFIGURED for each partially-configured credential set", async () => {
  const partialSets = [
    ["appId only", { appId: "1" }],
    ["appId and installationId, no privateKeyPem", { appId: "1", installationId: "2" }],
  ];

  for (const [label, credentials] of partialSets) {
    const http = new FakeHttpClient([jsonResponse(200, {})]);
    const provider = createGitHubDeploymentProvider();
    const ctx = { ...makeContext(http), credentials };

    const result = await provider.startRun({ target: makeTarget(), release: makeRelease() }, ctx);

    assert.equal(result.ok, false, label);
    assert.equal(!result.ok && result.error.code, "NO_CREDENTIALS_CONFIGURED", label);
    assert.equal(http.calls.length, 0, label);
  }
});

test("startRun surfaces a token-mint transport failure as a typed, retryable TRANSPORT_ERROR", async () => {
  const provider = createGitHubDeploymentProvider();
  const ctx = makeContext(new ThrowingHttpClient("socket hang up"));

  const result = await provider.startRun({ target: makeTarget(), release: makeRelease() }, ctx);

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "TRANSPORT_ERROR");
  assert.equal(!result.ok && result.error.message, "socket hang up");
  assert.equal(!result.ok && result.error.retryable, true);
});

test("startRun surfaces a malformed token-exchange body as PROVIDER_RESPONSE_INVALID", async () => {
  const http = new FakeHttpClient([rawResponse(201, "not json")]);
  const provider = createGitHubDeploymentProvider();

  const result = await provider.startRun({ target: makeTarget(), release: makeRelease() }, makeContext(http));

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "PROVIDER_RESPONSE_INVALID");
  assert.equal(!result.ok && result.error.message, "GitHub returned invalid JSON minting an installation token");
});

test("startRun surfaces an empty or malformed installation token as PROVIDER_RESPONSE_INVALID", async () => {
  for (const body of [{}, { token: "" }, { token: 123 }]) {
    const http = new FakeHttpClient([jsonResponse(201, body)]);
    const provider = createGitHubDeploymentProvider();

    const result = await provider.startRun({ target: makeTarget(), release: makeRelease() }, makeContext(http));

    const label = JSON.stringify(body);
    assert.equal(result.ok, false, label);
    assert.equal(!result.ok && result.error.code, "PROVIDER_RESPONSE_INVALID", label);
    assert.equal(!result.ok && result.error.message, "GitHub returned an empty installation token", label);
  }
});

test("startRun surfaces a deployment-create transport failure as a typed, retryable TRANSPORT_ERROR", async () => {
  const http = new ScriptedHttpClient([
    jsonResponse(201, { token: "ghs_opaque" }),
    () => {
      throw new Error("connection reset");
    },
  ]);
  const provider = createGitHubDeploymentProvider();

  const result = await provider.startRun({ target: makeTarget(), release: makeRelease() }, makeContext(http));

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "TRANSPORT_ERROR");
  assert.equal(!result.ok && result.error.message, "connection reset");
  assert.equal(!result.ok && result.error.retryable, true);
});

test("startRun surfaces a non-2xx deployment-create response as PROVIDER_ERROR with correct retryability", async () => {
  const cases = [
    [422, false],
    [503, true],
  ];
  for (const [status, retryable] of cases) {
    const http = new ScriptedHttpClient([jsonResponse(201, { token: "ghs_opaque" }), jsonResponse(status, { message: "nope" })]);
    const provider = createGitHubDeploymentProvider();

    const result = await provider.startRun({ target: makeTarget(), release: makeRelease() }, makeContext(http));

    assert.equal(result.ok, false, String(status));
    assert.equal(!result.ok && result.error.code, "PROVIDER_ERROR", String(status));
    assert.equal(!result.ok && result.error.message, `GitHub deployment create failed: ${status}`, String(status));
    assert.equal(!result.ok && result.error.providerStatus, status, String(status));
    assert.equal(!result.ok && result.error.retryable, retryable, String(status));
  }
});

test("startRun surfaces a malformed deployment-create body as PROVIDER_RESPONSE_INVALID", async () => {
  const http = new ScriptedHttpClient([jsonResponse(201, { token: "ghs_opaque" }), rawResponse(201, "not json")]);
  const provider = createGitHubDeploymentProvider();

  const result = await provider.startRun({ target: makeTarget(), release: makeRelease() }, makeContext(http));

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "PROVIDER_RESPONSE_INVALID");
  assert.equal(!result.ok && result.error.message, "GitHub returned invalid JSON creating a deployment");
});

test("startRun surfaces an invalid deployment id as PROVIDER_RESPONSE_INVALID", async () => {
  for (const body of [{}, { id: "91" }, { id: -1 }, { id: 0 }, { id: 1.5 }]) {
    const http = new ScriptedHttpClient([jsonResponse(201, { token: "ghs_opaque" }), jsonResponse(201, body)]);
    const provider = createGitHubDeploymentProvider();

    const result = await provider.startRun({ target: makeTarget(), release: makeRelease() }, makeContext(http));

    const label = JSON.stringify(body);
    assert.equal(result.ok, false, label);
    assert.equal(!result.ok && result.error.code, "PROVIDER_RESPONSE_INVALID", label);
    assert.equal(!result.ok && result.error.message, "GitHub returned an invalid deployment id", label);
  }
});

test("pollRun returns the token-mint error without polling statuses when minting fails", async () => {
  const http = new FakeHttpClient([jsonResponse(403, { message: "bad app" })]);
  const provider = createGitHubDeploymentProvider();

  const result = await provider.pollRun({ target: makeTarget(), providerRunRef: "42" }, makeContext(http));

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "PROVIDER_ERROR");
  assert.equal(!result.ok && result.error.message, "GitHub installation token exchange failed: 403");
  assert.equal(http.calls.length, 1, "must not proceed to poll statuses after a failed mint");
});

test("pollRun surfaces a status-poll transport failure as a typed, retryable TRANSPORT_ERROR", async () => {
  const http = new ScriptedHttpClient([
    jsonResponse(201, { token: "ghs_opaque" }),
    () => {
      throw new Error("dns failure");
    },
  ]);
  const provider = createGitHubDeploymentProvider();

  const result = await provider.pollRun({ target: makeTarget(), providerRunRef: "42" }, makeContext(http));

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "TRANSPORT_ERROR");
  assert.equal(!result.ok && result.error.message, "dns failure");
  assert.equal(!result.ok && result.error.retryable, true);
});

test("pollRun surfaces a non-2xx status-poll response as PROVIDER_ERROR with correct retryability", async () => {
  const cases = [
    [404, false],
    [500, true],
  ];
  for (const [status, retryable] of cases) {
    const http = new ScriptedHttpClient([jsonResponse(201, { token: "ghs_opaque" }), jsonResponse(status, { message: "nope" })]);
    const provider = createGitHubDeploymentProvider();

    const result = await provider.pollRun({ target: makeTarget(), providerRunRef: "42" }, makeContext(http));

    assert.equal(result.ok, false, String(status));
    assert.equal(!result.ok && result.error.code, "PROVIDER_ERROR", String(status));
    assert.equal(!result.ok && result.error.message, `GitHub deployment status poll failed: ${status}`, String(status));
    assert.equal(!result.ok && result.error.providerStatus, status, String(status));
    assert.equal(!result.ok && result.error.retryable, retryable, String(status));
  }
});

test("pollRun surfaces a malformed status-poll body as PROVIDER_RESPONSE_INVALID", async () => {
  const http = new ScriptedHttpClient([jsonResponse(201, { token: "ghs_opaque" }), rawResponse(200, "not json")]);
  const provider = createGitHubDeploymentProvider();

  const result = await provider.pollRun({ target: makeTarget(), providerRunRef: "42" }, makeContext(http));

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "PROVIDER_RESPONSE_INVALID");
  assert.equal(!result.ok && result.error.message, "GitHub returned a malformed statuses response");
});

test("pollRun surfaces a non-array status-poll body as PROVIDER_RESPONSE_INVALID", async () => {
  const http = new ScriptedHttpClient([jsonResponse(201, { token: "ghs_opaque" }), jsonResponse(200, { not: "an array" })]);
  const provider = createGitHubDeploymentProvider();

  const result = await provider.pollRun({ target: makeTarget(), providerRunRef: "42" }, makeContext(http));

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "PROVIDER_RESPONSE_INVALID");
  assert.equal(!result.ok && result.error.message, "GitHub returned a malformed statuses response");
});

test("mapGitHubDeploymentStatus sanitizes CR/LF/NUL out of a status description", () => {
  const result = mapGitHubDeploymentStatus({ id: 7, state: "success", description: "line1\r\nline2\x00tail" });
  assert.equal(result.message, "line1  line2 tail");
});

test("mapGitHubDeploymentStatus truncates a status description to 500 characters", () => {
  const long = "x".repeat(600);
  const result = mapGitHubDeploymentStatus({ id: 7, state: "success", description: long });
  assert.equal(result.message, "x".repeat(500));
});

test("mapGitHubDeploymentStatus reports absent and non-string descriptions as null", () => {
  for (const description of [undefined, null, 123]) {
    // @ts-expect-error — the provider can return malformed descriptions at runtime
    assert.equal(mapGitHubDeploymentStatus({ id: 7, state: "success", description }).message, null);
  }
});

test("a non-Error transport throw at each call site (mint, create, poll) is reported by its string form", async () => {
  const provider = createGitHubDeploymentProvider();
  const thrown = (value) => () => { throw value; };
  const mint = await provider.startRun({ target: makeTarget(), release: makeRelease() }, makeContext(new ScriptedHttpClient([thrown("mint refused")])));
  const create = await provider.startRun({ target: makeTarget(), release: makeRelease() }, makeContext(new ScriptedHttpClient([jsonResponse(201, { token: "ghs_opaque" }), thrown(503)])));
  const poll = await provider.pollRun({ target: makeTarget(), providerRunRef: "42" }, makeContext(new ScriptedHttpClient([jsonResponse(201, { token: "ghs_opaque" }), thrown({ toString: () => "poll refused" })])));
  for (const [result, message] of [[mint, "mint refused"], [create, "503"], [poll, "poll refused"]]) {
    assert.equal(!result.ok && result.error.code, "TRANSPORT_ERROR");
    assert.equal(!result.ok && result.error.message, message);
    assert.equal(!result.ok && result.error.retryable, true);
  }
});
