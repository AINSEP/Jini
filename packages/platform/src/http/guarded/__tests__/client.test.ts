import assert from "node:assert/strict";
import { test, vi, afterEach } from "vitest";
afterEach(() => vi.restoreAllMocks());
import { EgressRefusedError } from "../errors.js";
import type { HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import type { EgressPolicy, PinnedPeer } from "../ports.js";
import type { HttpTransportAdapter } from "../ports.js";
const dnsFailure = Object.assign(new Error("fixture DNS lookup failed"), { code: "ENOTFOUND" });
const dns = { async resolve({ hostname }: {
        hostname: string;
    }) {
        if (hostname === "nonexistent-host.invalid")
            throw dnsFailure;
        if (hostname === "localhost")
            return ["127.0.0.1"];
        if (hostname === "mixed.example")
            return ["8.8.8.8", "10.0.0.1"];
        assert.equal(hostname, "example.com", "unexpected DNS lookup in this hermetic suite");
        return ["93.184.216.34"];
    } };
const clock = { nowMs: () => Date.now(), timeoutSignal: ({ timeoutMs }: {
        timeoutMs: number;
    }) => AbortSignal.timeout(timeoutMs) };
const { classifyAddress, createHttpClient } = await import("../client.js");
function makePolicy(overrides: Partial<EgressPolicy> = {}): EgressPolicy {
    return {
        allowedSchemes: ["https"],
        denyPrivateAddresses: true,
        devHostAllowlist: [],
        maxRedirects: 3,
        connectTimeoutMs: 5000,
        maxResponseBytes: 1000000,
        maxDecompressedBytes: 1000000,
        ...overrides,
    };
}
function makeRequest(overrides: Partial<HttpRequest> = {}): HttpRequest {
    return {
        method: "GET",
        url: "https://example.com/",
        headers: {},
        timeoutMs: 1000,
        ...overrides,
    };
}
class ScriptedTransport implements HttpTransportAdapter {
    calls: Array<{
        req: HttpRequest;
        peer: PinnedPeer;
    }> = [];
    private responses: HttpResponse[];
    private cursor = 0;
    constructor(responses: HttpResponse[]) {
        this.responses = responses;
    }
    async requestPinned({ request: req, peer: peer }: { request: HttpRequest; peer: PinnedPeer }): Promise<HttpResponse> {
        this.calls.push({ req, peer });
        const response = this.responses[Math.min(this.cursor, this.responses.length - 1)];
        this.cursor += 1;
        return response!;
    }
}
test("a mixed public/private DNS answer refuses the entire target before transport", async () => {
    const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "ok" }]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    await assert.rejects(() => client.send({ request: makeRequest({ url: "https://mixed.example/" }) }), {
        name: "EgressRefusedError", message: "egress to 'mixed.example' (10.0.0.1) rejected: resolved address is private",
    });
    assert.equal(transport.calls.length, 0);
});
for (const [url, port] of [["https://example.com/", 443], ["http://example.com/", 80], ["https://example.com:8443/", 8443]] as const) {
    test(`pins the correct port and authority for ${url}`, async () => {
        const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "ok" }]);
        const client = createHttpClient({ ...{ transport, policy: makePolicy({ allowedSchemes: ["http", "https"] }) }, dns, clock, userAgent: "Fixture/1.0" });
        await client.send({ request: makeRequest({ url }) });
        assert.deepEqual(transport.calls[0]!.peer, { ip: "93.184.216.34", port, authority: new URL(url).host, tlsServerName: "example.com" });
    });
}
for (const [target, sameOrigin] of [["https://example.com:8443/next", false], ["http://example.com/next", false], ["https://example.com/next", true]] as const) {
    test(`redirect to ${target} ${sameOrigin ? "keeps" : "strips"} same-host credentials`, async () => {
        const transport = new ScriptedTransport([
            { status: 302, headers: { location: target }, bodyText: "" },
            { status: 200, headers: {}, bodyText: "final" },
        ]);
        const client = createHttpClient({ ...{ transport, policy: makePolicy({ allowedSchemes: ["https", "http"] }) }, dns, clock, userAgent: "Fixture/1.0" });
        const headers = { Authorization: "Bearer secret", Cookie: "session=secret", "X-Kept": "yes" };
        await client.send({ request: makeRequest({ headers }) });
        assert.equal(transport.calls.length, 2);
        const sent = transport.calls[1]!.req.headers;
        assert.equal(sent.Authorization, sameOrigin ? headers.Authorization : undefined);
        assert.equal(sent.Cookie, sameOrigin ? headers.Cookie : undefined);
        assert.equal(sent["X-Kept"], "yes");
    });
}
test("a repeated redirect stops after the positive redirect budget", async () => {
    const transport = new ScriptedTransport([{ status: 302, headers: { location: "/loop" }, bodyText: "" }]);
    const original = transport.requestPinned.bind(transport);
    transport.requestPinned = async ({ request: req, peer }) => {
        assert.ok(transport.calls.length < 4, "the redirect counter must advance on every hop");
        return original({ request: req, peer });
    };
    const client = createHttpClient({ ...{ transport, policy: makePolicy({ maxRedirects: 3 }) }, dns, clock, userAgent: "Fixture/1.0" });
    assert.equal((await client.send({ request: makeRequest() })).status, 302);
    assert.equal(transport.calls.length, 4);
});
for (const [location, resolved] of [["/next", "https://example.com/next"], ["../x", "https://example.com/x"]]) {
    test(`resolves relative Location ${location} against the current URL`, async () => {
        const transport = new ScriptedTransport([
            { status: 302, headers: { location: location! }, bodyText: "" },
            { status: 200, headers: {}, bodyText: "final" },
        ]);
        const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
        const response = await client.send({ request: makeRequest({ url: "https://example.com/dir/start" }) });
        assert.equal(transport.calls.length, 2);
        assert.equal(transport.calls[1]!.req.url, resolved);
        assert.equal(response.finalUrl, resolved);
    });
}
test("a caller's shorter timeout stays below the policy ceiling", async () => {
    const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "ok" }]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy({ connectTimeoutMs: 500 }) }, dns, clock, userAgent: "Fixture/1.0" });
    await client.send({ request: makeRequest({ timeoutMs: 100 }) });
    assert.equal(transport.calls[0]!.req.timeoutMs, 100);
});
test("classifyAddress: private/loopback/link-local/metadata/public per address family", () => {
    assert.equal(classifyAddress({ ip: "10.1.2.3" }), "private");
    assert.equal(classifyAddress({ ip: "172.16.0.5" }), "private");
    assert.equal(classifyAddress({ ip: "192.168.1.1" }), "private");
    assert.equal(classifyAddress({ ip: "127.0.0.1" }), "loopback");
    assert.equal(classifyAddress({ ip: "169.254.169.254" }), "link-local"); // cloud metadata
    assert.equal(classifyAddress({ ip: "8.8.8.8" }), "public");
    assert.equal(classifyAddress({ ip: "::1" }), "loopback");
    assert.equal(classifyAddress({ ip: "fe80::1" }), "link-local");
    assert.equal(classifyAddress({ ip: "fd00::1" }), "private");
    assert.equal(classifyAddress({ ip: "2001:4860:4860::8888" }), "public");
    // IPv4-mapped IPv6, normalized before classification. See docs/decisions/DR-002-guarded-egress.md.
    assert.equal(classifyAddress({ ip: "::ffff:127.0.0.1" }), "loopback");
    assert.equal(classifyAddress({ ip: "::ffff:10.0.0.1" }), "private");
});
// -------------------------------------------------------------------------------------------
// Characterization tests for `classifyIpv4`'s exact range boundaries, pinned before an internal
// refactor of that function (extraction only, no ranges added/removed/reordered).
// -------------------------------------------------------------------------------------------
test("classifyAddress: RFC1918 172.16/12 boundaries are exact, not off-by-one", () => {
    assert.equal(classifyAddress({ ip: "172.15.255.255" }), "public"); // just below the private block
    assert.equal(classifyAddress({ ip: "172.16.0.0" }), "private"); // first private address
    assert.equal(classifyAddress({ ip: "172.31.255.255" }), "private"); // last private address
    assert.equal(classifyAddress({ ip: "172.32.0.0" }), "public"); // just above the private block
});
test("classifyAddress: CGNAT (RFC 6598 100.64.0.0/10) is treated as private, exact boundaries", () => {
    // Shared/carrier-grade-NAT space is not globally routable — blocked like the RFC1918 ranges.
    assert.equal(classifyAddress({ ip: "100.63.255.255" }), "public"); // just below the CGNAT block
    assert.equal(classifyAddress({ ip: "100.64.0.0" }), "private"); // first CGNAT address
    assert.equal(classifyAddress({ ip: "100.100.0.1" }), "private");
    assert.equal(classifyAddress({ ip: "100.127.255.255" }), "private"); // last CGNAT address
    assert.equal(classifyAddress({ ip: "100.128.0.0" }), "public"); // just above the CGNAT block
});
test("classifyAddress: reserved and multicast IPv4 ranges fail closed", () => {
    assert.equal(classifyAddress({ ip: "0.0.0.0" }), "reserved");
    assert.equal(classifyAddress({ ip: "0.1.2.3" }), "reserved");
    assert.equal(classifyAddress({ ip: "223.255.255.255" }), "public"); // just below multicast
    assert.equal(classifyAddress({ ip: "224.0.0.1" }), "reserved"); // multicast
    assert.equal(classifyAddress({ ip: "239.255.255.255" }), "reserved"); // end of multicast
    assert.equal(classifyAddress({ ip: "240.0.0.1" }), "reserved"); // reserved/future
    assert.equal(classifyAddress({ ip: "255.255.255.255" }), "reserved"); // limited broadcast
});
test("classifyAddress: malformed input fails closed to reserved, never public", () => {
    assert.equal(classifyAddress({ ip: "not-an-ip" }), "reserved");
    assert.equal(classifyAddress({ ip: "999.999.999.999" }), "reserved");
    assert.equal(classifyAddress({ ip: "" }), "reserved");
    assert.equal(classifyAddress({ ip: "10.0.0" }), "reserved"); // incomplete IPv4
});
// -------------------------------------------------------------------------------------------
// Characterization tests for `classifyIpv6`'s exact range boundaries, pinned before an internal
// refactor of that function (extraction only, no ranges added/removed/reordered — mirrors
// `classifyIpv4`'s own boundary tests above).
// -------------------------------------------------------------------------------------------
test("classifyAddress: IPv6 loopback and unspecified are exact single addresses, not ranges", () => {
    assert.equal(classifyAddress({ ip: "::1" }), "loopback");
    assert.equal(classifyAddress({ ip: "::" }), "reserved"); // unspecified address
    assert.equal(classifyAddress({ ip: "::0" }), "reserved");
    assert.equal(classifyAddress({ ip: "::0.0.0.0" }), "reserved"); // deprecated IPv4-compatible notation
    assert.equal(classifyAddress({ ip: "::2" }), "public"); // one past unspecified/loopback — not special
});
test("classifyAddress: IPv6 link-local fe80::/10 boundaries are exact, not off-by-one", () => {
    assert.equal(classifyAddress({ ip: "fe7f::1" }), "public"); // just below the link-local block
    assert.equal(classifyAddress({ ip: "fe80::1" }), "link-local"); // first address of the block
    assert.equal(classifyAddress({ ip: "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff" }), "link-local"); // last address
    assert.equal(classifyAddress({ ip: "fec0::1" }), "public"); // just above the link-local block
});
test("classifyAddress: IPv6 unique-local fc00::/7 covers both the fc and fd halves, with exact boundaries", () => {
    assert.equal(classifyAddress({ ip: "fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff" }), "public"); // just below
    assert.equal(classifyAddress({ ip: "fc00::1" }), "private"); // first address of the fc half
    assert.equal(classifyAddress({ ip: "fcff:ffff:ffff:ffff:ffff:ffff:ffff:ffff" }), "private"); // last of fc half
    assert.equal(classifyAddress({ ip: "fd00::1" }), "private"); // first address of the fd half
    assert.equal(classifyAddress({ ip: "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff" }), "private"); // last address of the block
    assert.equal(classifyAddress({ ip: "fe00::1" }), "public"); // just above
});
test("classifyAddress: IPv4-mapped IPv6 (dotted-decimal form) is normalized before classification", () => {
    assert.equal(classifyAddress({ ip: "::ffff:127.0.0.1" }), "loopback");
    assert.equal(classifyAddress({ ip: "::ffff:10.0.0.1" }), "private");
    assert.equal(classifyAddress({ ip: "::ffff:8.8.8.8" }), "public");
});
test("classifyAddress: IPv4-mapped IPv6 written in HEX form (not dotted-decimal) is normalized the same as the dotted spelling", () => {
    // `::ffff:a00:1` and `::ffff:10.0.0.1` name the SAME address (10.0.0.1 mapped into IPv6) — both
    // must classify identically. A URL target of `https://[::ffff:a00:1]/` reaches this exact path
    // (the hostname is a literal IPv6 address, so `resolveHostAddresses` never touches DNS), so the
    // hex spelling must not be a bypass of the dotted-decimal one.
    assert.equal(classifyAddress({ ip: "::ffff:a00:1" }), "private"); // hex form of 10.0.0.1
    assert.equal(classifyAddress({ ip: "::ffff:7f00:1" }), "loopback"); // hex form of 127.0.0.1
    assert.equal(classifyAddress({ ip: "::ffff:c0a8:1" }), "private"); // hex form of 192.168.0.1
    assert.equal(classifyAddress({ ip: "::ffff:808:808" }), "public"); // hex form of 8.8.8.8
});
test("classifyAddress: IPv4-mapped IPv6 normalizes regardless of ::-compression, not just the two documented spellings", () => {
    // Same value (127.0.0.1 mapped), three different valid ways to write it: fully expanded with no
    // compression at all, fully expanded but with the low 32 bits still in dotted form, and the
    // ordinary compressed hex form already covered above. All three must agree.
    assert.equal(classifyAddress({ ip: "0:0:0:0:0:ffff:7f00:1" }), "loopback"); // fully expanded, hex tail
    assert.equal(classifyAddress({ ip: "0:0:0:0:0:ffff:127.0.0.1" }), "loopback"); // fully expanded, dotted tail
});
test("classifyAddress: a near-miss IPv6 literal that merely resembles a mapped address is NOT force-mapped", () => {
    // `::ffff:0:7f00:1` looks superficially like another spelling of `::ffff:7f00:1` (127.0.0.1
    // mapped), but per RFC 4291 group expansion it is a genuinely different 128-bit value: the
    // explicit "0" group after "ffff" pushes "ffff" itself to group index 4, not the index-5 position
    // the ::ffff:0:0/96 prefix requires. Blindly pattern-matching on the "::ffff:" substring would
    // wrongly force-map this to 127.0.0.1; the group-based parser must reject it and fall through to
    // ordinary (non-special) classification instead.
    assert.equal(classifyAddress({ ip: "::ffff:0:7f00:1" }), "public");
});
test("classifyAddress: IPv6 multicast ff00::/8 is treated as reserved (blocked), mirroring IPv4 multicast, exact boundaries", () => {
    assert.equal(classifyAddress({ ip: "feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff" }), "public"); // just below the block
    assert.equal(classifyAddress({ ip: "ff00::1" }), "reserved"); // first address of the block
    assert.equal(classifyAddress({ ip: "ff02::1" }), "reserved"); // all-nodes link-local multicast
    assert.equal(classifyAddress({ ip: "ffff::1" }), "reserved"); // last address of the block
});
test("classifyAddress: malformed IPv6-shaped input fails closed to reserved, never public", () => {
    assert.equal(classifyAddress({ ip: "gggg::1" }), "reserved"); // invalid hex digit
    assert.equal(classifyAddress({ ip: "fe80:::1" }), "reserved"); // malformed double "::"
    assert.equal(classifyAddress({ ip: "1:2:3:4:5:6:7:8:9" }), "reserved"); // too many groups
});
test("rejects/permits egress consistently with classifyAddress for a raw-IP CGNAT target", async () => {
    // End-to-end through resolvePinnedPeer (not just the classifier). CGNAT is private, so this must
    // be rejected pre-connect, same as any other private-range target below.
    const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "ok" }]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    await assert.rejects(() => client.send({ request: makeRequest({ url: "https://100.64.0.1/" }) }));
    assert.equal(transport.calls.length, 0, "transport must never be reached for a rejected target");
});
test("rejects a private/loopback/link-local target pre-connect for each address family", async () => {
    const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "" }]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    await assert.rejects(() => client.send({ request: makeRequest({ url: "https://127.0.0.1/" }) }));
    await assert.rejects(() => client.send({ request: makeRequest({ url: "https://10.0.0.1/" }) }));
    await assert.rejects(() => client.send({ request: makeRequest({ url: "https://169.254.169.254/" }) }));
    // WHATWG URL brackets a literal IPv6 hostname (`new URL("https://[::1]/").hostname === "[::1]"`).
    // Assert the EXACT classification message, not just "something threw" — before
    // `resolveHostAddresses` strips the brackets, `isIP("[::1]")` is 0, so this falls through to
    // `dns.lookup("[::1]", ...)` and rejects with ENOTFOUND, which `assert.rejects()` alone cannot
    // distinguish from a correctly-classified-and-blocked loopback address.
    await assert.rejects(() => client.send({ request: makeRequest({ url: "https://[::1]/" }) }), { message: "egress to '[::1]' (::1) rejected: resolved address is loopback" });
    assert.equal(transport.calls.length, 0, "transport must never be reached for a rejected target");
});
test("an address refusal keeps the resolved address in `message` but never in `callerSafeMessage`", async () => {
    // `localhost` resolves through the scripted resolver and is not an IP literal, so the host the
    // request named and the address it resolved to are different strings. A caller shown the address
    // could map internal DNS one request at a time — see `errors.ts`.
    const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "" }]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    const err = await client.send({ request: makeRequest({ url: "https://localhost/" }) }).then(() => null, (caught: unknown) => caught);
    assert.ok(err instanceof EgressRefusedError, String(err));
    assert.match(err.message, /^egress to 'localhost' \((127\.0\.0\.1|::1)\) rejected: resolved address is loopback$/);
    assert.equal(err.callerSafeMessage, "egress to 'localhost' rejected: resolved address is loopback");
    assert.equal(transport.calls.length, 0);
});
test("scheme and embedded-credential refusals carry the same text in both messages — neither names an address", async () => {
    const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "" }]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    for (const url of ["http://example.com/", "https://user:pass@example.com/"]) {
        const err = await client.send({ request: makeRequest({ url }) }).then(() => null, (caught: unknown) => caught);
        assert.ok(err instanceof EgressRefusedError, `${url}: ${String(err)}`);
        assert.equal(err.callerSafeMessage, err.message, url);
    }
});
test("an EgressRefusedError built without a callerSafeMessage says LESS, never more", () => {
    const err = new EgressRefusedError({ message: "egress to 'internal-db.corp' (10.0.4.7) rejected: resolved address is private" });
    assert.equal(err.callerSafeMessage, "egress to the requested host was refused by the outbound network policy");
    assert.ok(!err.callerSafeMessage.includes("10.0.4.7"));
});
test("rejects bracketed IPv6-literal link-local/private/multicast targets, correctly classified despite the URL's bracketed hostname", async () => {
    const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "" }]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    await assert.rejects(() => client.send({ request: makeRequest({ url: "https://[fe80::1]/" }) }), { message: "egress to '[fe80::1]' (fe80::1) rejected: resolved address is link-local" });
    await assert.rejects(() => client.send({ request: makeRequest({ url: "https://[fd00::1]/" }) }), { message: "egress to '[fd00::1]' (fd00::1) rejected: resolved address is private" });
    await assert.rejects(() => client.send({ request: makeRequest({ url: "https://[ff00::1]/" }) }), { message: "egress to '[ff00::1]' (ff00::1) rejected: resolved address is reserved" });
    assert.equal(transport.calls.length, 0, "transport must never be reached for a rejected target");
});
test("permits a public IPv6-literal target once the URL's bracketed hostname is stripped for classification (regression: every literal-IPv6 target, public or private, previously threw ENOTFOUND)", async () => {
    const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "ok" }]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    const response = await client.send({ request: makeRequest({ url: "https://[2001:4860:4860::8888]/" }) });
    assert.equal(response.bodyText, "ok");
    assert.equal(transport.calls.length, 1);
    // The pinned IP handed to the transport must be unbracketed — `net`/`tls` connect options
    // reject a bracket-wrapped literal.
    assert.equal(transport.calls[0]!.peer.ip, "2001:4860:4860::8888");
});
// -------------------------------------------------------------------------------------------
// TLS SNI must never name an IP literal (RFC 6066 §3: the `server_name` extension's HostName
// type is "not permitted to be an IP address"). A bracketed IPv6 literal is doubly wrong: it is
// both an IP literal AND carries syntax (`[`/`]`) no real certificate SAN ever contains.
// -------------------------------------------------------------------------------------------
test("TLS SNI is omitted for a public IPv6-literal target, not sent as the bracketed hostname", async () => {
    const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "ok" }]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    await client.send({ request: makeRequest({ url: "https://[2001:4860:4860::8888]/" }) });
    assert.equal(transport.calls.length, 1);
    assert.equal(transport.calls[0]!.peer.tlsServerName, undefined, "an IP-literal target must never be forwarded as the TLS SNI servername");
});
test("TLS SNI is also omitted for a public IPv4-literal target, not just IPv6", async () => {
    const transport = new ScriptedTransport([
        { status: 302, headers: { location: "https://8.8.8.8/next" }, bodyText: "" },
        { status: 200, headers: {}, bodyText: "final" },
    ]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    await client.send({ request: makeRequest({ url: "https://example.com/" }) });
    assert.equal(transport.calls.length, 2);
    assert.equal(transport.calls[1]!.peer.tlsServerName, undefined);
});
test("TLS SNI is still set to the target hostname for an ordinary (non-IP) hostname target", async () => {
    const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "ok" }]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    await client.send({ request: makeRequest({ url: "https://example.com/" }) });
    assert.equal(transport.calls[0]!.peer.tlsServerName, "example.com");
});
test("devHostAllowlist permits an otherwise-private target for that exact host", async () => {
    const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "ok" }]);
    const client = createHttpClient({ ...{
            transport,
            policy: makePolicy({ devHostAllowlist: ["127.0.0.1"] }),
        }, dns, clock, userAgent: "Fixture/1.0" });
    const response = await client.send({ request: makeRequest({ url: "https://127.0.0.1/" }) });
    assert.equal(response.bodyText, "ok");
    assert.equal(transport.calls.length, 1);
    for (const url of ["https://10.0.0.1/", "https://169.254.169.254/"]) {
        await assert.rejects(() => client.send({ request: makeRequest({ url }) }), EgressRefusedError);
    }
    assert.equal(transport.calls.length, 1, "non-allowlisted private hosts never reach the transport");
});
test("devHostAllowlist matches an IPv6-literal target by its unbracketed form (the bracket is a URL-syntax artifact, not part of the host)", async () => {
    // WHATWG URL brackets a literal IPv6 hostname (`url.hostname === "[fd00::1]"`), but an allowlist
    // entry is written the way a human/operator would type the address: unbracketed. Comparing the
    // raw bracketed hostname against an unbracketed allowlist entry can never match.
    const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "ok" }]);
    const client = createHttpClient({ ...{
            transport,
            policy: makePolicy({ devHostAllowlist: ["fd00::1"] }),
        }, dns, clock, userAgent: "Fixture/1.0" });
    const response = await client.send({ request: makeRequest({ url: "https://[fd00::1]/" }) });
    assert.equal(response.bodyText, "ok");
    assert.equal(transport.calls.length, 1);
});
test("a cross-origin redirect strips auth headers and is re-verified against policy", async () => {
    const transport = new ScriptedTransport([
        { status: 302, headers: { location: "https://169.254.169.254/steal" }, bodyText: "" },
    ]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    await assert.rejects(() => client.send({ request: makeRequest({
            url: "https://example.com/",
            headers: { Authorization: "Bearer secret" },
        }) }), /rejected/);
});
test("a cross-origin redirect to an allowed host strips Authorization/Cookie before following", async () => {
    const transport = new ScriptedTransport([
        { status: 302, headers: { location: "https://8.8.8.8/next" }, bodyText: "" },
        { status: 200, headers: {}, bodyText: "final" },
    ]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    const response = await client.send({ request: makeRequest({
            url: "https://example.com/",
            headers: { Authorization: "Bearer secret", AUTHORIZATION: "Bearer uppercase", Cookie: "session=secret", cookie: "other=secret", "X-Kept": "yes" },
        }) });
    assert.equal(response.bodyText, "final");
    assert.equal(transport.calls.length, 2);
    assert.equal(transport.calls[1]!.req.headers.Authorization, undefined);
    assert.equal(transport.calls[1]!.req.headers.AUTHORIZATION, undefined);
    assert.equal(transport.calls[1]!.req.headers.Cookie, undefined);
    assert.equal(transport.calls[1]!.req.headers.cookie, undefined);
    assert.equal(transport.calls[1]!.req.headers["X-Kept"], "yes");
});
test("stops following redirects once maxRedirects is exhausted", async () => {
    const transport = new ScriptedTransport([
        { status: 302, headers: { location: "https://8.8.8.8/1" }, bodyText: "" },
    ]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy({ maxRedirects: 0 }) }, dns, clock, userAgent: "Fixture/1.0" });
    const response = await client.send({ request: makeRequest({ url: "https://example.com/" }) });
    assert.equal(response.status, 302);
    assert.equal(transport.calls.length, 1);
});
// 2026-09-10 (`custom_credential_make_request` redirect-diagnosability fix): a shared
// `HttpClientPort` instance backs GET/POST/PUT/PATCH/DELETE alike, so raising a policy's
// `maxRedirects` for a "GET may need to follow a signed redirect" reason must not also let a
// mutating method auto-replay its body against a redirect target. This is enforced here, once,
// regardless of the policy — see `sendWithPolicy`'s own `canFollowRedirect` doc.
for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
    test(`does not follow a redirect for ${method}, even when the policy otherwise allows it`, async () => {
        const transport = new ScriptedTransport([
            { status: 302, headers: { location: "https://8.8.8.8/next" }, bodyText: "" },
        ]);
        const client = createHttpClient({ ...{ transport, policy: makePolicy({ maxRedirects: 3 }) }, dns, clock, userAgent: "Fixture/1.0" });
        const response = await client.send({ request: makeRequest({ method, url: "https://example.com/" }) });
        assert.equal(response.status, 302, "the raw 3xx is returned, exactly as if maxRedirects were 0");
        assert.equal(response.headers.location, "https://8.8.8.8/next");
        assert.equal(transport.calls.length, 1, "the redirect target must never be contacted for this method");
    });
}
test("still follows a redirect for GET when the policy allows it (sanity check against the method gate above)", async () => {
    const transport = new ScriptedTransport([
        { status: 302, headers: { location: "https://8.8.8.8/next" }, bodyText: "" },
        { status: 200, headers: {}, bodyText: "final" },
    ]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy({ maxRedirects: 3 }) }, dns, clock, userAgent: "Fixture/1.0" });
    const response = await client.send({ request: makeRequest({ method: "GET", url: "https://example.com/" }) });
    assert.equal(response.status, 200);
    assert.equal(response.bodyText, "final");
    assert.equal(transport.calls.length, 2);
});
test("response body is truncated to the smaller of maxResponseBytes/maxDecompressedBytes", async () => {
    const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "0123456789" }]);
    const client = createHttpClient({ ...{
            transport,
            policy: makePolicy({ maxResponseBytes: 4, maxDecompressedBytes: 100 }),
        }, dns, clock, userAgent: "Fixture/1.0" });
    const response = await client.send({ request: makeRequest({ url: "https://example.com/" }) });
    assert.equal(response.bodyText, "0123");
});
test("connectTimeoutMs caps a caller-supplied timeout that exceeds it", async () => {
    const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "ok" }]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy({ connectTimeoutMs: 500 }) }, dns, clock, userAgent: "Fixture/1.0" });
    await client.send({ request: makeRequest({ url: "https://example.com/", timeoutMs: 60000 }) });
    assert.equal(transport.calls[0]!.req.timeoutMs, 500);
});
test("rejects a scheme not in the policy's allowedSchemes", async () => {
    const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "" }]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy({ allowedSchemes: ["https"] }) }, dns, clock, userAgent: "Fixture/1.0" });
    await assert.rejects(() => client.send({ request: makeRequest({ url: "http://example.com/" }) }));
});
test("rejects a target URL carrying embedded credentials", async () => {
    const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "" }]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    await assert.rejects(() => client.send({ request: makeRequest({ url: "https://user:pass@example.com/" }) }));
});
// -------------------------------------------------------------------------------------------
// Default User-Agent (2026-09-03) — GitHub rejects every request with no `User-Agent` header
// with a bare 403; this seam is the ONE place a default is added so every consumer (custom
// credentials, the Resend mailer, comment spam checks, webhook delivery, deploy/lipay plugins)
// gets one automatically. See `features/custom-credentials/credentialed-request.ts`'s header,
// "Authentication-failure diagnostics" / "401 vs 403", for the live incident this fixes.
// -------------------------------------------------------------------------------------------
test("adds a non-empty default User-Agent when the caller sends none", async () => {
    const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "ok" }]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    await client.send({ request: makeRequest({ url: "https://example.com/", headers: {} }) });
    const sentHeaders = transport.calls[0]!.req.headers;
    assert.ok(sentHeaders["User-Agent"], "expected a non-empty User-Agent to be added");
    assert.equal(typeof sentHeaders["User-Agent"], "string");
});
test("never overrides a caller-supplied User-Agent, regardless of header-name casing", async () => {
    const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "ok" }]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    await client.send({ request: makeRequest({ url: "https://example.com/", headers: { "user-agent": "MyOwnClient/2.0" } }) });
    const sentHeaders = transport.calls[0]!.req.headers;
    assert.equal(sentHeaders["user-agent"], "MyOwnClient/2.0");
    assert.equal(sentHeaders["User-Agent"], undefined, "must not add a second, differently-cased header");
});
test("the default User-Agent survives a cross-origin redirect (not a sensitive header)", async () => {
    const transport = new ScriptedTransport([
        { status: 302, headers: { location: "https://8.8.8.8/next" }, bodyText: "" },
        { status: 200, headers: {}, bodyText: "final" },
    ]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    await client.send({ request: makeRequest({ url: "https://example.com/", headers: {} }) });
    assert.equal(transport.calls.length, 2);
    assert.ok(transport.calls[0]!.req.headers["User-Agent"]);
    assert.equal(transport.calls[1]!.req.headers["User-Agent"], transport.calls[0]!.req.headers["User-Agent"]);
});
// -------------------------------------------------------------------------------------------
// MI-02 (2026-09-06): `HttpResponse` carried no URL, so a caller following a redirect had no way
// to learn which hop actually served the bytes. `features/media-import` records that URL as an
// imported asset's provenance and derives the stored filename from it, and was recording the URL
// the assistant asked for instead. `finalUrl` is the hop that answered — every one of these hops
// has already been through the full per-hop guard (scheme, DNS, address class, re-pinning).
// -------------------------------------------------------------------------------------------
test("finalUrl names the hop that actually served the bytes, not the URL the caller asked for", async () => {
    const transport = new ScriptedTransport([
        { status: 302, headers: { location: "https://1.1.1.1/signed/final.png" }, bodyText: "" },
        { status: 200, headers: {}, bodyText: "the image" },
    ]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    const response = await client.send({ request: makeRequest({ url: "https://8.8.8.8/start.png" }) });
    assert.equal(response.status, 200);
    assert.equal(response.bodyText, "the image", "sanity: this is the redirected response, not the 302");
    assert.equal(response.finalUrl, "https://1.1.1.1/signed/final.png", "recording the requested URL here is the whole defect");
    assert.equal(transport.calls.length, 2);
});
test("finalUrl survives more than one hop — it is the LAST URL, not the second one", async () => {
    const transport = new ScriptedTransport([
        { status: 302, headers: { location: "https://1.1.1.1/hop2" }, bodyText: "" },
        { status: 302, headers: { location: "https://8.8.4.4/hop3.png" }, bodyText: "" },
        { status: 200, headers: {}, bodyText: "the image" },
    ]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    const response = await client.send({ request: makeRequest({ url: "https://8.8.8.8/hop1" }) });
    assert.equal(transport.calls.length, 3, "sanity: all three hops were made, so 'last' is a meaningful claim");
    assert.equal(response.finalUrl, "https://8.8.4.4/hop3.png");
});
test("finalUrl on a response with no redirect at all is the requested URL, so a consumer never has to special-case its absence", async () => {
    const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "ok" }]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    const response = await client.send({ request: makeRequest({ url: "https://8.8.8.8/only.png" }) });
    assert.equal(response.finalUrl, "https://8.8.8.8/only.png");
});
test("a redirect that was NOT followed reports the hop that returned the 3xx, never the Location it pointed at", async () => {
    const transport = new ScriptedTransport([{ status: 302, headers: { location: "https://1.1.1.1/never-fetched" }, bodyText: "" }]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy({ maxRedirects: 0 }) }, dns, clock, userAgent: "Fixture/1.0" });
    const response = await client.send({ request: makeRequest({ url: "https://8.8.8.8/start" }) });
    assert.equal(response.status, 302);
    assert.equal(transport.calls.length, 1);
    assert.equal(response.finalUrl, "https://8.8.8.8/start", "the bytes in hand came from the URL that answered; naming an unfetched Location as their source would be a fabricated provenance");
});
test("a 3xx with no Location header reports its own URL rather than stalling on an absent hop", async () => {
    const transport = new ScriptedTransport([{ status: 302, headers: {}, bodyText: "" }]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    const response = await client.send({ request: makeRequest({ url: "https://8.8.8.8/no-location" }) });
    assert.equal(response.finalUrl, "https://8.8.8.8/no-location");
});
// -------------------------------------------------------------------------------------------
// Refusals are a distinguishable TYPE, not a message string (2026-09-07, SEC-05)
//
// Every assertion in this block is about `instanceof EgressRefusedError`, not about the message.
// The messages themselves are already asserted verbatim above; what these add is the property a
// consumer at a tool or HTTP boundary actually needs, and the one the block below proves the
// absence of: that a policy REFUSAL can be told apart from a transport failure without parsing
// prose. `features/media-import/tool-registrations.ts` reported every SSRF block as a redacted
// `INTERNAL_ERROR` for exactly as long as this type did not exist.
// -------------------------------------------------------------------------------------------
test("a private-address refusal is an EgressRefusedError, recognisable by type and not merely by message", async () => {
    const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "" }]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    const error = await client.send({ request: makeRequest({ url: "https://169.254.169.254/latest/meta-data/" }) }).then(() => null, (e: unknown) => e);
    assert.ok(error instanceof EgressRefusedError, `expected EgressRefusedError, got ${(error as Error)?.constructor?.name}`);
    assert.equal(error.message, "egress to '169.254.169.254' (169.254.169.254) rejected: resolved address is link-local", "the reason must survive the typing — a typed error with a blanked message would be the same defect in a new shape");
    assert.equal(transport.calls.length, 0);
});
test("a disallowed-scheme refusal is an EgressRefusedError", async () => {
    const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "" }]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy({ allowedSchemes: ["https"] }) }, dns, clock, userAgent: "Fixture/1.0" });
    const error = await client.send({ request: makeRequest({ url: "http://example.com/" }) }).then(() => null, (e: unknown) => e);
    assert.ok(error instanceof EgressRefusedError, `expected EgressRefusedError, got ${(error as Error)?.constructor?.name}`);
    assert.equal(error.message, "scheme 'http:' is not in the allowed egress schemes");
});
test("an embedded-credentials refusal is an EgressRefusedError", async () => {
    const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "" }]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    const error = await client.send({ request: makeRequest({ url: "https://user:pass@example.com/" }) }).then(() => null, (e: unknown) => e);
    assert.ok(error instanceof EgressRefusedError, `expected EgressRefusedError, got ${(error as Error)?.constructor?.name}`);
    assert.equal(error.message, "credentials embedded in the target URL are not allowed");
});
test("a refusal on a REDIRECT hop is typed too — the re-verification arm is not a second, untyped code path", async () => {
    const transport = new ScriptedTransport([
        { status: 302, headers: { location: "https://169.254.169.254/steal" }, bodyText: "" },
    ]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    const error = await client.send({ request: makeRequest({ url: "https://8.8.8.8/start" }) }).then(() => null, (e: unknown) => e);
    assert.ok(error instanceof EgressRefusedError, `expected EgressRefusedError, got ${(error as Error)?.constructor?.name}`);
    assert.match(error.message, /resolved address is link-local/);
});
// Owner decision 2026-10-03: a `redirect: "error"` refusal is a policy decision like the others,
// so callers and the model see one kind of refusal. The Location target is never transported.
test("a redirect refused by redirect:error is an EgressRefusedError, and the Location target is never contacted", async () => {
    const transport = new ScriptedTransport([
        { status: 302, headers: { location: "https://169.254.169.254/steal" }, bodyText: "" },
    ]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    const error = await client.send({ request: makeRequest({ url: "https://example.com/start" }) }, { redirect: "error" }).then(() => null, (e: unknown) => e);
    assert.ok(error instanceof EgressRefusedError, `expected EgressRefusedError, got ${(error as Error)?.constructor?.name}`);
    assert.equal(error.message, "redirect response refused by the request's redirect policy");
    assert.equal(error.callerSafeMessage, "redirect response refused by the request's redirect policy");
    assert.deepEqual(transport.calls.map((call) => call.req.url), ["https://example.com/start"]);
});
test("a DNS failure is NOT an EgressRefusedError — the type must mean 'this process refused', not 'the request did not succeed'", async () => {
    const transport = new ScriptedTransport([{ status: 200, headers: {}, bodyText: "" }]);
    const client = createHttpClient({ ...{ transport, policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    // The resolver throws a scripted lookup failure, rather than consulting the host's DNS.
    const error = await client.send({ request: makeRequest({ url: "https://nonexistent-host.invalid/" }) }).then(() => null, (e: unknown) => e);
    assert.ok(error instanceof Error);
    assert.equal(error, dnsFailure);
    assert.equal(error instanceof EgressRefusedError, false, `a DNS failure must not be typed as a refusal (got ${(error as Error).message})`);
});
