// Boundary pins for guardedFetch: request projection, truncation refusal, header rewriting and
// bodyless statuses. Written green against the pre-refactor code.
import { expect, test } from "vitest";
import { guardedFetch } from "../fetch-adapter.js";
import type { HttpClientPort, HttpRequest, HttpResponse, RequestRedirect } from "@jini-ai/core/primitives";

class FakeClient implements HttpClientPort {
  readonly sent: { request: HttpRequest; redirect: RequestRedirect | undefined }[] = [];
  constructor(private readonly response: HttpResponse) {}
  async send({ request }: { request: HttpRequest }, optional: { redirect?: RequestRedirect } = {}): Promise<HttpResponse> {
    this.sent.push({ request, redirect: optional.redirect });
    return this.response;
  }
}
const ok: HttpResponse = { status: 200, headers: {}, bodyText: "text-body" };
const target = (client: HttpClientPort) => ({ client, url: "https://provider.example/x", timeoutMs: 500 });

test("defaults: GET, redirect refusal, no optional request fields", async () => {
  const client = new FakeClient(ok);
  await guardedFetch(target(client));
  expect(client.sent).toEqual([{ request: { method: "GET", url: "https://provider.example/x", timeoutMs: 500, headers: {} }, redirect: "error" }]);
});

test("signal, idleTimeoutMs and totalDeadlineMs are forwarded when given", async () => {
  const client = new FakeClient(ok);
  const signal = new AbortController().signal;
  await guardedFetch(target(client), { signal, idleTimeoutMs: 200, totalDeadlineMs: 900, redirect: "follow" });
  expect(client.sent[0]!.request).toEqual({ method: "GET", url: "https://provider.example/x", timeoutMs: 500, headers: {}, signal, idleTimeoutMs: 200, totalDeadlineMs: 900 });
  expect(client.sent[0]!.redirect).toBe("follow");
});

test("headers in any HeadersInit shape are flattened to lowercase names", async () => {
  const client = new FakeClient(ok);
  await guardedFetch(target(client), { headers: [["X-Token", "a"], ["Accept", "b"]] });
  expect(client.sent[0]!.request.headers).toEqual({ "x-token": "a", accept: "b" });
});

test("a string body is forwarded as-is", async () => {
  const client = new FakeClient(ok);
  await guardedFetch(target(client), { method: "POST", body: "{\"a\":1}" });
  expect(client.sent[0]!.request.body).toBe("{\"a\":1}");
});

test("without bodyBytes, the text body is returned", async () => {
  expect(await (await guardedFetch(target(new FakeClient(ok)))).text()).toBe("text-body");
});

test("without bodyBytes, a coarse truncation flag is refused", async () => {
  const client = new FakeClient({ ...ok, bodyTruncated: true });
  await expect(guardedFetch(target(client))).rejects.toThrow(new Error("guarded response was truncated by the byte policy"));
});

test("with bodyBytes, a false byte flag overrides a true coarse flag and the bytes are returned", async () => {
  const client = new FakeClient({ ...ok, bodyTruncated: true, bodyBytes: Uint8Array.from([0xff, 0x00]), bodyBytesTruncated: false });
  const response = await guardedFetch(target(client));
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from([0xff, 0x00]));
});

test("with bodyBytes but no byte flag, the coarse truncation flag is refused", async () => {
  const client = new FakeClient({ ...ok, bodyTruncated: true, bodyBytes: Uint8Array.from([1]) });
  await expect(guardedFetch(target(client))).rejects.toThrow(new Error("guarded response was truncated by the byte policy"));
});

test("with bodyBytes, a true byte flag is refused even when the coarse flag is false", async () => {
  const client = new FakeClient({ ...ok, bodyTruncated: false, bodyBytes: Uint8Array.from([1]), bodyBytesTruncated: true });
  await expect(guardedFetch(target(client))).rejects.toThrow(new Error("guarded response was truncated by the byte policy"));
});

test("a flattened set-cookie header is kept when the transport supplies no separate cookies", async () => {
  const client = new FakeClient({ ...ok, headers: { "set-cookie": "a=1", "content-length": "9", "content-encoding": "br", "x-kept": "y" } });
  const response = await guardedFetch(target(client));
  expect(response.headers.getSetCookie()).toEqual(["a=1"]);
  expect(response.headers.get("x-kept")).toBe("y");
  expect(response.headers.has("content-length")).toBe(false);
  expect(response.headers.has("content-encoding")).toBe(false);
});

test.each([204, 205, 304])("status %s returns a null body even when the transport supplies bytes", async (status) => {
  const response = await guardedFetch(target(new FakeClient({ ...ok, status, bodyBytes: new Uint8Array(0) })));
  expect(response.status).toBe(status);
  expect(response.body).toBeNull();
});

test("HEAD returns a null body even for a 200 with text", async () => {
  const response = await guardedFetch(target(new FakeClient(ok)), { method: "HEAD" });
  expect(response.status).toBe(200);
  expect(response.body).toBeNull();
});
