import assert from "node:assert/strict";
import { test } from "vitest";

import { makeCredentialedRequest as request, verifyCustomCredential as verify, InMemoryCredentialedRequestAuditLog, type AuthFailureDiagnostic, type CredentialedRequestDeps } from "../credentialed-request.js";
import type { HttpClientPort, HttpRequest, HttpResponse } from "@jini-ai/core/primitives";

import { loadBundledAuthSchemes, createCustomCredential, makeWriteDeps, type CustomCredentialWriteDeps } from "./resolver-fixtures.js";

const WORKSPACE = "ws-1";

class FakeHttpClient implements HttpClientPort {
  readonly calls: HttpRequest[] = [];
  private readonly responses: (HttpResponse | Error)[];
  private cursor = 0;
  constructor(responses: (HttpResponse | Error)[] = [{ status: 200, headers: {}, bodyText: "" }]) {
    this.responses = responses;
  }
  async send({ request }: { request: HttpRequest }): Promise<HttpResponse> {
    this.calls.push(request);
    const next = this.responses[Math.min(this.cursor, this.responses.length - 1)]!;
    this.cursor += 1;
    if (next instanceof Error) throw next;
    return next;
  }
}

async function seedWithoutUsername(): Promise<CustomCredentialWriteDeps> {
  const writeDeps = makeWriteDeps();
  await createCustomCredential(writeDeps, {
    workspaceId: WORKSPACE,
    label: "basic.example",
    category: "hosting",
    baseUrl: "https://api.basic.example",
    connection: { token: "basic-secret-token" },
  });
  return writeDeps;
}

async function seedWithUsername(): Promise<CustomCredentialWriteDeps> {
  const writeDeps = makeWriteDeps();
  await createCustomCredential(writeDeps, {
    workspaceId: WORKSPACE,
    label: "basic.example",
    category: "hosting",
    baseUrl: "https://api.basic.example",
    connection: { token: "basic-secret-token", username: "synthetic-user" },
  });
  return writeDeps;
}

function makeDeps(httpClient: HttpClientPort, base: CustomCredentialWriteDeps): CredentialedRequestDeps {
  return { resolver: base.repo, clock: base.clock, httpClient, schemeRegistry: { load: loadBundledAuthSchemes }, audit: new InMemoryCredentialedRequestAuditLog() };
}

const options = { diagnosticMapper: ({ diagnostic }: { diagnostic: AuthFailureDiagnostic }) => diagnostic.hint ? { ...diagnostic, remedyToolId: "set-account-username" } : diagnostic };
function makeCredentialedRequest(deps: CredentialedRequestDeps, input: Parameters<typeof request>[0]["input"]) { return request({ deps, input }, options); }
function verifyCustomCredential(deps: CredentialedRequestDeps, input: Parameters<typeof verify>[0]["input"]) { return verify({ deps, input }, options); }

test("makeCredentialedRequest: a 401 with Bearer sent and no username stored carries an honest, narrow authDiagnostic hint", async () => {
  const writeDeps = await seedWithoutUsername();
  const httpClient = new FakeHttpClient([{ status: 401, headers: {}, bodyText: "unauthorized" }]);
  const deps = makeDeps(httpClient, writeDeps);

  const result = await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "GET", url: "https://api.basic.example/v4/domains" });

  assert.equal(result.status, 401);
  assert.equal(result.bodyText, "unauthorized");
  assert.ok(result.authDiagnostic, "expected an authDiagnostic on a 401 with no stored username");
  assert.equal(result.authDiagnostic!.schemeSent, "Bearer");
  assert.equal(result.authDiagnostic!.usernameStored, false);
  assert.ok(result.authDiagnostic!.hint, "expected a hint for the Bearer+no-username case");
  assert.match(result.authDiagnostic!.hint!, /username/i);
  assert.match(result.authDiagnostic!.hint!, /may|might|could/i);
});

