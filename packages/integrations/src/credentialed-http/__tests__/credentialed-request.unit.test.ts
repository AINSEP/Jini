import assert from "node:assert/strict";
import { test } from "vitest";

import {
  ConsoleCredentialedRequestAuditLog,
  CredentialNotFoundError as CustomCredentialNotFoundError,
  CredentialedRequestTransportError,
  CredentialedRequestValidationError,
  InMemoryCredentialedRequestAuditLog,
  makeCredentialedRequest as request,
  resolveRequestTarget as target,
  verifyCustomCredential as verify,
  type CredentialedRequestDeps,
} from "../credentialed-request.js";
import type { HttpClientPort, HttpRequest, HttpResponse } from "@jini-ai/core/primitives";

import { EgressRefusedError, createCustomCredential, makeWriteDeps, loadBundledAuthSchemes, type CustomCredentialWriteDeps } from "./resolver-fixtures.js";

const WORKSPACE = "ws-1";
const FIXED_NOW = "2026-08-31T00:00:00.000Z";

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

function makeDeps(overrides: Partial<CredentialedRequestDeps> & { httpClient: HttpClientPort }, base: CustomCredentialWriteDeps): CredentialedRequestDeps {
  return { resolver: base.repo, clock: base.clock, schemeRegistry: { load: loadBundledAuthSchemes }, audit: new InMemoryCredentialedRequestAuditLog(), ...overrides };
}
function makeCredentialedRequest(deps: CredentialedRequestDeps, input: Parameters<typeof request>[0]["input"] & { headers?: unknown; body?: unknown }) {
  const { headers, body, ...requiredInput } = input;
  return request({ deps, input: requiredInput }, { headers, body, errorPolicy: { isEgressRefusal: ({ error }) => error instanceof EgressRefusedError, describeEgressRefusal: ({ error }) => (error as Error).message } });
}
function verifyCustomCredential(deps: CredentialedRequestDeps, input: Parameters<typeof verify>[0]["input"]) { return verify({ deps, input }); }
function resolveRequestTarget(deps: { repo: CustomCredentialWriteDeps["repo"] }, input: Parameters<typeof target>[0]["input"]) { return target({ resolver: deps.repo, input }); }

async function seedBasicAndBearer(): Promise<CustomCredentialWriteDeps> {
  const writeDeps = makeWriteDeps();
  await createCustomCredential(writeDeps, {
    workspaceId: WORKSPACE,
    label: "basic.example",
    category: "hosting",
    baseUrl: "https://api.basic.example",
    connection: { token: "basic-secret-token", username: "basic-user" },
  });
  await createCustomCredential(writeDeps, {
    workspaceId: WORKSPACE,
    label: "token.example",
    category: "ops",
    baseUrl: "https://api.token.example",
    connection: { token: "bearer-secret-token" },
  });
  return writeDeps;
}

async function seedMultiHostAndBasic(): Promise<CustomCredentialWriteDeps> {
  const writeDeps = makeWriteDeps();
  await createCustomCredential(writeDeps, {
    workspaceId: WORKSPACE,
    label: "token.example",
    category: "ops",
    baseUrl: "https://api.token.example",
    additionalHosts: ["https://second.example"],
    connection: { token: "bearer-secret-token" },
  });
  await createCustomCredential(writeDeps, {
    workspaceId: WORKSPACE,
    label: "basic.example",
    category: "hosting",
    baseUrl: "https://api.basic.example",
    connection: { token: "basic-secret-token", username: "basic-user" },
  });
  return writeDeps;
}

test("makeCredentialedRequest: provider A's token cannot reach provider B's host — a url naming token.example is refused while calling with the basic.example credential, before any request is sent", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient();
  const deps = makeDeps({ httpClient }, writeDeps);

  await assert.rejects(
    () => makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "GET", url: "https://api.token.example/v1/apps" }),
    (err: unknown) => {
      assert.ok(err instanceof CredentialedRequestValidationError);
      assert.equal(
        (err as Error).message,
        "url 'https://api.token.example/v1/apps' resolves to origin 'https://api.token.example', which is not one of this credential's saved hosts (https://api.basic.example)"
      );
      return true;
    }
  );
  assert.equal(httpClient.calls.length, 0, "the guarded client must never be reached once the url is rejected");
});

test("makeCredentialedRequest: a url embedding credentials (user:pass@) is refused", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient();
  const deps = makeDeps({ httpClient }, writeDeps);

  await assert.rejects(
    () => makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "GET", url: "https://sneaky:hunter2@api.basic.example/v4/domains" }),
    (err: unknown) => {
      assert.ok(err instanceof CredentialedRequestValidationError);
      assert.equal(
        (err as Error).message,
        "url must not embed credentials (user:pass@) — the server injects the real Authorization header itself"
      );
      return true;
    }
  );
  assert.equal(httpClient.calls.length, 0);
});

test("makeCredentialedRequest: a non-http(s) url scheme is refused", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient();
  const deps = makeDeps({ httpClient }, writeDeps);

  await assert.rejects(
    () => makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "GET", url: "ftp://api.basic.example/v4/domains" }),
    (err: unknown) => {
      assert.ok(err instanceof CredentialedRequestValidationError);
      assert.equal((err as Error).message, "url must use http or https");
      return true;
    }
  );
  assert.equal(httpClient.calls.length, 0);
});

test("makeCredentialedRequest: a url that is not a valid absolute URL is refused", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient();
  const deps = makeDeps({ httpClient }, writeDeps);

  await assert.rejects(
    () => makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "GET", url: "v4/domains" }),
    (err: unknown) => {
      assert.ok(err instanceof CredentialedRequestValidationError);
      assert.equal((err as Error).message, "url must be a valid absolute URL");
      return true;
    }
  );
  assert.equal(httpClient.calls.length, 0);
});

test("makeCredentialedRequest: an empty url is refused", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient();
  const deps = makeDeps({ httpClient }, writeDeps);

  await assert.rejects(
    () => makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "GET", url: "" }),
    (err: unknown) => {
      assert.ok(err instanceof CredentialedRequestValidationError);
      assert.equal((err as Error).message, "url must be a non-empty string");
      return true;
    }
  );
  assert.equal(httpClient.calls.length, 0);
});

