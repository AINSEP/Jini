import assert from "node:assert/strict";
import { test, vi, afterEach } from "vitest";
afterEach(() => vi.restoreAllMocks());
import { createHttpClient } from "../client.js";
import type { HttpRequest, HttpResponse } from "@jini-ai/core/primitives";
import type { EgressPolicy, HttpTransportAdapter, PinnedPeer } from "../ports.js";
/**
 * @file `HttpResponse.bodyBytes`/`bodyTruncated` — the byte-capable half of the guarded client,
 * added 2026-09-06 so `features/media-import` can fetch an image WITHOUT reaching past the 
 * SSRF guard to a raw `fetch`.
 *
 * The whole justification for the field is a contrast, so this file asserts the contrast directly
 * rather than only the happy half: for one and the same response body — a byte sequence that is
 * deliberately INVALID UTF-8 — `bodyBytes` comes back identical to what the transport produced,
 * while `bodyText` comes back mangled into U+FFFD replacement characters and is not recoverable.
 * A test that only checked "bodyBytes is defined" would pass just as happily against an
 * implementation that derived it from `bodyText`, which is precisely the bug worth preventing.
 *
 * An IP-literal target is used throughout (`8.8.8.8`, classified `public`) so no test here depends
 * on DNS: `client.ts`'s `resolveHostAddresses` short-circuits a literal address without a lookup.
 * See docs/decisions/DR-002-guarded-egress.md.
 */
/** PNG magic bytes followed by `0xFF 0xFE 0x00` — `0xFF` and `0xFE` are not legal UTF-8 lead bytes
 *  in any position, so a `toString("utf8")` round trip cannot reproduce this sequence. */
