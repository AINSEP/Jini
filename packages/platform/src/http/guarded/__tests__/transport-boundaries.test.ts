import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import { PassThrough } from "node:stream";
import { afterEach, test, vi } from "vitest";
import { gzipSync } from "node:zlib";
import type { HttpRequest } from "@jini-ai/core/primitives";

afterEach(() => {
  vi.doUnmock("node:https");
  vi.resetModules();
});

// F2.6/F3.4: only the native socket boundary is replaced; buffering and zlib stay real.
test("native transport response boundaries", async () => {
  async function subcase(_name: string, run: () => Promise<void>) {
    await run();
  }
  let chunks: Buffer[] = [];
  let headers: IncomingMessage["headers"] = {};
  let response: PassThrough;
  let destroyed = false;
  let expected: RequestOptions;
  let calls = 0;
  vi.doMock("node:https", () => ({
    request(options: RequestOptions, callback: (res: IncomingMessage) => void) {
      // F2.5/F3.6: wrong IP, authority, timeout, signal or method cannot get a response.
      assert.deepEqual(options, expected);
      calls++;
      const req = new EventEmitter() as ClientRequest;
      req.destroy = (error) => {
        destroyed = true;
        if (error) req.emit("error", error);
        return req;
      };
      req.end = (() => {
        queueMicrotask(() => {
          response = new PassThrough();
          const res = response as PassThrough & IncomingMessage;
          res.statusCode = 200;
          res.headers = headers;
          callback(res);
          for (const chunk of chunks) res.write(chunk);
          res.end();
        });
        return req;
      }) as ClientRequest["end"];
      return req;
    },
  }));
  const { FetchHttpTransportAdapter } = await import("../transport.fetch.js");
  const transport = new FetchHttpTransportAdapter({});
  const signal = new AbortController().signal;
  const request: HttpRequest = {
    method: "GET", url: "https://assets.example:8443/image?size=7", headers: { "X-Fixture": "kept" },
    timeoutMs: 900, idleTimeoutMs: 137, signal,
  };
  const peer = { ip: "8.8.4.4", port: 8443, authority: "assets.example:8443", tlsServerName: "assets.example" };
  expected = {
    method: "GET", host: "8.8.4.4", port: 8443, path: "/image?size=7",
    headers: { "X-Fixture": "kept", host: "assets.example:8443" }, timeout: 137, signal, servername: "assets.example",
  };

  // F4.3/F6.2: >= instead of > must reject this exact-cap response.
  await subcase("exact decoded byte cap keeps the full body and separate Set-Cookie values", async () => {
    chunks = [Buffer.from([0xc3]), Buffer.from([0xa9, 0x21])];
    headers = { "set-cookie": ["a=1; Expires=Wed, 01 Oct 2030 00:00:00 GMT", "b=2; HttpOnly"] };
    const result = await transport.requestPinned({ request: { ...request, maxResponseBytes: 3 }, peer });
    assert.equal(result.bodyText, "é!");
    assert.deepEqual([...result.bodyBytes!], [195, 169, 33]);
    assert.equal(result.bodyTruncated, undefined);
    assert.equal(result.bodyBytesTruncated, undefined);
    assert.deepEqual(result.setCookies, ["a=1; Expires=Wed, 01 Oct 2030 00:00:00 GMT", "b=2; HttpOnly"]);
    assert.equal(result.headers["set-cookie"], "a=1; Expires=Wed, 01 Oct 2030 00:00:00 GMT, b=2; HttpOnly");
    assert.equal(destroyed, false);
  });

  await subcase("aggregate overflow clips bytes and destroys the response and request", async () => {
    chunks = [Buffer.from("ab"), Buffer.from("cdef")];
    headers = {};
    const result = await transport.requestPinned({ request: { ...request, maxResponseBytes: 3 }, peer });
    assert.equal(result.bodyText, "abc");
    assert.deepEqual([...result.bodyBytes!], [97, 98, 99]);
    assert.equal(result.bodyTruncated, true);
    assert.equal(result.bodyBytesTruncated, true);
    assert.equal(response!.destroyed, true);
    assert.equal(destroyed, true);
  });

  await subcase("gzip expansion is capped after decoding and the next request can succeed", async () => {
    destroyed = false;
    chunks = [gzipSync(Buffer.from("expanded-body"))];
    headers = { "content-encoding": "gzip" };
    const result = await transport.requestPinned({ request: { ...request, maxResponseBytes: 4 }, peer });
    assert.equal(result.bodyText, "expa");
    assert.deepEqual([...result.bodyBytes!], [101, 120, 112, 97]);
    assert.equal(result.bodyBytesTruncated, true);
    assert.equal(response!.destroyed, true);
    assert.equal(destroyed, true);
    chunks = [Buffer.from("next")];
    headers = {};
    const next = await transport.requestPinned({ request: { ...request, maxResponseBytes: 4 }, peer });
    assert.equal(next.bodyText, "next");
    assert.equal(next.bodyBytesTruncated, undefined);
  });

  await subcase("a zero cap returns no bytes and flags a nonempty response", async () => {
    chunks = [Buffer.from("x")];
    const result = await transport.requestPinned({ request: { ...request, maxResponseBytes: 0 }, peer });
    assert.equal(result.bodyText, "");
    assert.deepEqual([...result.bodyBytes!], []);
    assert.equal(result.bodyBytesTruncated, true);
    assert.equal(response!.destroyed, true);
  });

  // Removing HEAD's bypass feeds an empty advertised gzip body to zlib and rejects.
  for (const encoding of ["gzip", "deflate", "br"]) {
    await subcase(`HEAD with ${encoding} metadata returns an empty body without decompression`, async () => {
      expected = { ...expected, method: "HEAD" };
      chunks = [];
      headers = { "content-encoding": encoding, "content-length": "8192" };
      const result = await transport.requestPinned({ request: { ...request, method: "HEAD" }, peer });
      assert.equal(result.status, 200);
      assert.equal(result.bodyText, "");
      assert.deepEqual([...result.bodyBytes!], []);
      assert.equal(result.bodyTruncated, undefined);
      assert.deepEqual(result.setCookies, []);
      assert.deepEqual(result.headers, { "content-encoding": encoding, "content-length": "8192" });
    });
  }
  assert.equal(calls, 8);
});