test("makeCredentialedRequest: a legitimate url against basic.example never touches token.example's host, and carries basic.example's own Authorization, not token.example's", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient([{ status: 200, headers: {}, bodyText: '{"domains":[]}' }]);
  const deps = makeDeps({ httpClient }, writeDeps);

  const result = await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "GET", url: "https://api.basic.example/v4/domains" });

  assert.equal(httpClient.calls.length, 1);
  const sent = httpClient.calls[0]!;
  assert.equal(sent.url, "https://api.basic.example/v4/domains");
  assert.ok(!sent.url.includes("token.example"), "the request must never be addressed to token.example's host");
  assert.equal(sent.headers.Authorization, `Basic ${Buffer.from("basic-user:basic-secret-token").toString("base64")}`);
  assert.ok(!sent.headers.Authorization!.includes("bearer-secret-token"));
  assert.equal(result.executed, true);
  assert.equal(result.status, 200);
  assert.equal(result.bodyText, '{"domains":[]}');
});

test("makeCredentialedRequest: token.example's own credential resolves to token.example's own host and token — no cross-contamination in the other direction either", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient([{ status: 200, headers: {}, bodyText: "{}" }]);
  const deps = makeDeps({ httpClient }, writeDeps);

  await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "token.example", method: "GET", url: "https://api.token.example/v1/apps/my-app" });

  const sent = httpClient.calls[0]!;
  assert.equal(sent.url, "https://api.token.example/v1/apps/my-app");
  assert.equal(sent.headers.Authorization, "Bearer bearer-secret-token");
  assert.ok(!sent.headers.Authorization!.includes("basic-secret-token"));
});

test("makeCredentialedRequest: a token starting with the CustomV1 self-describing scheme is sent as `CustomV1 <rest>`, not `Bearer CustomV1<rest>`", async () => {
  const writeDeps = makeWriteDeps();
  await createCustomCredential(writeDeps, {
    workspaceId: WORKSPACE,
    label: "token.example",
    category: "ops",
    baseUrl: "https://api.token.example",
    connection: { token: "CustomV1fake_test_token_value" },
  });
  const httpClient = new FakeHttpClient([{ status: 200, headers: {}, bodyText: "{}" }]);
  const deps = makeDeps({ httpClient }, writeDeps);

  await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "token.example", method: "GET", url: "https://api.token.example/v1/apps/my-app" });

  const sent = httpClient.calls[0]!;
  assert.equal(sent.headers.Authorization, "CustomV1 fake_test_token_value");
  assert.notEqual(sent.headers.Authorization, "Bearer CustomV1fake_test_token_value");
});

test("makeCredentialedRequest: an ordinary opaque token with no recognized scheme prefix is still sent as `Bearer <token>`, unchanged", async () => {
  const writeDeps = makeWriteDeps();
  await createCustomCredential(writeDeps, {
    workspaceId: WORKSPACE,
    label: "generic",
    category: "general",
    baseUrl: "https://api.example.com",
    connection: { token: "opaque_token_with_an_underscore_in_it" },
  });
  const httpClient = new FakeHttpClient([{ status: 200, headers: {}, bodyText: "{}" }]);
  const deps = makeDeps({ httpClient }, writeDeps);

  await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "generic", method: "GET", url: "https://api.example.com/v1/ping" });

  assert.equal(httpClient.calls[0]!.headers.Authorization, "Bearer opaque_token_with_an_underscore_in_it");
});

test("makeCredentialedRequest: a saved username does not affect the Basic-auth path when the token has no recognized scheme prefix", async () => {
  const writeDeps = makeWriteDeps();
  await createCustomCredential(writeDeps, {
    workspaceId: WORKSPACE,
    label: "generic",
    category: "general",
    baseUrl: "https://api.example.com",
    connection: { token: "opaque-secret-token", username: "generic-user" },
  });
  const httpClient = new FakeHttpClient([{ status: 200, headers: {}, bodyText: "{}" }]);
  const deps = makeDeps({ httpClient }, writeDeps);

  await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "generic", method: "GET", url: "https://api.example.com/v1/ping" });

  assert.equal(httpClient.calls[0]!.headers.Authorization, `Basic ${Buffer.from("generic-user:opaque-secret-token").toString("base64")}`);
});

test("makeCredentialedRequest: a self-describing-scheme token takes priority over a saved username — it is sent as CustomV1, never Basic", async () => {
  const writeDeps = makeWriteDeps();
  await createCustomCredential(writeDeps, {
    workspaceId: WORKSPACE,
    label: "token.example",
    category: "ops",
    baseUrl: "https://api.token.example",
    connection: { token: "CustomV1fake_test_token_value", username: "leftover-username" },
  });
  const httpClient = new FakeHttpClient([{ status: 200, headers: {}, bodyText: "{}" }]);
  const deps = makeDeps({ httpClient }, writeDeps);

  await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "token.example", method: "GET", url: "https://api.token.example/v1/apps/my-app" });

  const sent = httpClient.calls[0]!;
  assert.equal(sent.headers.Authorization, "CustomV1 fake_test_token_value");
  assert.ok(!sent.headers.Authorization!.startsWith("Basic "), "a self-describing scheme must never be displaced by a saved username");
});

test("makeCredentialedRequest: a reflecting response still redacts the full self-describing token, in both the header and the body", async () => {
  const writeDeps = makeWriteDeps();
  await createCustomCredential(writeDeps, {
    workspaceId: WORKSPACE,
    label: "token.example",
    category: "ops",
    baseUrl: "https://api.token.example",
    connection: { token: "CustomV1fake_test_token_value" },
  });
  const httpClient = new FakeHttpClient([
    { status: 200, headers: { "X-Reflected-Auth": "CustomV1 fake_test_token_value" }, bodyText: '{"echo":"CustomV1fake_test_token_value"}' },
  ]);
  const deps = makeDeps({ httpClient }, writeDeps);

  const result = await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "token.example", method: "GET", url: "https://api.token.example/v1/apps/my-app" });

  assert.equal(result.headers["X-Reflected-Auth"], undefined);
  assert.ok(!result.bodyText.includes("CustomV1fake_test_token_value"));
  assert.ok(!result.bodyText.includes("fake_test_token_value"));
});