test("makeCredentialedRequest: a 403 with Bearer sent and no username stored still reports the two structured facts (not just 401)", async () => {
  const writeDeps = await seedWithoutUsername();
  const httpClient = new FakeHttpClient([{ status: 403, headers: {}, bodyText: "forbidden" }]);
  const deps = makeDeps(httpClient, writeDeps);

  const result = await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "GET", url: "https://api.basic.example/v4/domains" });

  assert.ok(result.authDiagnostic, "the structured facts must still be present on a 403");
  assert.equal(result.authDiagnostic!.schemeSent, "Bearer");
  assert.equal(result.authDiagnostic!.usernameStored, false);
});

test("makeCredentialedRequest: a 403 with Bearer sent and no username stored carries NO hint — the live GitHub incident this fix addresses (2026-09-03). A saved GitHub PAT with full scopes 403'd because the outbound request carried no User-Agent header, not because of the auth scheme; the old logic offered the Basic-auth hint on ANY 401-or-403 and sent the owner down a dead-end repair path (asked for and saved a GitHub username; the retry still 403'd). 403 Forbidden covers causes unrelated to auth scheme in general — scopes, provider policy, a missing standard header — so this module now offers the scheme hypothesis only for a 401 (see credentialed-request.ts's header, '401 vs 403').", async () => {
  const writeDeps = await seedWithoutUsername();
  const httpClient = new FakeHttpClient([{ status: 403, headers: {}, bodyText: "forbidden" }]);
  const deps = makeDeps(httpClient, writeDeps);

  const result = await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "GET", url: "https://api.basic.example/v4/domains" });

  assert.equal(result.authDiagnostic!.hint, undefined, "a 403 must never suggest the Basic-auth/username hypothesis — that cause is unproven and was confirmed wrong for GitHub");
  assert.equal(result.authDiagnostic!.remedyToolId, undefined, "remedyToolId travels only alongside hint, never alone");
});

test("makeCredentialedRequest: a 401 on a credential that ALREADY has a stored username reports the facts but no hint — a different, unguessable cause", async () => {
  const writeDeps = await seedWithUsername();
  const httpClient = new FakeHttpClient([{ status: 401, headers: {}, bodyText: "unauthorized" }]);
  const deps = makeDeps(httpClient, writeDeps);

  const result = await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "GET", url: "https://api.basic.example/v4/domains" });

  assert.ok(result.authDiagnostic, "structured facts (scheme/usernameStored) must still be present");
  assert.equal(result.authDiagnostic!.schemeSent, "Basic");
  assert.equal(result.authDiagnostic!.usernameStored, true);
  assert.equal(result.authDiagnostic!.hint, undefined, "must NOT suggest 'add a username' when one is already saved");
});

test("makeCredentialedRequest: a 401 on a self-describing-scheme token (CustomV1) reports schemeSent as the scheme actually sent, with NO hint — a different, unguessable cause since the scheme was already correct (2026-09-03, the Fly.io incident)", async () => {
  const writeDeps = makeWriteDeps();
  await createCustomCredential(writeDeps, {
    workspaceId: WORKSPACE,
    label: "token.example",
    category: "ops",
    baseUrl: "https://api.token.example",
    connection: { token: "CustomV1fake_test_token_value" },
  });
  const httpClient = new FakeHttpClient([{ status: 401, headers: {}, bodyText: "unauthorized" }]);
  const deps = makeDeps(httpClient, writeDeps);

  const result = await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "token.example", method: "GET", url: "https://api.token.example/v1/apps/my-app" });

  assert.ok(result.authDiagnostic);
  assert.equal(result.authDiagnostic!.schemeSent, "CustomV1");
  assert.equal(result.authDiagnostic!.usernameStored, false);
  assert.equal(result.authDiagnostic!.hint, undefined, "a self-describing scheme was already sent correctly — the Bearer-hint hypothesis does not apply");
  assert.equal(result.authDiagnostic!.remedyToolId, undefined);
});

