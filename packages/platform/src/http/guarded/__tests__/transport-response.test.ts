import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ClientRequest } from "node:http";
import type { RequestOptions } from "node:https";
import { PassThrough } from "node:stream";
import { test, vi, afterEach } from "vitest";
afterEach(() => vi.restoreAllMocks());
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import type { HttpRequest } from "@jini-ai/core/primitives";
import type { PinnedPeer } from "../types.js";
test("production transport response, request-body and failure contracts", async (t) => {
    async function subcase(_name: string, run: () => void | Promise<void>) { await run(); }
    // F2.6/F3.4: fake only Node's socket boundary; real transport and real zlib decoders run.
    let scenario: {
        chunks: Buffer[];
        headers: IncomingMessage["headers"];
        status?: number;
        timeout?: boolean;
        requestError?: Error;
    };
    const calls: Array<{
        secure: boolean;
        options: RequestOptions;
        writes: string[];
        ended: boolean;
        destroyed?: Error | undefined;
    }> = [];
    const request = (secure: boolean) => (options: RequestOptions, callback: (res: IncomingMessage) => void) => {
        const call = { secure, options, writes: [] as string[], ended: false, destroyed: undefined as Error | undefined };
        calls.push(call);
        const req = new EventEmitter() as ClientRequest;
        req.write = ((body: string) => { call.writes.push(body); return true; }) as ClientRequest["write"];
        req.destroy = (error) => {
            call.destroyed = error;
            if (error)
                req.emit("error", error);
            return req;
        };
        req.end = (() => {
            call.ended = true;
            queueMicrotask(() => {
                if (scenario.timeout) {
                    req.emit("timeout");
                    return;
                }
                if (scenario.requestError) {
                    req.emit("error", scenario.requestError);
                    return;
                }
                const res = new PassThrough() as PassThrough & IncomingMessage;
                res.headers = scenario.headers;
                res.statusCode = scenario.status;
                callback(res);
                for (const chunk of scenario.chunks)
                    res.write(chunk);
                res.end();
            });
            return req;
        }) as ClientRequest["end"];
        return req;
    };
    vi.doMock("node:http", () => ({ request: request(false) }));
    vi.doMock("node:https", () => ({ request: request(true) }));
    const { FetchHttpTransportAdapter } = await import("../transport.fetch.js");
    const transport = new FetchHttpTransportAdapter({});
    const req: HttpRequest = {
        method: "POST", url: "https://provider.example:8443/send?mode=raw", headers: { "X-Kept": "yes", host: "wrong.example" },
        body: "exact signed body", timeoutMs: 321,
    };
    const peer: PinnedPeer = { ip: "8.8.4.4", port: 8443, authority: "provider.example:8443", tlsServerName: "provider.example" };
    const payload = Buffer.from([0x00, 0xff, 0xc3, 0xa9, 0x41]);
    await subcase("plain responses preserve binary bytes, status, flattened headers and the exact signed request", async () => {
        scenario = { chunks: [payload.subarray(0, 2), payload.subarray(2)], status: 201,
            headers: { "x-multi": ["first", "second"], "x-single": "value", "x-absent": undefined } };
        const response = await transport.requestPinned({ request: req, peer: peer });
        assert.equal(response.status, 201);
        assert.deepEqual(response.headers, { "x-multi": "first, second", "x-single": "value" });
        assert.deepEqual([...response.bodyBytes!], [0, 255, 195, 169, 65]);
        assert.equal(response.bodyText, "\u0000�éA");
        assert.deepEqual(calls.at(-1), { secure: true, options: {
                method: "POST", host: "8.8.4.4", port: 8443, path: "/send?mode=raw",
                headers: { "X-Kept": "yes", host: "provider.example:8443" }, timeout: 321, servername: "provider.example",
            }, writes: ["exact signed body"], ended: true, destroyed: undefined });
    });
    const { body: _body, ...withoutBody } = req;
    for (const [encoding, compress] of [["gzip", gzipSync], ["deflate", deflateSync], ["br", brotliCompressSync]] as const) {
        await subcase(`${encoding} responses yield decompressed bytes and UTF-8 text`, async () => {
            const compressed = compress(payload);
            scenario = { chunks: [compressed.subarray(0, 3), compressed.subarray(3)], status: 202,
                headers: { "content-encoding": encoding } };
            const response = await transport.requestPinned({ request: withoutBody, peer: peer });
            assert.deepEqual([...response.bodyBytes!], [0, 255, 195, 169, 65]);
            assert.equal(response.bodyText, "\u0000�éA");
            assert.equal(response.status, 202);
            assert.deepEqual(calls.at(-1)!.writes, []);
        });
    }
    await subcase("HTTPS IP literals omit the SNI option entirely", async () => {
        scenario = { chunks: [], headers: {} };
        const response = await transport.requestPinned({ request: { ...req, url: "https://8.8.4.4/send", body: "" }, peer: { ...peer, authority: "8.8.4.4", tlsServerName: undefined } });
        assert.equal(Object.hasOwn(calls.at(-1)!.options, "servername"), false);
        assert.deepEqual(calls.at(-1)!.writes, [""]);
        assert.equal(response.status, 0);
        assert.equal(response.bodyText, "");
        assert.deepEqual([...response.bodyBytes!], []);
    });
    await subcase("HTTP uses the insecure request function and never sends SNI", async () => {
        scenario = { chunks: [Buffer.from("http reply")], status: 200, headers: {} };
        const response = await transport.requestPinned({ request: { ...req, url: "http://provider.example/send?x=1" }, peer: peer });
        assert.equal(response.bodyText, "http reply");
        assert.equal(calls.at(-1)!.secure, false);
        assert.equal(Object.hasOwn(calls.at(-1)!.options, "servername"), false);
        assert.equal(calls.at(-1)!.options.path, "/send?x=1");
    });
    // F6.2/F7.1: drive the registered timeout event without sleeping; rejection proves destruction.
    await subcase("timeout destroys the request and rejects with its per-attempt deadline", async () => {
        scenario = { chunks: [], headers: {}, timeout: true };
        await assert.rejects(transport.requestPinned({ request: req, peer: peer }), { message: "request timed out after 321ms" });
        assert.equal(calls.at(-1)!.destroyed?.message, "request timed out after 321ms");
    });
    await subcase("connection errors propagate and a subsequent call still succeeds", async () => {
        const failure = new Error("fixture connection reset");
        scenario = { chunks: [], headers: {}, requestError: failure };
        await assert.rejects(transport.requestPinned({ request: req, peer: peer }), (error) => error === failure);
        scenario = { chunks: [Buffer.from("recovered")], status: 200, headers: {} };
        assert.equal((await transport.requestPinned({ request: req, peer: peer })).bodyText, "recovered");
    });
    await subcase("invalid compressed data rejects instead of returning corrupt bytes", async () => {
        scenario = { chunks: [Buffer.from("not a gzip stream")], headers: { "content-encoding": "gzip" } };
        await assert.rejects(transport.requestPinned({ request: req, peer: peer }), { code: "Z_DATA_ERROR" });
    });
    await subcase("the absolute ceiling stops a response whose aggregate chunks exceed 100 MiB", async () => {
        const chunk = Buffer.alloc(51 * 1024 * 1024, 120);
        scenario = { chunks: [chunk, chunk], headers: {} };
        await assert.rejects(transport.requestPinned({ request: req, peer: peer }), { message: "response exceeded the absolute size ceiling" });
        assert.equal(calls.at(-1)!.destroyed?.message, "response exceeded the absolute size ceiling");
    });
    await subcase("the absolute ceiling also stops gzip expansion beyond 100 MiB", async () => {
        const compressed = gzipSync(Buffer.alloc(100 * 1024 * 1024 + 1, 120));
        assert.ok(compressed.length < 1024 * 1024, "the wire body itself is well below the ceiling");
        scenario = { chunks: [compressed], headers: { "content-encoding": "gzip" } };
        await assert.rejects(transport.requestPinned({ request: req, peer: peer }), { message: "response exceeded the absolute size ceiling" });
        assert.equal(calls.at(-1)!.destroyed?.message, "response exceeded the absolute size ceiling");
    });
});