test("makeCredentialedRequest: a self-describing token's BARE value (no scheme prefix) reflected in the response body is redacted", async () => {
  const writeDeps = makeWriteDeps();
  await createCustomCredential(writeDeps, {
    workspaceId: WORKSPACE,
    label: "token.example",
    category: "ops",
    baseUrl: "https://api.token.example",
    connection: { token: "CustomV1fake_test_token_value" },
  });
  const httpClient = new FakeHttpClient([{ status: 400, headers: {}, bodyText: '{"error":"invalid macaroon fake_test_token_value"}' }]);
  const deps = makeDeps({ httpClient }, writeDeps);

  const result = await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "token.example", method: "GET", url: "https://api.token.example/v1/apps/my-app" });

  assert.ok(!result.bodyText.includes("fake_test_token_value"), "the bare self-describing token value must be redacted even with no scheme prefix");
  assert.equal(result.bodyText, '{"error":"invalid macaroon [REDACTED]"}');
});

test("makeCredentialedRequest: a self-describing token's BARE value (no scheme prefix) reflected in a response header is redacted", async () => {
  const writeDeps = makeWriteDeps();
  await createCustomCredential(writeDeps, {
    workspaceId: WORKSPACE,
    label: "token.example",
    category: "ops",
    baseUrl: "https://api.token.example",
    connection: { token: "CustomV1fake_test_token_value" },
  });
  const httpClient = new FakeHttpClient([{ status: 200, headers: { "X-Debug-Echo": "fake_test_token_value" }, bodyText: "{}" }]);
  const deps = makeDeps({ httpClient }, writeDeps);

  const result = await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "token.example", method: "GET", url: "https://api.token.example/v1/apps/my-app" });

  assert.equal(result.headers["X-Debug-Echo"], undefined, "a header carrying the bare self-describing token value must be dropped");
});

test("makeCredentialedRequest: a url on a credential's additionalHosts entry is accepted, with that same credential's own Authorization", async () => {
  const writeDeps = await seedMultiHostAndBasic();
  const httpClient = new FakeHttpClient([{ status: 200, headers: {}, bodyText: '{"machines":[]}' }]);
  const deps = makeDeps({ httpClient }, writeDeps);

  const result = await makeCredentialedRequest(deps, {
    workspaceId: WORKSPACE,
    label: "token.example",
    method: "GET",
    url: "https://second.example/v1/apps/my-app/machines",
  });

  assert.equal(httpClient.calls.length, 1);
  const sent = httpClient.calls[0]!;
  assert.equal(sent.url, "https://second.example/v1/apps/my-app/machines");
  assert.equal(sent.headers.Authorization, "Bearer bearer-secret-token");
  assert.equal(result.status, 200);
  assert.equal(result.bodyText, '{"machines":[]}');
});

test("makeCredentialedRequest: a url on the credential's baseUrl still works unchanged once additionalHosts is set — the primary host is not displaced", async () => {
  const writeDeps = await seedMultiHostAndBasic();
  const httpClient = new FakeHttpClient([{ status: 200, headers: {}, bodyText: "{}" }]);
  const deps = makeDeps({ httpClient }, writeDeps);

  await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "token.example", method: "GET", url: "https://api.token.example/v1/apps/my-app" });

  assert.equal(httpClient.calls[0]!.url, "https://api.token.example/v1/apps/my-app");
});

test("makeCredentialedRequest: a url whose origin is NOT in the saved set (neither baseUrl nor additionalHosts) is refused before any network call, naming every allowed host", async () => {
  const writeDeps = await seedMultiHostAndBasic();
  const httpClient = new FakeHttpClient();
  const deps = makeDeps({ httpClient }, writeDeps);

  await assert.rejects(
    () => makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "token.example", method: "GET", url: "https://evil.example.com/steal" }),
    (err: unknown) => {
      assert.ok(err instanceof CredentialedRequestValidationError);
      assert.equal(
        (err as Error).message,
        "url 'https://evil.example.com/steal' resolves to origin 'https://evil.example.com', which is not one of this credential's saved hosts (https://api.token.example, https://second.example)"
      );
      return true;
    }
  );
  assert.equal(httpClient.calls.length, 0);
});

test("makeCredentialedRequest: provider A's credential still cannot reach provider B's host, even when provider A has additionalHosts of its own", async () => {
  const writeDeps = await seedMultiHostAndBasic();
  const httpClient = new FakeHttpClient();
  const deps = makeDeps({ httpClient }, writeDeps);
  await assert.rejects(
    () => makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "token.example", method: "GET", url: "https://api.basic.example/v4/domains" }),
    (err: unknown) => {
      assert.ok(err instanceof CredentialedRequestValidationError);
      assert.match((err as Error).message, /not one of this credential's saved hosts \(https:\/\/api\.token\.example, https:\/\/second\.example\)/);
      return true;
    }
  );
  await assert.rejects(
    () => makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "GET", url: "https://second.example/v1/apps" }),
    (err: unknown) => {
      assert.ok(err instanceof CredentialedRequestValidationError);
      assert.match((err as Error).message, /not one of this credential's saved hosts \(https:\/\/api\.basic\.example\)/);
      return true;
    }
  );

  assert.equal(httpClient.calls.length, 0, "neither cross-credential attempt may ever reach the guarded client");
});

test("makeCredentialedRequest: a caller-supplied Authorization header is refused, case-insensitively", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient();
  const deps = makeDeps({ httpClient }, writeDeps);

  await assert.rejects(
    () =>
      makeCredentialedRequest(deps, {
        workspaceId: WORKSPACE,
        label: "basic.example",
        method: "GET",
        url: "https://api.basic.example/v4/domains",
        headers: { AUTHORIZATION: "Bearer hacked" },
      }),
    (err: unknown) => {
      assert.ok(err instanceof CredentialedRequestValidationError);
      assert.equal((err as Error).message, "header 'AUTHORIZATION' may not be set by the caller — the server injects the real credential's own Authorization header itself");
      return true;
    }
  );
  assert.equal(httpClient.calls.length, 0);
});

