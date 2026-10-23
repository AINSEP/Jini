import { describe, expect, test } from "vitest";
import { executeSavedRequest, SavedRequestError } from "../index.js";
import { definition, fixture } from "./fixtures.js";

function run(f: ReturnType<typeof fixture>, saved: unknown = definition(), input: unknown = { query: "tea" }, options: { signal?: AbortSignal } = {}) {
  return executeSavedRequest({ deps: f.deps, workspaceId: "workspace-1", definition: saved, input }, options);
}

describe("saved-request credentialed execution", () => {
  test("uses the host ID resolver and existing DNS-pinned guard; returns only untrusted public fields", async () => {
    const f = fixture();
    expect(await run(f)).toEqual({ trust: "untrusted", items: [{ title: "Public" }] });
    expect(f.resolutions).toEqual([{ workspaceId: "workspace-1", credentialId: "credential-1" }]);
    expect(f.lookups).toEqual(["api.example"]);
    expect(f.deadlines).toEqual([10_000]);
    expect(f.calls).toHaveLength(1);
    const { request, peer } = f.calls[0]!;
    expect(request.url).toBe("https://api.example/catalog?public=true&q=tea");
    expect(request.headers).toEqual({ Accept: "application/json", Authorization: "Bearer secret-token-value", "User-Agent": "SavedRequestTest/1" });
    expect(request.body).toBeUndefined();
    expect(request.timeoutMs).toBe(10_000);
    expect(request.totalDeadlineMs).toBe(10_000);
    expect(request.maxResponseBytes).toBe(65_536);
    expect(peer).toEqual({ ip: "93.184.216.34", port: 443, authority: "api.example", tlsServerName: "api.example" });
    expect(f.audit.entries).toEqual([{ label: "credential-1", host: "api.example", method: "GET", status: 200, bodyBytes: 0, at: "1970-01-01T00:00:00.000Z" }]);
  });

  test("query escape strings remain inert URLSearchParams data", async () => {
    const f = fixture();
    const value = "&public=false&url=https://evil.example/${query}\r\nHost: evil.example";
    await run(f, definition(), { query: value });
    const url = new URL(f.calls[0]!.request.url);
    expect(url.origin).toBe("https://api.example");
    expect(url.pathname).toBe("/catalog");
    expect([...url.searchParams.entries()]).toEqual([["public", "true"], ["q", value]]);
    expect(Object.keys(f.calls[0]!.request.headers)).not.toContain("Host");
  });

  test.each(["POST", "PUT", "PATCH", "DELETE"] as const)("%s serializes validated JSON values without template evaluation", async method => {
    const f = fixture();
    const value = '"},"authorization":"steal","x":"${input}"';
    await run(f, definition({ method, queryBindings: {}, bodyBindings: { search: "query" }, staticBody: { catalog: "public" } }), { query: value });
    expect(f.calls[0]!.request.method).toBe(method);
    expect(f.calls[0]!.request.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(f.calls[0]!.request.body as string)).toEqual({ catalog: "public", search: value });
    expect(f.audit.entries[0]!.bodyBytes).toBe(Buffer.byteLength(f.calls[0]!.request.body as string));
  });

  test.each([{}, { query: undefined }])("optional absent or undefined fields are omitted, with and without an empty body: %j", async input => {
    const f = fixture();
    const inputSchema = { type: "object", properties: { query: { type: "string", maxLength: 200 } }, additionalProperties: false };
    await run(f, definition({ method: "POST", inputSchema, bodyBindings: { search: "query" } }), input);
    expect(f.calls[0]!.request.url).toBe("https://api.example/catalog?public=true");
    expect(f.calls[0]!.request.body).toBeUndefined();
    expect(f.calls[0]!.request.headers).not.toHaveProperty("Content-Type");
    await run(f, definition({ method: "POST", inputSchema, queryBindings: {}, bodyBindings: { search: "query" }, staticBody: { catalog: "public" } }), input);
    expect(f.calls[1]!.request.body).toBe('{"catalog":"public"}');
    expect(f.calls[1]!.request.headers["Content-Type"]).toBe("application/json");
  });

  test("bodyless DELETE omits Content-Type", async () => {
    const f = fixture();
    await run(f, definition({ method: "DELETE" }));
    expect(f.calls[0]!.request.body).toBeUndefined();
    expect(f.calls[0]!.request.headers).not.toHaveProperty("Content-Type");
  });

  test("binds primitive query and nested object/array body values", async () => {
    const f = fixture();
    const inputSchema = { type: "object", properties: {
      count: { type: "integer", minimum: 0, maximum: 2 }, flag: { type: "boolean" },
      values: { type: "array", maxItems: 2, items: { type: "boolean" } },
      filter: { type: "object", properties: { term: { type: "string", maxLength: 20 } }, additionalProperties: false },
    }, additionalProperties: false };
    await run(f, definition({ method: "POST", inputSchema, queryBindings: { count: "count", flag: "flag" }, bodyBindings: { values: "values", filter: "filter" } }), { count: 0, flag: false, values: [true], filter: { term: "public" } });
    expect(f.calls[0]!.request.url).toBe("https://api.example/catalog?public=true&count=0&flag=false");
    expect(JSON.parse(f.calls[0]!.request.body as string)).toEqual({ values: [true], filter: { term: "public" } });
  });

  test("redacts reflected Bearer and Basic secrets before projection", async () => {
    const f = fixture();
    f.state.response = { ...f.state.response, bodyText: JSON.stringify({ products: [{ title: "Bearer secret-token-value" }] }) };
    expect(await run(f)).toEqual({ trust: "untrusted", items: [{ title: "[REDACTED]" }] });
    f.state.credential = { ...f.state.credential!, connection: { username: "service-user", token: "secret-token-value" } };
    const basic = Buffer.from("service-user:secret-token-value").toString("base64");
    f.state.response = { ...f.state.response, bodyText: JSON.stringify({ products: [{ title: `Basic ${basic} ${basic} secret-token-value` }] }) };
    expect(await run(f)).toEqual({ trust: "untrusted", items: [{ title: "[REDACTED] [REDACTED] [REDACTED]" }] });
  });

  test("short credentials withhold the provider body rather than leak it", async () => {
    const f = fixture();
    f.state.credential = { ...f.state.credential!, connection: { token: "short" } };
    await expect(run(f)).rejects.toMatchObject({ code: "invalid_response" });
  });

  test("JSON-escaped credential echoes are decoded and redacted before field selection", async () => {
    const f = fixture();
    f.state.response = { ...f.state.response, bodyText: '{"products":[{"title":"\\u0073ecret-token-value"}]}' };
    expect(await run(f)).toEqual({ trust: "untrusted", items: [{ title: "[REDACTED]" }] });
    f.state.credential = { ...f.state.credential!, connection: { token: 'a"bcdefgh' } };
    f.state.response = { ...f.state.response, bodyText: JSON.stringify({ products: [{ title: 'a"bcdefgh' }] }) };
    expect(await run(f)).toEqual({ trust: "untrusted", items: [{ title: "[REDACTED]" }] });
  });

  test("a numeric credential echo cannot be projected as a number", async () => {
    const f = fixture();
    f.state.credential = { ...f.state.credential!, connection: { token: "12345678" } };
    f.state.response = { ...f.state.response, bodyText: '{"products":[{"count":12345678}]}' };
    await expect(run(f, definition({ output: { path: ["products"], maxItems: 1, fields: { count: { path: ["count"], type: "number" } } } }))).rejects.toMatchObject({ code: "invalid_response" });
    expect(f.audit.entries[0]!.status).toBe(200);
  });

  test("configuration and input are snapshotted before asynchronous credential resolution", async () => {
    const f = fixture();
    const saved = definition(); const input = { query: "reviewed" };
    const promise = run(f, saved, input);
    (saved as { url: string }).url = "https://evil.example/";
    input.query = "changed";
    await promise;
    expect(f.calls[0]!.request.url).toBe("https://api.example/catalog?public=true&q=reviewed");
  });
});