const INVALID_UTF8_BODY = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00]);
const dns = { async resolve() { throw new Error("literal target must not resolve DNS"); } };
const clock = { nowMs: () => Date.now(), timeoutSignal: ({ timeoutMs }: {
        timeoutMs: number;
    }) => AbortSignal.timeout(timeoutMs) };
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
/** Mirrors what `transport.fetch.ts` actually does: ONE `Buffer.concat`, returned in both shapes. */
class BinaryTransport implements HttpTransportAdapter {
    constructor(private readonly bytes: Uint8Array) { }
    async requestPinned({ request: _req, peer: _peer }: { request: HttpRequest; peer: PinnedPeer }): Promise<HttpResponse> {
        const body = Buffer.from(this.bytes);
        return { status: 200, headers: { "content-type": "image/png" }, bodyText: body.toString("utf8"), bodyBytes: body };
    }
}
/** A transport predating `bodyBytes` — the shape every hand-written double in the repo still has. */
class LegacyTextTransport implements HttpTransportAdapter {
    async requestPinned({ request: _req, peer: _peer }: { request: HttpRequest; peer: PinnedPeer }): Promise<HttpResponse> {
        return { status: 200, headers: {}, bodyText: "plain text body" };
    }
}
function request(): HttpRequest {
    return { method: "GET", url: "https://8.8.8.8/image.png", headers: {}, timeoutMs: 1000 };
}
test("bodyBytes survives createHttpClient uncorrupted for a body that is invalid UTF-8", async () => {
    const client = createHttpClient({ ...{ transport: new BinaryTransport(INVALID_UTF8_BODY), policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    const response = await client.send({ request: request() });
    assert.ok(response.bodyBytes, "the production transport always populates bodyBytes; the policy layer must not drop it");
    assert.deepStrictEqual(Array.from(response.bodyBytes), Array.from(INVALID_UTF8_BODY));
});
test("bodyText for that SAME body is lossy — this contrast is the entire reason bodyBytes exists", async () => {
    const client = createHttpClient({ ...{ transport: new BinaryTransport(INVALID_UTF8_BODY), policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    const response = await client.send({ request: request() });
    const viaText = Array.from(Buffer.from(response.bodyText, "utf8"));
    assert.notDeepStrictEqual(viaText, Array.from(INVALID_UTF8_BODY), "if bodyText were lossless here, the added field would be unnecessary");
    assert.ok(response.bodyText.includes("�"), `expected replacement characters in the lossy decode, got ${JSON.stringify(response.bodyText)}`);
    assert.ok(viaText.length !== INVALID_UTF8_BODY.length || !viaText.every((b, i) => b === INVALID_UTF8_BODY[i]));
});
test("an untruncated response reports bodyTruncated:false — the flag is a real answer, not merely absent", async () => {
    const client = createHttpClient({ ...{ transport: new BinaryTransport(INVALID_UTF8_BODY), policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    assert.equal((await client.send({ request: request() })).bodyTruncated, false);
});
test("a body over the policy cap is clipped in BOTH shapes and flagged bodyTruncated:true", async () => {
    const big = Uint8Array.from({ length: 64 }, (_, index) => (index % 2 === 0 ? 0xff : 0x41));
    const client = createHttpClient({ ...{ transport: new BinaryTransport(big), policy: makePolicy({ maxResponseBytes: 16, maxDecompressedBytes: 16 }) }, dns, clock, userAgent: "Fixture/1.0" });
    const response = await client.send({ request: request() });
    assert.equal(response.bodyTruncated, true, "silent truncation is the failure mode this flag exists to make loud");
    assert.ok(response.bodyBytes);
    assert.equal(response.bodyBytes.byteLength, 16, "the byte half must be clipped to the effective cap");
    assert.deepStrictEqual(Array.from(response.bodyBytes), Array.from(big.subarray(0, 16)));
});
test("the tighter of maxResponseBytes/maxDecompressedBytes wins for the byte half too", async () => {
    const big = Uint8Array.from({ length: 64 }, () => 0xff);
    const client = createHttpClient({ ...{ transport: new BinaryTransport(big), policy: makePolicy({ maxResponseBytes: 40, maxDecompressedBytes: 8 }) }, dns, clock, userAgent: "Fixture/1.0" });
    const response = await client.send({ request: request() });
    assert.equal(response.bodyBytes?.byteLength, 8);
    assert.equal(response.bodyTruncated, true);
});
test("a transport that reports its own truncation keeps that flag set even when the body is under the cap", async () => {
    class SelfReportingTransport implements HttpTransportAdapter {
        async requestPinned(): Promise<HttpResponse> {
            return { status: 200, headers: {}, bodyText: "abc", bodyBytes: Uint8Array.from([1, 2, 3]), bodyTruncated: true };
        }
    }
    const client = createHttpClient({ ...{ transport: new SelfReportingTransport(), policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    assert.equal((await client.send({ request: request() })).bodyTruncated, true, "the cap layer must never downgrade a truncation the producer already reported");
});
test("a legacy transport that returns no bodyBytes still works — the field is additive, and absence is not fabricated into a value", async () => {
    const client = createHttpClient({ ...{ transport: new LegacyTextTransport(), policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    const response = await client.send({ request: request() });
    assert.equal(response.bodyText, "plain text body", "every pre-existing text consumer is unchanged");
    assert.equal(response.bodyBytes, undefined, "bodyBytes must not be back-filled from bodyText — a consumer needing real bytes has to be able to tell it did not get them");
    assert.equal(response.bodyTruncated, false);
});
// ---------------------------------------------------------------------------------------------
// MI-01 (2026-09-06): `bodyTruncated` was the OR of the text half and the byte half, and
// `features/media-import` — a consumer that never reads `bodyText` at all — refused an import on
// it. A lossy UTF-8 decode of compressed image data is ~1.8x the size of the bytes it came from,
// so every complete PNG/JPEG from roughly 6.94 MiB up to the feature's own 50 MiB accept limit
// tripped the 12 MiB policy cap on its TEXT half alone and was rejected as "exceeds the import
// limit". The byte half now carries its own flag; the OR stays, so no text consumer changes.
// ---------------------------------------------------------------------------------------------
test("a body whose LOSSY TEXT decode blows the cap while its raw bytes fit whole reports bodyBytesTruncated:false — nothing was clipped from the bytes, and a binary consumer must not be told otherwise", async () => {
    // 0xFF is not a legal UTF-8 lead byte in any position, so each one decodes to U+FFFD and
    // re-encodes to THREE bytes: 24 raw bytes become 72 text bytes. Under a 32-byte cap the bytes
    // fit whole and the text does not — the same shape a 7 MiB PNG has against the real 12 MiB
    // MEDIA_IMPORT_EGRESS_POLICY cap, in miniature.
    const bytes = Uint8Array.from({ length: 24 }, () => 0xff);
    const client = createHttpClient({ ...{
            transport: new BinaryTransport(bytes),
            policy: makePolicy({ maxResponseBytes: 32, maxDecompressedBytes: 32 }),
        }, dns, clock, userAgent: "Fixture/1.0" });
    const response = await client.send({ request: request() });
    assert.equal(Buffer.from(bytes).toString("utf8").length, 24, "sanity: 24 invalid bytes decode to 24 replacement characters");
    assert.equal(Buffer.from(Buffer.from(bytes).toString("utf8"), "utf8").byteLength, 72, "sanity: those re-encode to 72 bytes, over the 32-byte cap — without this the test proves nothing");
    assert.equal(response.bodyBytesTruncated, false, "the byte half was never clipped; reporting it as truncated is what falsely rejected complete images");
    assert.ok(response.bodyBytes);
    assert.equal(response.bodyBytes.byteLength, 24, "every byte is still there");
    assert.deepStrictEqual(Array.from(response.bodyBytes), Array.from(bytes), "and they are the SAME bytes, not a re-encoding");
    assert.equal(response.bodyTruncated, true, "the TEXT half really was clipped — that must stay observable, this fix removes no signal");
    // Asserted in CHARACTERS, not re-encoded bytes: `capBody` clips the pre-cap encoding to the cap,
    // and a 3-byte U+FFFD split across that boundary decodes into further replacement characters, so
    // the capped string can re-encode a few bytes over 32. What matters is that content was lost.
    assert.ok(response.bodyText.length < 24, `the text half must genuinely have lost content, or bodyTruncated:true here is decorative — got ${response.bodyText.length} of 24 characters`);
});
test("when the BYTES are the half that got clipped, bodyBytesTruncated is true — the new flag is a real answer, not a constant false", async () => {
    const big = Uint8Array.from({ length: 64 }, (_, index) => (index % 2 === 0 ? 0xff : 0x41));
    const client = createHttpClient({ ...{
            transport: new BinaryTransport(big),
            policy: makePolicy({ maxResponseBytes: 16, maxDecompressedBytes: 16 }),
        }, dns, clock, userAgent: "Fixture/1.0" });
    const response = await client.send({ request: request() });
    assert.equal(response.bodyBytesTruncated, true, "16 of 64 bytes is a corrupt file, and the byte consumer has to be able to see that");
    assert.equal(response.bodyTruncated, true, "the shared flag still reports it too");
    assert.equal(response.bodyBytes?.byteLength, 16);
});
test("an untruncated response reports bodyBytesTruncated:false, so absence never has to be interpreted", async () => {
    const client = createHttpClient({ ...{ transport: new BinaryTransport(INVALID_UTF8_BODY), policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    assert.equal((await client.send({ request: request() })).bodyBytesTruncated, false);
});
test("a producer reporting only the coarse bodyTruncated is NOT downgraded to bodyBytesTruncated:false — a truncation report that names no shape has to count against both halves", async () => {
    class SelfReportingTransport implements HttpTransportAdapter {
        async requestPinned(): Promise<HttpResponse> {
            return { status: 200, headers: {}, bodyText: "abc", bodyBytes: Uint8Array.from([1, 2, 3]), bodyTruncated: true };
        }
    }
    const client = createHttpClient({ ...{ transport: new SelfReportingTransport(), policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    const response = await client.send({ request: request() });
    assert.equal(response.bodyBytesTruncated, true, "splitting the flag must not turn an existing 'this body is incomplete' into 'the bytes are fine'");
    assert.equal(response.bodyTruncated, true);
});
test("a legacy transport that returns no bodyBytes gets no fabricated bodyBytesTruncated either — there is no byte half to report on", async () => {
    const client = createHttpClient({ ...{ transport: new LegacyTextTransport(), policy: makePolicy() }, dns, clock, userAgent: "Fixture/1.0" });
    const response = await client.send({ request: request() });
    assert.equal(response.bodyBytes, undefined);
    assert.equal(response.bodyBytesTruncated, undefined, "a flag about bytes that do not exist would be an invented answer");
});