test("makeCredentialedRequest: a caller-supplied Cookie/Host/Proxy-Authorization header is refused", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient();
  const deps = makeDeps({ httpClient }, writeDeps);

  for (const forbidden of ["Cookie", "Host", "Proxy-Authorization"]) {
    await assert.rejects(
      () =>
        makeCredentialedRequest(deps, {
          workspaceId: WORKSPACE,
          label: "basic.example",
          method: "GET",
          url: "https://api.basic.example/v4/domains",
          headers: { [forbidden]: "x" },
        }),
      (err: unknown) => {
        assert.ok(err instanceof CredentialedRequestValidationError);
        assert.equal((err as Error).message, `header '${forbidden}' may not be set by the caller — the server injects the real credential's own Authorization header itself`);
        return true;
      }
    );
  }
  assert.equal(httpClient.calls.length, 0);
});

test("makeCredentialedRequest: a forbidden header name with leading/trailing whitespace is still refused", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient();
  const deps = makeDeps({ httpClient }, writeDeps);

  for (const paddedForbidden of ["authorization ", " host", "\tcookie", "Proxy-Authorization "]) {
    await assert.rejects(
      () =>
        makeCredentialedRequest(deps, {
          workspaceId: WORKSPACE,
          label: "basic.example",
          method: "GET",
          url: "https://api.basic.example/v4/domains",
          headers: { [paddedForbidden]: "x" },
        }),
      (err: unknown) => {
        assert.ok(err instanceof CredentialedRequestValidationError);
        assert.equal((err as Error).message, `header '${paddedForbidden}' may not be set by the caller — the server injects the real credential's own Authorization header itself`);
        return true;
      }
    );
  }
  assert.equal(httpClient.calls.length, 0);
});

test("makeCredentialedRequest: an unsupported method value is refused with the exact reason", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient();
  const deps = makeDeps({ httpClient }, writeDeps);

  await assert.rejects(
    () => makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "TRACE", url: "https://api.basic.example/v4/domains" }),
    (err: unknown) => {
      assert.ok(err instanceof CredentialedRequestValidationError);
      assert.equal((err as Error).message, "method must be one of GET, POST, PUT, PATCH, DELETE");
      return true;
    }
  );
  assert.equal(httpClient.calls.length, 0);
});

test("makeCredentialedRequest: POST/PUT/PATCH each send the given body exactly to the guarded client, and the audit records only its byte size, never the body itself", async () => {
  for (const method of ["POST", "PUT", "PATCH"] as const) {
    const writeDeps = await seedBasicAndBearer();
    const httpClient = new FakeHttpClient([{ status: 201, headers: {}, bodyText: '{"ok":true}' }]);
    const audit = new InMemoryCredentialedRequestAuditLog();
    const deps = makeDeps({ httpClient, audit }, writeDeps);
    const body = JSON.stringify({ domain: "example.com" });

    const result = await makeCredentialedRequest(deps, {
      workspaceId: WORKSPACE,
      label: "basic.example",
      method,
      url: "https://api.basic.example/v4/domains",
      body,
      headers: { "Content-Type": "application/json" },
    });

    assert.equal(httpClient.calls.length, 1, `${method}: exactly one request must be sent`);
    const sent = httpClient.calls[0]!;
    assert.equal(sent.method, method);
    assert.equal(sent.body, body, `${method}: the body must reach the guarded client unchanged`);
    assert.equal(sent.headers["Content-Type"], "application/json");
    assert.equal(result.status, 201);

    assert.equal(audit.entries.length, 1);
    assert.equal(audit.entries[0]!.bodyBytes, Buffer.byteLength(body, "utf8"), `${method}: bodyBytes must be the real byte size`);
    assert.deepEqual(Object.keys(audit.entries[0]!).sort(), ["at", "bodyBytes", "host", "label", "method", "status"]);
    assert.ok(!JSON.stringify(audit.entries).includes("basic-secret-token"));
  }
});

test("makeCredentialedRequest: a caller-supplied User-Agent header is NOT forbidden — it reaches the guarded client unchanged (2026-09-03 decision: parity with what a human can already do via curl -A, no bearing on the host-binding security boundary)", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient([{ status: 200, headers: {}, bodyText: "{}" }]);
  const deps = makeDeps({ httpClient }, writeDeps);

  const result = await makeCredentialedRequest(deps, {
    workspaceId: WORKSPACE,
    label: "basic.example",
    method: "GET",
    url: "https://api.basic.example/v4/domains",
    headers: { "User-Agent": "MyOwnAgent/3.1" },
  });

  assert.equal(result.status, 200);
  assert.equal(httpClient.calls.length, 1);
  assert.equal(httpClient.calls[0]!.headers["User-Agent"], "MyOwnAgent/3.1");
});

test("makeCredentialedRequest: DELETE itself runs immediately with no confirmation — this module has no gating logic; that lives one layer up", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient([{ status: 204, headers: {}, bodyText: "" }]);
  const deps = makeDeps({ httpClient }, writeDeps);

  const result = await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "DELETE", url: "https://api.basic.example/v4/domains/example.com" });

  assert.equal(httpClient.calls.length, 1);
  assert.equal(httpClient.calls[0]!.method, "DELETE");
  assert.equal(result.executed, true);
  assert.equal(result.status, 204);
});

test("makeCredentialedRequest: an omitted body degrades to no body sent and bodyBytes:0 audited", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient([{ status: 200, headers: {}, bodyText: "[]" }]);
  const audit = new InMemoryCredentialedRequestAuditLog();
  const deps = makeDeps({ httpClient, audit }, writeDeps);

  await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "GET", url: "https://api.basic.example/v4/domains" });

  assert.equal("body" in httpClient.calls[0]!, false, "no body key should be sent to the guarded client at all");
  assert.equal(audit.entries[0]!.bodyBytes, 0);
});

test("makeCredentialedRequest: a request body over the 1MB cap is refused before any network call", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient();
  const deps = makeDeps({ httpClient }, writeDeps);
  const oversized = "a".repeat(1_000_001);

  await assert.rejects(
    () => makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "POST", url: "https://api.basic.example/v4/domains", body: oversized }),
    (err: unknown) => {
      assert.ok(err instanceof CredentialedRequestValidationError);
      assert.equal((err as Error).message, "body is 1000001 bytes, which exceeds the 1000000-byte limit for this tool");
      return true;
    }
  );
  assert.equal(httpClient.calls.length, 0);
});