describe("refuse before credential resolution or dispatch", () => {
  test.each([{}, null, [], { query: undefined }, { query: 1 }, { query: "" }, { query: "x".repeat(201) }, { query: "tea", url: "https://evil.example" }, { query: "tea", headers: { Host: "evil" } }, { query: "tea", credentialId: "other" }])("closed schema refuses input %#", async input => {
    const f = fixture();
    await expect(run(f, definition(), input)).rejects.toMatchObject({ code: "invalid_input" });
    expect(f.resolutions).toEqual([]); expect(f.calls).toEqual([]);
  });

  test("counts Unicode input and encoded query/request bytes without truncation", async () => {
    const f = fixture();
    const inputSchema = { type: "object", properties: { query: { type: "string", maxLength: 4096 }, extra: { type: "string", maxLength: 4096 } }, required: ["query"], additionalProperties: false };
    await expect(run(f, definition({ inputSchema }), { query: "💥".repeat(4096), extra: "💥" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(run(f, definition({ inputSchema }), { query: "💥".repeat(2000) })).rejects.toMatchObject({ code: "invalid_input" });
    expect(f.resolutions).toEqual([]); expect(f.calls).toEqual([]);
  });

  test.each(["https://site.example/api/admin", "https://site.example:8443/api", "https://admin.example/private"])("refuses host control origin %s", async url => {
    const f = fixture();
    const origin = new URL(url).origin;
    await expect(run(f, definition({ url, credential: { id: "credential-1", revision: "rev-1", origin } }))).rejects.toMatchObject({ code: "invalid_definition" });
    expect(f.resolutions).toEqual([]); expect(f.calls).toEqual([]);
  });

  test.each(["http://site.example", "https://site.example:8443"])("refuses the control hostname even when the configured origin is %s", async origin => {
    const f = fixture();
    await expect(executeSavedRequest({ deps: { ...f.deps, forbiddenOrigins: [origin] }, workspaceId: "workspace-1", definition: definition({ url: "https://site.example/api", credential: { id: "credential-1", revision: "rev-1", origin: "https://site.example" } }), input: { query: "tea" } })).rejects.toMatchObject({ code: "invalid_definition" });
    expect(f.resolutions).toEqual([]); expect(f.calls).toEqual([]);
  });

  test("invalid trusted origin configuration fails with a value-free public error", async () => {
    const f = fixture();
    await expect(executeSavedRequest({ deps: { ...f.deps, forbiddenOrigins: ["private host configuration"] }, workspaceId: "workspace-1", definition: definition(), input: { query: "tea" } })).rejects.toMatchObject({ code: "execution_failed", message: "Saved request refused: execution_failed" });
    expect(f.resolutions).toEqual([]); expect(f.calls).toEqual([]);
  });

  test.each([null, { revision: "rev-2" }, { baseUrl: "https://other.example" }, { connection: { token: "secret\r\nX-Injected: yes" } }])("deleted, revised, retargeted or header-injected credential refuses %#", async patch => {
    const f = fixture();
    f.state.credential = patch === null ? null : { ...f.state.credential!, ...patch };
    await expect(run(f)).rejects.toMatchObject({ code: "credential_changed" });
    expect(f.calls).toEqual([]);
  });

  test("additionalHosts never grants a second visitor origin", async () => {
    const f = fixture();
    await expect(run(f, definition({ url: "https://other.example/catalog", credential: { id: "credential-1", revision: "rev-1", origin: "https://other.example" } }))).rejects.toMatchObject({ code: "credential_changed" });
    expect(f.calls).toEqual([]);
  });

  test("cancellation before and during credential resolution never dispatches", async () => {
    const f = fixture(); const abort = new AbortController(); abort.abort();
    await expect(run(f, definition(), { query: "tea" }, { signal: abort.signal })).rejects.toMatchObject({ code: "execution_failed" });
    expect(f.resolutions).toEqual([]);
    const second = new AbortController();
    const promise = run(f, definition(), { query: "tea" }, { signal: second.signal });
    second.abort();
    await expect(promise).rejects.toMatchObject({ code: "execution_failed" });
    expect(f.calls).toEqual([]);
  });
});

describe("real guarded HTTP with fake DNS and pinned transport", () => {
  test.each(["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.2", "169.254.169.254", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "0.0.0.0"])("refuses private/loopback/link-local/metadata address %s", async address => {
    const f = fixture(); f.state.addresses = [address];
    await expect(run(f)).rejects.toMatchObject({ code: "execution_failed" });
    expect(f.calls).toEqual([]);
    expect(f.audit.entries[0]!.status).toBe(0);
  });

  test("mixed DNS answers refuse without dialing the public address", async () => {
    const f = fixture(); f.state.addresses = ["93.184.216.34", "127.0.0.1"];
    await expect(run(f)).rejects.toMatchObject({ code: "execution_failed" });
    expect(f.calls).toEqual([]);
  });

  test("literal loopback and IPv6 targets use the guard without a DNS bypass", async () => {
    for (const origin of ["https://127.0.0.1", "https://[::1]"]) {
      const f = fixture(); f.state.credential = { ...f.state.credential!, baseUrl: origin };
      await expect(run(f, definition({ url: origin, credential: { id: "credential-1", revision: "rev-1", origin } }))).rejects.toMatchObject({ code: "execution_failed" });
      expect(f.lookups).toEqual([]); expect(f.calls).toEqual([]);
    }
  });

  test.each([301, 302, 303, 307, 308])("refuses HTTP %s redirects before following any Location", async status => {
    const f = fixture(); f.state.response = { status, headers: { location: "https://127.0.0.1/private" }, bodyText: "" };
    await expect(run(f)).rejects.toMatchObject({ code: "execution_failed" });
    expect(f.lookups).toEqual(["api.example"]); expect(f.calls).toHaveLength(1);
  });

  test.each([
    { bodyText: "x".repeat(65_537) }, { bodyText: "💥".repeat(16_385) },
    { bodyBytes: new Uint8Array(65_537) }, { bodyTruncated: true }, { bodyBytesTruncated: true },
    { status: 401 }, { status: 403 }, { status: 500 }, { headers: {} }, { bodyText: "malformed JSON" },
    { headers: { "content-type": "text/html" }, bodyText: "<script>evil</script>" },
  ])("refuses oversize/truncated/error/non-JSON transport response %#", async response => {
    const f = fixture(); f.state.response = { ...f.state.response, ...response };
    await expect(run(f)).rejects.toMatchObject({ code: "invalid_response" });
    expect(f.calls).toHaveLength(1);
    expect(f.audit.entries[0]!.status).toBe(response.status ?? 200);
  });

  test("a provider 401 refusal retains its actual audit status even with a malformed body", async () => {
    const f = fixture();
    f.state.response = { status: 401, headers: { "content-type": "application/json" }, bodyText: "private provider error secret-token-value" };
    await expect(run(f)).rejects.toMatchObject({ code: "invalid_response", message: "Saved request refused: invalid_response" });
    expect(f.audit.entries).toEqual([{ label: "credential-1", host: "api.example", method: "GET", status: 401, bodyBytes: 0, at: "1970-01-01T00:00:00.000Z" }]);
  });

  test("accepts complete JSON at the 64 KiB byte boundary and JSON media suffixes", async () => {
    const f = fixture();
    const body = f.state.response.bodyText;
    f.state.response = { ...f.state.response, headers: { "Content-Type": "application/vnd.api+json; charset=utf-8" }, bodyText: body.padEnd(65_536, " "), bodyTruncated: false, bodyBytesTruncated: false };
    expect(await run(f)).toEqual({ trust: "untrusted", items: [{ title: "Public" }] });
  });

  test("the guard's 10s deadline aborts a pending transport without sleep or retries", async () => {
    const f = fixture();
    f.state.send = async request => {
      expect(request.signal!.aborted).toBe(false);
      f.state.deadline.abort(new Error("deadline"));
      return new Promise(() => {});
    };
    await expect(run(f)).rejects.toMatchObject({ code: "execution_failed" });
    expect(f.deadlines).toEqual([10_000]); expect(f.calls).toHaveLength(1);
  });

  test("caller cancellation reaches the socket/body boundary", async () => {
    const f = fixture(); const abort = new AbortController();
    f.state.send = async request => {
      abort.abort();
      expect(request.signal!.aborted).toBe(true);
      return new Promise(() => {});
    };
    await expect(run(f, definition(), { query: "tea" }, { signal: abort.signal })).rejects.toMatchObject({ code: "execution_failed" });
    expect(f.calls).toHaveLength(1);
  });

  test("transport and host failures expose no provider detail, credential or stack cause", async () => {
    const f = fixture(); f.state.failure = new Error("private endpoint secret-token-value");
    const error: unknown = await run(f).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(SavedRequestError);
    expect(error).toMatchObject({ code: "execution_failed", message: "Saved request refused: execution_failed" });
    expect((error as Error).cause).toBeUndefined();
    expect(f.calls).toHaveLength(1);
    expect(JSON.stringify(f.audit.entries)).not.toContain("secret-token-value");
    f.deps.credentials.resolve = async () => { throw new Error("decrypt secret-token-value"); };
    await expect(run(f)).rejects.toMatchObject({ message: "Saved request refused: execution_failed" });
  });
});