test("makeCredentialedRequest: a self-describing-scheme token WITH a leftover saved username still reports the scheme it actually sent (CustomV1), not Basic — schemeSent never drifts from buildAuthorizationHeader's own precedence", async () => {
  const writeDeps = makeWriteDeps();
  await createCustomCredential(writeDeps, {
    workspaceId: WORKSPACE,
    label: "token.example",
    category: "ops",
    baseUrl: "https://api.token.example",
    connection: { token: "CustomV1fake_test_token_value", username: "leftover-username" },
  });
  const httpClient = new FakeHttpClient([{ status: 401, headers: {}, bodyText: "unauthorized" }]);
  const deps = makeDeps(httpClient, writeDeps);

  const result = await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "token.example", method: "GET", url: "https://api.token.example/v1/apps/my-app" });

  assert.equal(result.authDiagnostic!.schemeSent, "CustomV1");
  assert.equal(result.authDiagnostic!.usernameStored, true);
  assert.equal(result.authDiagnostic!.hint, undefined);
});

test("makeCredentialedRequest: a 200 response carries no authDiagnostic at all", async () => {
  const writeDeps = await seedWithoutUsername();
  const httpClient = new FakeHttpClient([{ status: 200, headers: {}, bodyText: "ok" }]);
  const deps = makeDeps(httpClient, writeDeps);

  const result = await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "GET", url: "https://api.basic.example/v4/domains" });

  assert.equal("authDiagnostic" in result, false);
});

test("makeCredentialedRequest: a 404 (not an auth failure) carries no authDiagnostic — only 401/403 do", async () => {
  const writeDeps = await seedWithoutUsername();
  const httpClient = new FakeHttpClient([{ status: 404, headers: {}, bodyText: "not found" }]);
  const deps = makeDeps(httpClient, writeDeps);

  const result = await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "GET", url: "https://api.basic.example/v4/domains" });

  assert.equal("authDiagnostic" in result, false);
});

test("makeCredentialedRequest: the Bearer+no-username hint carries remedyToolId pointing at the tool that can fix it (facet 4 of the general contract)", async () => {
  const writeDeps = await seedWithoutUsername();
  const httpClient = new FakeHttpClient([{ status: 401, headers: {}, bodyText: "unauthorized" }]);
  const deps = makeDeps(httpClient, writeDeps);

  const result = await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "GET", url: "https://api.basic.example/v4/domains" });

  assert.equal(result.authDiagnostic!.remedyToolId, "set-account-username");
});

test("makeCredentialedRequest: a stored-username 401 carries no remedyToolId — it travels only alongside hint, never alone", async () => {
  const writeDeps = await seedWithUsername();
  const httpClient = new FakeHttpClient([{ status: 401, headers: {}, bodyText: "unauthorized" }]);
  const deps = makeDeps(httpClient, writeDeps);

  const result = await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "GET", url: "https://api.basic.example/v4/domains" });

  assert.equal(result.authDiagnostic!.hint, undefined);
  assert.equal(result.authDiagnostic!.remedyToolId, undefined);
});

test("host diagnostic issuance preserves object identity through the service result", async () => {
  const writeDeps = await seedWithoutUsername();
  const httpClient = new FakeHttpClient([{ status: 401, headers: {}, bodyText: "unauthorized" }]);
  const deps = makeDeps(httpClient, writeDeps);
  const issued = new WeakSet<object>();
  const result = await request({ deps, input: { workspaceId: WORKSPACE, label: "basic.example", method: "GET", url: "https://api.basic.example/v4/domains" } }, {
    diagnosticMapper: ({ diagnostic }) => {
      const mapped = { ...diagnostic, remedyToolId: "host.set-username" };
      issued.add(mapped);
      return mapped;
    },
  });
  assert.ok(result.authDiagnostic);
  assert.equal(issued.has(result.authDiagnostic), true);
  assert.equal(result.authDiagnostic.remedyToolId, "host.set-username");
});