test("makeCredentialedRequest: a request body at exactly the 1MB cap is accepted (the cap rejects only what EXCEEDS it)", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient([{ status: 200, headers: {}, bodyText: "ok" }]);
  const audit = new InMemoryCredentialedRequestAuditLog();
  const deps = makeDeps({ httpClient, audit }, writeDeps);
  const exactly1Mb = "a".repeat(1_000_000);

  await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "POST", url: "https://api.basic.example/v4/domains", body: exactly1Mb });

  assert.equal(httpClient.calls.length, 1);
  assert.equal(httpClient.calls[0]!.body!.length, 1_000_000);
  assert.equal(audit.entries[0]!.bodyBytes, 1_000_000);
});

test("makeCredentialedRequest: a non-string body is refused", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient();
  const deps = makeDeps({ httpClient }, writeDeps);

  await assert.rejects(
    () => makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "POST", url: "https://api.basic.example/v4/domains", body: { not: "a string" } }),
    (err: unknown) => {
      assert.ok(err instanceof CredentialedRequestValidationError);
      assert.equal((err as Error).message, "body must be a string when provided");
      return true;
    }
  );
  assert.equal(httpClient.calls.length, 0);
});

test("makeCredentialedRequest: an unknown label throws CustomCredentialNotFoundError, and method/header/body shape validation runs before the credential lookup", async () => {
  const writeDeps = makeWriteDeps(); // no credentials seeded at all
  const httpClient = new FakeHttpClient();
  const deps = makeDeps({ httpClient }, writeDeps);
  await assert.rejects(
    () => makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "does-not-exist", method: "TRACE", url: "https://example.com/x" }),
    CredentialedRequestValidationError
  );
  await assert.rejects(
    () => makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "does-not-exist", method: "GET", url: "https://example.com/x", headers: { Cookie: "x" } }),
    CredentialedRequestValidationError
  );

  await assert.rejects(
    () => makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "does-not-exist", method: "GET", url: "https://example.com/x" }),
    (err: unknown) => {
      assert.ok(err instanceof CustomCredentialNotFoundError);
      assert.equal((err as Error).message, "no custom credential labeled 'does-not-exist' in this workspace");
      return true;
    }
  );
  assert.equal(httpClient.calls.length, 0);
});

test("makeCredentialedRequest: for an unknown label, an off-allowlist/malformed url does NOT surface as a url validation error — the credential lookup runs first and reports not-found (url is checked only once a credential is actually found)", async () => {
  const writeDeps = makeWriteDeps();
  const httpClient = new FakeHttpClient();
  const deps = makeDeps({ httpClient }, writeDeps);

  await assert.rejects(
    () => makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "does-not-exist", method: "GET", url: "not-a-valid-url" }),
    (err: unknown) => {
      assert.ok(err instanceof CustomCredentialNotFoundError, `expected CustomCredentialNotFoundError, got ${(err as Error).constructor.name}`);
      return true;
    }
  );
  assert.equal(httpClient.calls.length, 0);
});

test("makeCredentialedRequest: audits exactly {label, host, method, status, bodyBytes, at} and never the token", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient([{ status: 200, headers: {}, bodyText: "ok" }]);
  const audit = new InMemoryCredentialedRequestAuditLog();
  const deps = makeDeps({ httpClient, audit }, writeDeps);

  await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "GET", url: "https://api.basic.example/v4/domains" });

  assert.equal(audit.entries.length, 1);
  assert.deepEqual(audit.entries[0]!, { label: "basic.example", host: "api.basic.example", method: "GET", status: 200, bodyBytes: 0, at: FIXED_NOW });
  const serialized = JSON.stringify(audit.entries);
  assert.ok(!serialized.includes("basic-secret-token"), "the audit trail must never carry the token");
});

test("makeCredentialedRequest: a transport failure throws CredentialedRequestTransportError, audits status:0, and the error message never carries the token", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient([new Error("getaddrinfo ENOTFOUND api.basic.example")]);
  const audit = new InMemoryCredentialedRequestAuditLog();
  const deps = makeDeps({ httpClient, audit }, writeDeps);

  await assert.rejects(
    () => makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "GET", url: "https://api.basic.example/v4/domains" }),
    (err: unknown) => {
      assert.ok(err instanceof CredentialedRequestTransportError);
      assert.equal((err as Error).message, "request to 'basic.example' failed: getaddrinfo ENOTFOUND api.basic.example");
      assert.ok(!(err as Error).message.includes("basic-secret-token"));
      return true;
    }
  );
  assert.equal(audit.entries.length, 1);
  assert.equal(audit.entries[0]!.status, 0);
  assert.equal(audit.entries[0]!.bodyBytes, 0);
});
test("makeCredentialedRequest: an EgressRefusedError from the http client passes through with its own type, not wrapped into CredentialedRequestTransportError", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient([new EgressRefusedError("egress to 'api.basic.example' (169.254.169.254) rejected: resolved address is link-local")]);
  const audit = new InMemoryCredentialedRequestAuditLog();
  const deps = makeDeps({ httpClient, audit }, writeDeps);

  await assert.rejects(
    () => makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "GET", url: "https://api.basic.example/v4/domains" }),
    (err: unknown) => {
      assert.ok(err instanceof EgressRefusedError, `expected EgressRefusedError, got ${(err as Error).constructor.name}`);
      assert.ok(!(err instanceof CredentialedRequestTransportError), "must not also be re-wrapped");
      assert.match((err as Error).message, /link-local/);
      return true;
    }
  );
  assert.equal(audit.entries.length, 1);
  assert.equal(audit.entries[0]!.status, 0);
});

