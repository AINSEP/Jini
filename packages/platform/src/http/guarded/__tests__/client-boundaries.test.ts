// Boundary pins for client.ts: every refusal, validation diagnostic, redirect and header rule that the
// broader suites leave implicit. Written green against the pre-refactor code so the split stays provably
// behaviour-identical.
import { expect, test } from "vitest";
import { FetchTimeoutError } from "../../../fetch-with-timeout.js";
import { classifyAddress, createHttpClient } from "../client.js";
import { EgressRefusedError } from "../errors.js";
import type { HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import type { DnsResolver, GuardedClock, EgressPolicy, HttpTransportAdapter, PinnedPeer } from "../ports.js";

const policy: EgressPolicy = {
  allowedSchemes: ["https"], denyPrivateAddresses: true, devHostAllowlist: [], maxRedirects: 3,
  connectTimeoutMs: 1000, maxResponseBytes: 100, maxDecompressedBytes: 100,
};
const publicDns: DnsResolver = { resolve: async () => ["93.184.216.34"] };
const idleClock: GuardedClock = { nowMs: () => 0, timeoutSignal: () => new AbortController().signal };

class Recorder implements HttpTransportAdapter {
  readonly calls: { request: HttpRequest; peer: PinnedPeer }[] = [];
  constructor(private readonly responses: HttpResponse[]) {}
  async requestPinned(input: { request: HttpRequest; peer: PinnedPeer }): Promise<HttpResponse> {
    this.calls.push(input);
    return this.responses[Math.min(this.calls.length - 1, this.responses.length - 1)]!;
  }
}
const ok: HttpResponse = { status: 200, headers: {}, bodyText: "ok" };
const get = (overrides: Partial<HttpRequest> = {}): HttpRequest => ({ method: "GET", url: "https://example.com/", headers: {}, timeoutMs: 500, ...overrides });
const unreachable: HttpTransportAdapter = { requestPinned: async () => { throw new Error("unexpected transport"); } };

test("classifyAddress: an IPv4-compatible ::0.x.y.z spelling that is not otherwise private is reserved", () => {
  expect(classifyAddress({ ip: "::0.0.0.2" })).toBe("reserved");
  expect(classifyAddress({ ip: "::0.0.0.2".toUpperCase() })).toBe("reserved");
});

test("classifyAddress: the same address in compressed hex spelling ::2 is public (reported, not fixed)", () => {
  // Spelling-dependent: ::0.0.0.2 and ::2 are one address, but only the dotted spelling is caught.
  expect(classifyAddress({ ip: "::2" })).toBe("public");
});

test("a URL target spelled [::0.0.0.2] is normalized to [::2] and admitted as public (reported, not fixed)", async () => {
  const transport = new Recorder([ok]);
  const client = createHttpClient({ transport, policy, dns: publicDns, clock: idleClock, userAgent: "Pin/1.0" });
  await client.send({ request: get({ url: "https://[::0.0.0.2]/" }) });
  expect(transport.calls[0]!.peer.ip).toBe("::2");
});

test("an empty DNS answer is an operational Error naming the host, not a policy refusal, and dials nothing", async () => {
  const client = createHttpClient({ transport: unreachable, policy, dns: { resolve: async () => [] }, clock: idleClock, userAgent: "Pin/1.0" });
  const failure = await client.send({ request: get() }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
  expect(failure).not.toBeInstanceOf(EgressRefusedError);
  expect((failure as Error).message).toBe("could not resolve any address for host 'example.com'");
});

test.each(["", "   "])("a blank userAgent %j is refused at construction", (userAgent) => {
  expect(() => createHttpClient({ transport: unreachable, policy, dns: publicDns, clock: idleClock, userAgent }))
    .toThrow(new TypeError("userAgent is required"));
});

for (const field of ["connectTimeoutMs", "maxResponseBytes", "maxDecompressedBytes"] as const) {
  test.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(`policy ${field} %s is refused at construction`, (value) => {
    expect(() => createHttpClient({ transport: unreachable, policy: { ...policy, [field]: value }, dns: publicDns, clock: idleClock, userAgent: "Pin/1.0" }))
      .toThrow(new TypeError("policy time and byte limits must be positive safe integers"));
  });
}

test.each([-1, 1.5, Number.NaN])("policy maxRedirects %s is refused at construction", (maxRedirects) => {
  expect(() => createHttpClient({ transport: unreachable, policy: { ...policy, maxRedirects }, dns: publicDns, clock: idleClock, userAgent: "Pin/1.0" }))
    .toThrow(new TypeError("maxRedirects must be a nonnegative safe integer"));
});

test("policy maxRedirects 0 is accepted and returns the first 3xx unfollowed", async () => {
  const transport = new Recorder([{ status: 302, headers: { location: "/next" }, bodyText: "" }, ok]);
  const client = createHttpClient({ transport, policy: { ...policy, maxRedirects: 0 }, dns: publicDns, clock: idleClock, userAgent: "Pin/1.0" });
  expect((await client.send({ request: get() })).status).toBe(302);
  expect(transport.calls).toHaveLength(1);
});

test.each([0, -1, 1.5, Number.NaN])("request maxResponseBytes %s is refused before I/O", async (maxResponseBytes) => {
  const client = createHttpClient({ transport: unreachable, policy, dns: { resolve: async () => { throw new Error("unexpected DNS"); } }, clock: idleClock, userAgent: "Pin/1.0" });
  await expect(client.send({ request: get({ maxResponseBytes }) })).rejects.toThrow(new TypeError("maxResponseBytes must be a positive safe integer"));
});

test("a caller's smaller maxResponseBytes bounds the transport request and caps the returned body", async () => {
  const transport = new Recorder([{ status: 200, headers: {}, bodyText: "0123456789" }]);
  const client = createHttpClient({ transport, policy, dns: publicDns, clock: idleClock, userAgent: "Pin/1.0" });
  const response = await client.send({ request: get({ maxResponseBytes: 4 }) });
  expect(transport.calls[0]!.request.maxResponseBytes).toBe(4);
  expect(response.bodyText).toBe("0123");
  expect(response.bodyTruncated).toBe(true);
});

test("idleTimeoutMs wins over timeoutMs and both outgoing fields carry the same bounded value", async () => {
  const transport = new Recorder([ok]);
  const client = createHttpClient({ transport, policy, dns: publicDns, clock: idleClock, userAgent: "Pin/1.0" });
  await client.send({ request: get({ timeoutMs: 900, idleTimeoutMs: 300 }) });
  expect(transport.calls[0]!.request).toMatchObject({ idleTimeoutMs: 300, timeoutMs: 300 });
});

test("a capitalized Location header is followed like a lowercase one", async () => {
  const transport = new Recorder([{ status: 301, headers: { Location: "/moved" }, bodyText: "" }, ok]);
  const client = createHttpClient({ transport, policy, dns: publicDns, clock: idleClock, userAgent: "Pin/1.0" });
  const response = await client.send({ request: get() });
  expect(transport.calls.map(call => call.request.url)).toEqual(["https://example.com/", "https://example.com/moved"]);
  expect(response.finalUrl).toBe("https://example.com/moved");
});

test.each([303, 307, 308])("a %s redirect is followed for GET", async (status) => {
  const transport = new Recorder([{ status, headers: { location: "/next" }, bodyText: "" }, ok]);
  const client = createHttpClient({ transport, policy, dns: publicDns, clock: idleClock, userAgent: "Pin/1.0" });
  expect((await client.send({ request: get() })).status).toBe(200);
  expect(transport.calls).toHaveLength(2);
});

test("a non-redirect 3xx (304) is returned without following its Location", async () => {
  const transport = new Recorder([{ status: 304, headers: { location: "/next" }, bodyText: "" }, ok]);
  const client = createHttpClient({ transport, policy, dns: publicDns, clock: idleClock, userAgent: "Pin/1.0" });
  expect((await client.send({ request: get() })).status).toBe(304);
  expect(transport.calls).toHaveLength(1);
});

test("redirect:manual returns the 3xx unfollowed", async () => {
  const transport = new Recorder([{ status: 302, headers: { location: "/next" }, bodyText: "" }, ok]);
  const client = createHttpClient({ transport, policy, dns: publicDns, clock: idleClock, userAgent: "Pin/1.0" });
  expect((await client.send({ request: get() }, { redirect: "manual" })).status).toBe(302);
  expect(transport.calls).toHaveLength(1);
});

test("redirect:error refuses with an EgressRefusedError whose two messages match and name no Location", async () => {
  const transport = new Recorder([{ status: 307, headers: { location: "https://10.0.0.1/" }, bodyText: "" }]);
  const client = createHttpClient({ transport, policy, dns: publicDns, clock: idleClock, userAgent: "Pin/1.0" });
  const failure = await client.send({ request: get() }, { redirect: "error" }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(EgressRefusedError);
  expect(failure).toMatchObject({
    message: "redirect response refused by the request's redirect policy",
    callerSafeMessage: "redirect response refused by the request's redirect policy",
  });
});

test("with both a caller signal and a total deadline, the transport gets a signal that follows the caller", async () => {
  const caller = new AbortController();
  const transport = new Recorder([ok]);
  const client = createHttpClient({ transport, policy, dns: publicDns, clock: idleClock, userAgent: "Pin/1.0" });
  await client.send({ request: get({ signal: caller.signal, totalDeadlineMs: 5000 }) });
  const sent = transport.calls[0]!.request.signal!;
  expect(sent).not.toBe(caller.signal);
  caller.abort(new Error("caller stop"));
  expect(sent.aborted).toBe(true);
});

test("when the caller and the deadline have both aborted, the caller's reason wins over a FetchTimeoutError", async () => {
  const reason = new Error("caller stop");
  const expired: GuardedClock = { nowMs: () => 0, timeoutSignal: () => AbortSignal.abort(new Error("deadline")) };
  const client = createHttpClient({ transport: unreachable, policy, dns: publicDns, clock: expired, userAgent: "Pin/1.0" });
  const failure = await client.send({ request: get({ signal: AbortSignal.abort(reason), totalDeadlineMs: 5000 }) }).catch((error: unknown) => error);
  expect(failure).toBe(reason);
  expect(failure).not.toBeInstanceOf(FetchTimeoutError);
});

test("an expired total deadline without a caller signal surfaces as a FetchTimeoutError", async () => {
  const expired: GuardedClock = { nowMs: () => 0, timeoutSignal: () => AbortSignal.abort(new Error("deadline")) };
  const client = createHttpClient({ transport: unreachable, policy, dns: publicDns, clock: expired, userAgent: "Pin/1.0" });
  const failure = await client.send({ request: get({ totalDeadlineMs: 5000 }) }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(FetchTimeoutError);
  expect((failure as FetchTimeoutError).message).toBe("fetch timed out after 5000ms: https://example.com/");
});

test("a non-deadline transport failure under a live deadline is rethrown unchanged", async () => {
  const boom = new Error("socket reset");
  const client = createHttpClient({ transport: { requestPinned: async () => { throw boom; } }, policy, dns: publicDns, clock: idleClock, userAgent: "Pin/1.0" });
  await expect(client.send({ request: get({ totalDeadlineMs: 5000 }) })).rejects.toBe(boom);
});

test("a caller signal already aborted before send dials nothing and rethrows its reason", async () => {
  const reason = new Error("already stopped");
  const client = createHttpClient({ transport: unreachable, policy, dns: publicDns, clock: idleClock, userAgent: "Pin/1.0" });
  await expect(client.send({ request: get({ signal: AbortSignal.abort(reason) }) })).rejects.toBe(reason);
});

test("finalUrl is the normalized URL that was pinned, not the caller's spelling", async () => {
  const transport = new Recorder([ok]);
  const client = createHttpClient({ transport, policy, dns: publicDns, clock: idleClock, userAgent: "Pin/1.0" });
  const response = await client.send({ request: get({ url: "https://EXAMPLE.com:443/a/../b" }) });
  expect(response.finalUrl).toBe("https://example.com/b");
});