test("makeCredentialedRequest: the authDiagnostic never carries the token, in any field, serialized", async () => {
  const writeDeps = await seedWithoutUsername();
  const httpClient = new FakeHttpClient([{ status: 401, headers: {}, bodyText: "unauthorized" }]);
  const deps = makeDeps(httpClient, writeDeps);

  const result = await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "GET", url: "https://api.basic.example/v4/domains" });

  const serialized = JSON.stringify(result.authDiagnostic);
  assert.ok(!serialized.includes("basic-secret-token"));
  assert.ok(!/authorization/i.test(serialized), "the diagnostic must never carry the Authorization header value");
});

test("verifyCustomCredential: an 'invalid' (401) result with no stored username carries the same honest hint", async () => {
  const writeDeps = await seedWithoutUsername();
  const httpClient = new FakeHttpClient([{ status: 401, headers: {}, bodyText: "unauthorized" }]);
  const deps = makeDeps(httpClient, writeDeps);

  const result = await verifyCustomCredential(deps, { workspaceId: WORKSPACE, label: "basic.example" });

  assert.equal(result.status, "invalid");
  assert.ok(result.authDiagnostic);
  assert.equal(result.authDiagnostic!.schemeSent, "Bearer");
  assert.equal(result.authDiagnostic!.usernameStored, false);
  assert.ok(result.authDiagnostic!.hint);
  assert.equal(result.authDiagnostic!.remedyToolId, "set-account-username");
});

test("verifyCustomCredential: an 'invalid' (401) result WITH a stored username carries no hint", async () => {
  const writeDeps = await seedWithUsername();
  const httpClient = new FakeHttpClient([{ status: 401, headers: {}, bodyText: "unauthorized" }]);
  const deps = makeDeps(httpClient, writeDeps);

  const result = await verifyCustomCredential(deps, { workspaceId: WORKSPACE, label: "basic.example" });

  assert.equal(result.authDiagnostic?.usernameStored, true);
  assert.equal(result.authDiagnostic?.hint, undefined);
  assert.equal(result.authDiagnostic?.remedyToolId, undefined);
});

test("verifyCustomCredential: an 'invalid' (403) result with no stored username carries the structured facts but NO hint — the same GitHub-incident fix as makeCredentialedRequest's own 403 case", async () => {
  const writeDeps = await seedWithoutUsername();
  const httpClient = new FakeHttpClient([{ status: 403, headers: {}, bodyText: "forbidden" }]);
  const deps = makeDeps(httpClient, writeDeps);

  const result = await verifyCustomCredential(deps, { workspaceId: WORKSPACE, label: "basic.example" });

  assert.equal(result.status, "invalid");
  assert.ok(result.authDiagnostic, "the structured facts must still be present on a 403");
  assert.equal(result.authDiagnostic!.schemeSent, "Bearer");
  assert.equal(result.authDiagnostic!.usernameStored, false);
  assert.equal(result.authDiagnostic!.hint, undefined, "403 must never suggest the Basic-auth hypothesis");
  assert.equal(result.authDiagnostic!.remedyToolId, undefined);
});

test("verifyCustomCredential: a 'valid' (200) result carries no authDiagnostic at all", async () => {
  const writeDeps = await seedWithoutUsername();
  const httpClient = new FakeHttpClient([{ status: 200, headers: {}, bodyText: "" }]);
  const deps = makeDeps(httpClient, writeDeps);

  const result = await verifyCustomCredential(deps, { workspaceId: WORKSPACE, label: "basic.example" });

  assert.equal(result.status, "valid");
  assert.equal("authDiagnostic" in result, false);
});

test("verifyCustomCredential: an 'unreachable' (500) result carries no authDiagnostic — only an affirmative 401/403 rejection does", async () => {
  const writeDeps = await seedWithoutUsername();
  const httpClient = new FakeHttpClient([{ status: 500, headers: {}, bodyText: "" }]);
  const deps = makeDeps(httpClient, writeDeps);

  const result = await verifyCustomCredential(deps, { workspaceId: WORKSPACE, label: "basic.example" });

  assert.equal(result.status, "unreachable");
  assert.equal("authDiagnostic" in result, false);
});