test("ConsoleCredentialedRequestAuditLog: an egress refusal's full detail, resolved address included, is kept in the server-side line", () => {
  const lines: string[] = [];
  new ConsoleCredentialedRequestAuditLog({ log: ({ line }) => lines.push(line), prefix: "[credentialed-http]" }).record({ entry: {
    label: "internal",
    host: "internal-db.corp",
    method: "GET",
    status: 0,
    bodyBytes: 0,
    at: "2026-09-16T00:00:00.000Z",
    egressRefusal: "egress to 'internal-db.corp' (10.0.4.7) rejected: resolved address is private",
  } });

  assert.deepEqual(lines, [
    "[credentialed-http] request label=internal host=internal-db.corp method=GET status=0 bodyBytes=0 at=2026-09-16T00:00:00.000Z " +
      "egressRefusal=\"egress to 'internal-db.corp' (10.0.4.7) rejected: resolved address is private\"",
  ]);
});

test("makeCredentialedRequest: ConsoleCredentialedRequestAuditLog logs a structured line (including bodyBytes) and never the token", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient([{ status: 200, headers: {}, bodyText: "ok" }]);
  const lines: string[] = [];
  const deps = makeDeps({ httpClient, audit: new ConsoleCredentialedRequestAuditLog({ log: ({ line }) => lines.push(line), prefix: "[credentialed-http]" }) }, writeDeps);

  await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "POST", url: "https://api.basic.example/v4/domains", body: "hello" });

  assert.equal(lines.length, 1);
  assert.equal(lines[0]!, "[credentialed-http] request label=basic.example host=api.basic.example method=POST status=200 bodyBytes=5 at=2026-08-31T00:00:00.000Z");
  assert.ok(!lines[0]!.includes("basic-secret-token"));
});

test("resolveRequestTarget: resolves label + url without needing (or being able to use) a sealer", async () => {
  const writeDeps = await seedBasicAndBearer();

  const target = await resolveRequestTarget({ repo: writeDeps.repo }, { workspaceId: WORKSPACE, label: "basic.example", url: "https://api.basic.example/v4/domains" });

  assert.equal(target.label, "basic.example");
  assert.equal(target.url.toString(), "https://api.basic.example/v4/domains");
});

test("resolveRequestTarget: accepts a url on additionalHosts, exactly like makeCredentialedRequest does", async () => {
  const writeDeps = await seedMultiHostAndBasic();

  const target = await resolveRequestTarget({ repo: writeDeps.repo }, { workspaceId: WORKSPACE, label: "token.example", url: "https://second.example/v1/apps" });

  assert.equal(target.url.origin, "https://second.example");
});

test("resolveRequestTarget: an unknown label throws CustomCredentialNotFoundError", async () => {
  const writeDeps = makeWriteDeps();

  await assert.rejects(
    () => resolveRequestTarget({ repo: writeDeps.repo }, { workspaceId: WORKSPACE, label: "does-not-exist", url: "https://example.com/x" }),
    (err: unknown) => {
      assert.ok(err instanceof CustomCredentialNotFoundError);
      assert.equal((err as Error).message, "no custom credential labeled 'does-not-exist' in this workspace");
      return true;
    }
  );
});

test("resolveRequestTarget: an off-allowlist url throws CredentialedRequestValidationError with the exact same message makeCredentialedRequest would give", async () => {
  const writeDeps = await seedBasicAndBearer();

  await assert.rejects(
    () => resolveRequestTarget({ repo: writeDeps.repo }, { workspaceId: WORKSPACE, label: "basic.example", url: "https://api.token.example/v1/apps" }),
    (err: unknown) => {
      assert.ok(err instanceof CredentialedRequestValidationError);
      assert.equal(
        (err as Error).message,
        "url 'https://api.token.example/v1/apps' resolves to origin 'https://api.token.example', which is not one of this credential's saved hosts (https://api.basic.example)"
      );
      return true;
    }
  );
});

test("verifyCustomCredential: a 2xx response classifies as 'valid'", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient([{ status: 200, headers: {}, bodyText: "secret account details" }]);
  const deps = makeDeps({ httpClient }, writeDeps);

  const result = await verifyCustomCredential(deps, { workspaceId: WORKSPACE, label: "basic.example" });

  assert.deepEqual(result, { status: "valid", message: "'basic.example' accepted this credential.", checkedAt: FIXED_NOW });
  assert.deepEqual(Object.keys(result).sort(), ["checkedAt", "message", "status"]);
  assert.equal(httpClient.calls[0]!.url, "https://api.basic.example/");
});

test("verifyCustomCredential: a 401 response classifies as 'invalid'", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient([{ status: 401, headers: {}, bodyText: "unauthorized" }]);
  const deps = makeDeps({ httpClient }, writeDeps);

  const result = await verifyCustomCredential(deps, { workspaceId: WORKSPACE, label: "basic.example" });

  assert.equal(result.status, "invalid");
  assert.equal(result.message, "'basic.example' rejected this credential (HTTP 401) — it is invalid, expired, or missing required permissions.");
});

test("verifyCustomCredential: a 403 response also classifies as 'invalid'", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient([{ status: 403, headers: {}, bodyText: "" }]);
  const deps = makeDeps({ httpClient }, writeDeps);

  const result = await verifyCustomCredential(deps, { workspaceId: WORKSPACE, label: "basic.example" });
  assert.equal(result.status, "invalid");
});

test("verifyCustomCredential: a 500 response classifies as 'unreachable', not 'invalid'", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient([{ status: 500, headers: {}, bodyText: "" }]);
  const deps = makeDeps({ httpClient }, writeDeps);

  const result = await verifyCustomCredential(deps, { workspaceId: WORKSPACE, label: "basic.example" });
  assert.equal(result.status, "unreachable");
});

test("verifyCustomCredential: a network failure classifies as 'unreachable' and never throws", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient([new Error("connect ETIMEDOUT")]);
  const deps = makeDeps({ httpClient }, writeDeps);

  const result = await verifyCustomCredential(deps, { workspaceId: WORKSPACE, label: "basic.example" });
  assert.equal(result.status, "unreachable");
  assert.equal(result.message, "Could not reach 'basic.example' to verify this credential — this does not necessarily mean the credential is bad.");
});

test("verifyCustomCredential: audits with bodyBytes:0 (a verify never sends a body) and never the token", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient([{ status: 200, headers: {}, bodyText: "ok" }]);
  const audit = new InMemoryCredentialedRequestAuditLog();
  const deps = makeDeps({ httpClient, audit }, writeDeps);

  await verifyCustomCredential(deps, { workspaceId: WORKSPACE, label: "basic.example" });

  assert.equal(audit.entries.length, 1);
  assert.deepEqual(audit.entries[0]!, { label: "basic.example", host: "api.basic.example", method: "GET", status: 200, bodyBytes: 0, at: FIXED_NOW });
});

