import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import { PassThrough } from "node:stream";
import { expect, test, vi } from "vitest";
import { FetchHttpTransportAdapter } from "../transport.fetch.js";

/** A response stream whose destroy() is ignored, like a socket that still has buffered bytes in flight. */
function stubbornResponse(): PassThrough & IncomingMessage {
  const res = new PassThrough() as PassThrough & IncomingMessage;
  res.headers = {};
  res.statusCode = 200;
  res.destroy = (() => res) as typeof res.destroy;
  return res;
}

test("the injected request port dials the pinned peer, and bytes arriving after truncation never grow the body", async () => {
  const seen: { secure: boolean; options: RequestOptions }[] = [];
  let destroyed = 0;
  const res = stubbornResponse();
  const transport = new FetchHttpTransportAdapter({}, {
    request: ({ secure, options, onResponse }) => {
      seen.push({ secure, options });
      const clientRequest = new EventEmitter() as ClientRequest;
      clientRequest.write = (() => true) as ClientRequest["write"];
      clientRequest.destroy = (() => { destroyed += 1; return clientRequest; }) as ClientRequest["destroy"];
      clientRequest.end = (() => {
        queueMicrotask(() => {
          onResponse(res);
          res.write(Buffer.from("abcdef"));
          res.write(Buffer.from("late bytes"));
          res.end();
        });
        return clientRequest;
      }) as ClientRequest["end"];
      return clientRequest;
    },
  });
  const response = await transport.requestPinned({
    request: { method: "GET", url: "https://provider.example/data?x=1", headers: {}, timeoutMs: 500, maxResponseBytes: 4 },
    peer: { ip: "203.0.113.7", port: 443, authority: "provider.example", tlsServerName: "provider.example" },
  });
  expect(seen).toEqual([{ secure: true, options: {
    method: "GET", host: "203.0.113.7", port: 443, path: "/data?x=1", headers: { host: "provider.example" }, timeout: 500, servername: "provider.example",
  } }]);
  expect(response.bodyText).toBe("abcd");
  expect(response.bodyTruncated).toBe(true);
  expect(response.bodyBytesTruncated).toBe(true);
  expect(destroyed).toBe(1);
  // Let the late chunk and end event drain: neither may re-settle or append.
  await new Promise((resolve) => setImmediate(resolve));
  expect(response.bodyText).toBe("abcd");
});

test.each([300 * 1024 * 1024, undefined])("the response uses the explicit byte limit %s or the 100 MiB default", async maxResponseBytes => {
  const chunk = Buffer.alloc(1024 * 1024, 120);
  const res = stubbornResponse();
  const transport = new FetchHttpTransportAdapter({}, {
    request: ({ onResponse }) => {
      const request = new EventEmitter() as ClientRequest;
      let stopped = false;
      request.destroy = error => { stopped = true; if (error) request.emit("error", error); return request; };
      request.end = (() => {
        queueMicrotask(() => {
          onResponse(res);
          for (let i = 0; i < 101 && !stopped; i++) res.write(chunk);
          res.end();
        });
        return request;
      }) as ClientRequest["end"];
      return request;
    },
  });
  const response = transport.requestPinned({
    request: { method: "GET", url: "https://provider.example/archive.zip", headers: {}, timeoutMs: 500,
      ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }) },
    peer: { ip: "203.0.113.7", port: 443, authority: "provider.example", tlsServerName: "provider.example" },
  });
  if (maxResponseBytes === undefined) {
    expect(await response.then(() => "completed", (error: Error) => error.message)).toBe("response exceeded the absolute size ceiling");
  } else {
    const result = await response;
    expect(result.bodyBytes?.length).toBe(101 * 1024 * 1024);
    expect(result.bodyText.length).toBe(101 * 1024 * 1024);
    expect(result.bodyBytes?.at(-1)).toBe(120);
    expect(result.bodyTruncated).toBeUndefined();
    expect(result.bodyBytesTruncated).toBeUndefined();
  }
});


test("byte-only responses preserve non-ASCII data without decoding or re-encoding text", async () => {
  const { createHttpClient } = await import("../client.js");
  const payload = Buffer.from([0xff, 0xfe, 0x80, 0, 0xc3, 0x28]);
  const res = stubbornResponse();
  const transport = new FetchHttpTransportAdapter({}, { request: ({ onResponse }) => {
    const request = new EventEmitter() as ClientRequest;
    request.destroy = () => request;
    request.end = (() => { queueMicrotask(() => { onResponse(res); res.end(payload); }); return request; }) as ClientRequest["end"];
    return request;
  } });
  const client = createHttpClient({ transport, dns: { resolve: async () => ["93.184.216.34"] },
    clock: { nowMs: Date.now, timeoutSignal: ({ timeoutMs }) => AbortSignal.timeout(timeoutMs) }, userAgent: "Import test",
    policy: { allowedSchemes: ["https"], denyPrivateAddresses: true, devHostAllowlist: [], maxRedirects: 0, connectTimeoutMs: 1000, maxResponseBytes: 100, maxDecompressedBytes: 100 },
  });
  const from = vi.spyOn(Buffer, "from");
  try {
    const response = await client.send({ request: { method: "GET", url: "https://provider.example/archive.zip", headers: {}, timeoutMs: 1000, bodyAs: "bytes" } });
    expect(response.bodyText).toBe("");
    expect(response.bodyBytes).toEqual(payload);
    expect(response.bodyBytesTruncated).toBe(false);
    expect(from.mock.calls.some(args => typeof args[0] === "string")).toBe(false);
  } finally { from.mockRestore(); }
});
