import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import { PassThrough } from "node:stream";
import { expect, test } from "vitest";
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