test("verifyCustomCredential: an unknown label throws CustomCredentialNotFoundError", async () => {
  const writeDeps = makeWriteDeps();
  const httpClient = new FakeHttpClient();
  const deps = makeDeps({ httpClient }, writeDeps);

  await assert.rejects(
    () => verifyCustomCredential(deps, { workspaceId: WORKSPACE, label: "does-not-exist" }),
    (err: unknown) => {
      assert.ok(err instanceof CustomCredentialNotFoundError);
      assert.equal((err as Error).message, "no custom credential labeled 'does-not-exist' in this workspace");
      return true;
    }
  );
});

test("makeCredentialedRequest: strips sensitive response headers (Authorization, Set-Cookie, Cookie) before returning to the caller", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient([
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer basic-secret-token",
        "Set-Cookie": "session_id=secret_cookie_123; Secure; HttpOnly",
        cookie: "tracking=abc",
        "X-Request-Id": "req-1",
      },
      bodyText: '{"ok":true}',
    },
  ]);
  const deps = makeDeps({ httpClient }, writeDeps);

  const result = await makeCredentialedRequest(deps, {
    workspaceId: WORKSPACE,
    label: "basic.example",
    method: "GET",
    url: "https://api.basic.example/v4/domains",
  });

  assert.equal(result.headers["Content-Type"], "application/json");
  assert.equal(result.headers["X-Request-Id"], "req-1");
  assert.equal(result.headers.Authorization, undefined);
  assert.equal(result.headers.authorization, undefined);
  assert.equal(result.headers["Set-Cookie"], undefined);
  assert.equal(result.headers["set-cookie"], undefined);
  assert.equal(result.headers.cookie, undefined);
  assert.ok(!JSON.stringify(result.headers).includes("basic-secret-token"));
  assert.ok(!JSON.stringify(result.headers).includes("secret_cookie_123"));
});

test("makeCredentialedRequest: strips response headers that reflect the credential's token or injected Authorization value", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient([
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Echoed-Token": "bearer-secret-token",
        "X-Reflected-Auth": "Bearer bearer-secret-token",
        "X-Safe-Header": "safe-value",
      },
      bodyText: "ok",
    },
  ]);
  const deps = makeDeps({ httpClient }, writeDeps);

  const result = await makeCredentialedRequest(deps, {
    workspaceId: WORKSPACE,
    label: "token.example",
    method: "GET",
    url: "https://api.token.example/v1/apps",
  });

  assert.equal(result.headers["Content-Type"], "application/json");
  assert.equal(result.headers["X-Safe-Header"], "safe-value");
  assert.equal(result.headers["X-Echoed-Token"], undefined);
  assert.equal(result.headers["X-Reflected-Auth"], undefined);
  assert.ok(!JSON.stringify(result.headers).includes("bearer-secret-token"));
});

test("makeCredentialedRequest: strips response headers reflecting basic-auth credentials or tokens for username-authenticated credentials", async () => {
  const writeDeps = await seedBasicAndBearer();
  const basicAuthPayload = Buffer.from("basic-user:basic-secret-token").toString("base64");
  const httpClient = new FakeHttpClient([
    {
      status: 200,
      headers: {
        "X-Echoed-Basic": `Basic ${basicAuthPayload}`,
        "X-Echoed-Secret": "basic-secret-token",
        "X-Safe-Header": "safe",
      },
      bodyText: "ok",
    },
  ]);
  const deps = makeDeps({ httpClient }, writeDeps);

  const result = await makeCredentialedRequest(deps, {
    workspaceId: WORKSPACE,
    label: "basic.example",
    method: "GET",
    url: "https://api.basic.example/v4/domains",
  });

  assert.equal(result.headers["X-Safe-Header"], "safe");
  assert.equal(result.headers["X-Echoed-Basic"], undefined);
  assert.equal(result.headers["X-Echoed-Secret"], undefined);
  assert.ok(!JSON.stringify(result.headers).includes("basic-secret-token"));
  assert.ok(!JSON.stringify(result.headers).includes(basicAuthPayload));
});

test("makeCredentialedRequest: strips a response header that echoes ONLY the bare base64 Basic-auth payload, with no 'Basic ' scheme prefix at all", async () => {
  const writeDeps = await seedBasicAndBearer();
  const basicAuthPayload = Buffer.from("basic-user:basic-secret-token").toString("base64");
  const httpClient = new FakeHttpClient([
    {
      status: 200,
      headers: {
        "X-Echoed-Payload-Only": basicAuthPayload,
        "X-Safe-Header": "safe",
      },
      bodyText: "ok",
    },
  ]);
  const deps = makeDeps({ httpClient }, writeDeps);

  const result = await makeCredentialedRequest(deps, {
    workspaceId: WORKSPACE,
    label: "basic.example",
    method: "GET",
    url: "https://api.basic.example/v4/domains",
  });

  assert.equal(result.headers["X-Safe-Header"], "safe");
  assert.equal(result.headers["X-Echoed-Payload-Only"], undefined);
  assert.ok(!JSON.stringify(result.headers).includes(basicAuthPayload));
});

test("makeCredentialedRequest: a response header is redacted when it merely EMBEDS a secret inside a larger value — substring match, not exact equality", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient([
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Echo": "request-id=r1; sent-auth=Bearer bearer-secret-token; region=us-east",
      },
      bodyText: "ok",
    },
  ]);
  const deps = makeDeps({ httpClient }, writeDeps);

  const result = await makeCredentialedRequest(deps, {
    workspaceId: WORKSPACE,
    label: "token.example",
    method: "GET",
    url: "https://api.token.example/v1/apps",
  });

  assert.equal(result.headers["Content-Type"], "application/json");
  assert.equal(result.headers["X-Debug-Echo"], undefined);
});

test("makeCredentialedRequest: strips the injected token from the response BODY too, while leaving the rest of the body intact", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient([
    {
      status: 200,
      headers: {},
      bodyText: '{"echo":{"authorization":"Bearer bearer-secret-token"},"machines":["m-1","m-2"]}',
    },
  ]);
  const deps = makeDeps({ httpClient }, writeDeps);

  const result = await makeCredentialedRequest(deps, {
    workspaceId: WORKSPACE,
    label: "token.example",
    method: "GET",
    url: "https://api.token.example/v1/apps",
  });

  assert.ok(!result.bodyText.includes("bearer-secret-token"));
  assert.equal(result.bodyText, '{"echo":{"authorization":"[REDACTED]"},"machines":["m-1","m-2"]}');
});

test("makeCredentialedRequest: a TRUNCATED response body whose tail is only a partial-length prefix of the secret is scrubbed too, not just full occurrences", async () => {
  const writeDeps = await seedBasicAndBearer();
  const tokenTailPrefix = "bearer-secret-token".slice(0, 12); // "flyio-secret" — >= the 4-char floor
  const bodyText = `{"echo":"leaked-fragment-${tokenTailPrefix}`;
  const httpClient = new FakeHttpClient([{ status: 200, headers: {}, bodyText, bodyTruncated: true }]);
  const deps = makeDeps({ httpClient }, writeDeps);

  const result = await makeCredentialedRequest(deps, {
    workspaceId: WORKSPACE,
    label: "token.example",
    method: "GET",
    url: "https://api.token.example/v1/apps",
  });

  assert.ok(!result.bodyText.includes(tokenTailPrefix), "a partial-token tail must not survive truncation either");
  assert.ok(result.bodyText.endsWith("[REDACTED]"), `expected the tail to end with the redaction marker, got: ${result.bodyText}`);
});

test("makeCredentialedRequest: a NON-truncated body with the identical partial-token-shaped tail is left byte-for-byte unchanged — the tail check only fires when bodyTruncated is true", async () => {
  const writeDeps = await seedBasicAndBearer();
  const tokenTailPrefix = "bearer-secret-token".slice(0, 12);
  const bodyText = `{"echo":"leaked-fragment-${tokenTailPrefix}`;
  const httpClient = new FakeHttpClient([{ status: 200, headers: {}, bodyText }]); // bodyTruncated omitted: a complete response.
  const deps = makeDeps({ httpClient }, writeDeps);

  const result = await makeCredentialedRequest(deps, {
    workspaceId: WORKSPACE,
    label: "token.example",
    method: "GET",
    url: "https://api.token.example/v1/apps",
  });

  assert.equal(result.bodyText, bodyText);
});

test("makeCredentialedRequest: a pathologically short credential token withholds the response body instead of substring-scrubbing it", async () => {
  const writeDeps = makeWriteDeps();
  await createCustomCredential(writeDeps, {
    workspaceId: WORKSPACE,
    label: "shorttoken",
    category: "general",
    baseUrl: "https://api.short.example",
    connection: { token: "ab" },
  });
  const httpClient = new FakeHttpClient([
    {
      status: 200,
      headers: { "X-Safe-Header": "banana" },
      bodyText: '{"count":12,"items":["abacus","table"]}',
    },
  ]);
  const deps = makeDeps({ httpClient }, writeDeps);

  const result = await makeCredentialedRequest(deps, {
    workspaceId: WORKSPACE,
    label: "shorttoken",
    method: "GET",
    url: "https://api.short.example/v1/items",
  });
  assert.equal(result.bodyText, "[body withheld: credential too short to redact safely]");
  assert.ok(!result.bodyText.includes('"count"'), "the raw body must not leak through unredacted either");
  assert.equal(result.headers["X-Safe-Header"], "banana");
});

test("makeCredentialedRequest: the UTF-8 byte cap accepts exactly 1MB and rejects oversized multibyte bodies", async () => {
  const writeDeps = await seedBasicAndBearer();
  const httpClient = new FakeHttpClient([{ status: 200, headers: {}, bodyText: "ok" }]);
  const audit = new InMemoryCredentialedRequestAuditLog();
  const deps = makeDeps({ httpClient, audit }, writeDeps);
  const body = "é".repeat(500_000);
  await makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "POST", url: "https://api.basic.example/v4/domains", body });
  assert.equal(httpClient.calls.length, 1);
  assert.equal(httpClient.calls[0]!.body, body);
  assert.equal(audit.entries.length, 1);
  assert.equal(audit.entries[0]!.bodyBytes, 1_000_000);
  await assert.rejects(
    makeCredentialedRequest(deps, { workspaceId: WORKSPACE, label: "basic.example", method: "POST", url: "https://api.basic.example/v4/domains", body: body + "é" }),
    (err: unknown) => {
      assert.ok(err instanceof CredentialedRequestValidationError);
      assert.equal(err.message, "body is 1000002 bytes, which exceeds the 1000000-byte limit for this tool");
      return true;
    }
  );
  assert.equal(httpClient.calls.length, 1);
  assert.equal(audit.entries.length, 1, "validation refusals do not produce transport audits");
});

for (const fixture of [
  { connection: { username: "user", token: "password" }, header: "Basic dXNlcjpwYXNzd29yZA==" },
  { connection: { token: "bearer-test-token" }, header: "Bearer bearer-test-token" },
  { connection: { token: "CustomV1fake_test_token_value" }, header: "CustomV1 fake_test_token_value" },
]) {
  test(`verifyCustomCredential sends the exact ${fixture.header.split(" ")[0]!} authentication header`, async () => {
    const writeDeps = makeWriteDeps();
    await createCustomCredential(writeDeps, { workspaceId: WORKSPACE, label: "probe", category: "ops", baseUrl: "https://api.token.example", connection: fixture.connection });
    const httpClient = new FakeHttpClient([{ status: 200, headers: {}, bodyText: "{}" }]);
    const result = await verifyCustomCredential(makeDeps({ httpClient }, writeDeps), { workspaceId: WORKSPACE, label: "probe" });
    assert.equal(result.status, "valid");
    assert.equal(httpClient.calls.length, 1);
    assert.equal(httpClient.calls[0]!.url, "https://api.token.example/");
    assert.equal(httpClient.calls[0]!.method, "GET");
    assert.deepEqual(httpClient.calls[0]!.headers, { Authorization: fixture.header });
  });
}
