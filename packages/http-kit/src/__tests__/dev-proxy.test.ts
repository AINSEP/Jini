import assert from "node:assert/strict";
import { once } from "node:events";
import crypto from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { test as vitestTest } from "vitest";

import express from "express";

import { createDevProxyRequestHandler, createDevProxyUpgradeListener, resolveDevProxyPath, stripHopByHopHeaders } from "../dev-proxy.js";
import { DEV_PROXY_TLS } from "./dev-proxy-tls-fixture.js";

/**
 * @file Proves `dev-proxy.ts` forwards bytes and the HMR `upgrade` event, rather than just
 * type-checking. Stands up a REAL fake "Vite" server and a REAL Express app mounting
 * `createDevProxyRequestHandler`, both on ephemeral ports, driven with real sockets — no mocking of
 * `node:http`/`node:https`. HTTPS fixtures use a self-signed development certificate to exercise
 * both content and HMR transport through the proxy's TLS branch.
 */

type TestContext = { after(fn: () => unknown): void };
type TestBody = (t: TestContext) => unknown;

/** Adapts the `node:test` context shape these cases were written against (`t.after`) to vitest. */
function test(name: string, optionsOrBody: { timeout?: number } | TestBody, maybeBody?: TestBody): void {
  const options = typeof optionsOrBody === "function" ? {} : optionsOrBody;
  const body = typeof optionsOrBody === "function" ? optionsOrBody : (maybeBody as TestBody);
  vitestTest(name, { timeout: options.timeout ?? 5_000 }, async () => {
    const cleanups: Array<() => unknown> = [];
    try {
      await body({ after: (fn) => cleanups.push(fn) });
    } finally {
      for (const fn of cleanups.reverse()) await fn();
    }
  });
}

/** Starts a bare Express app mounting the dev proxy at `/admin`, listening on an ephemeral port. */
function startProxyApp(t: TestContext, devProxyUrl: string): Promise<string> {
  const app = express();
  app.all(["/admin", "/admin/*"], createDevProxyRequestHandler({ devProxyUrl, basePath: "/admin" }));
  const server = app.listen(0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return new Promise((resolve) => {
    server.on("listening", () => {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("test setup: expected a bound TCP address");
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

test("createDevProxyRequestHandler: forwards /admin/* to the configured Vite origin, unmodified path and body", async (t) => {
  const receivedPaths: string[] = [];
  const received: Array<{ method: string | undefined; cookie: string | undefined; host: string | undefined; body: string }> = [];
  const fakeVite = createHttpServer((req, res) => {
    receivedPaths.push(req.url ?? "");
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        received.push({ method: req.method, cookie: req.headers.cookie, host: req.headers.host, body: Buffer.concat(chunks).toString("utf8") });
        res.writeHead(404, { "content-type": "text/plain", "x-fake-vite": "1" });
        res.end("upstream missing asset");
      });
      return;
    }
    res.writeHead(200, { "content-type": "text/javascript", "x-fake-vite": "1" });
    res.end("console.log('served by fake vite')");
  });
  fakeVite.listen(0);
  t.after(() => new Promise<void>((resolve) => fakeVite.close(() => resolve())));
  await new Promise<void>((resolve) => fakeVite.on("listening", () => resolve()));
  const fakeViteAddress = fakeVite.address();
  if (fakeViteAddress === null || typeof fakeViteAddress === "string") throw new Error("test setup: expected a bound TCP address");

  const baseUrl = await startProxyApp(t, `http://127.0.0.1:${fakeViteAddress.port}`);

  const res = await fetch(`${baseUrl}/admin/src/main.tsx?t=123`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-fake-vite"), "1");
  assert.equal(await res.text(), "console.log('served by fake vite')");
  assert.deepEqual(receivedPaths, ["/admin/src/main.tsx?t=123"]);
  const posted = await fetch(`${baseUrl}/admin/missing?probe=body`, {
    method: "POST", headers: { "content-type": "text/plain", cookie: "vite-session=probe" }, body: "distinct request payload",
  });
  assert.equal(posted.status, 404);
  assert.equal(posted.headers.get("x-fake-vite"), "1");
  assert.equal(await posted.text(), "upstream missing asset");
  assert.deepEqual(receivedPaths, ["/admin/src/main.tsx?t=123", "/admin/missing?probe=body"]);
  assert.deepEqual(received, [{ method: "POST", cookie: "vite-session=probe", host: `127.0.0.1:${fakeViteAddress.port}`, body: "distinct request payload" }]);
});

test("stripHopByHopHeaders: drops connection/transfer-encoding/upgrade but keeps every other header untouched", () => {
  const filtered = stripHopByHopHeaders({
    connection: "keep-alive",
    "transfer-encoding": "chunked",
    upgrade: "websocket",
    "keep-alive": "timeout=5",
    "proxy-authenticate": "Basic",
    "content-type": "text/javascript",
    "x-fake-vite": "1",
  });
  assert.deepEqual(filtered, {
    "content-type": "text/javascript",
    "x-fake-vite": "1",
  });
});

test("createDevProxyRequestHandler: does not relay the upstream's own Connection header value to the client — that header describes the proxy's hop to Vite, not the client's hop to this server, and (on an HTTP/2 client) forwarding it verbatim would throw ERR_HTTP2_INVALID_CONNECTION_HEADER outright; the fake Vite below sets `Connection: close`, a value the admin server's own keep-alive hop to the client would never choose on its own, to make a leak observable over plain HTTP/1.1 too", async (t) => {
  const fakeVite = createHttpServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain", connection: "close", "x-fake-vite": "1" });
    res.end("ok");
  });
  fakeVite.listen(0);
  t.after(() => new Promise<void>((resolve) => fakeVite.close(() => resolve())));
  await new Promise<void>((resolve) => fakeVite.on("listening", () => resolve()));
  const fakeViteAddress = fakeVite.address();
  if (fakeViteAddress === null || typeof fakeViteAddress === "string") throw new Error("test setup: expected a bound TCP address");

  const baseUrl = await startProxyApp(t, `http://127.0.0.1:${fakeViteAddress.port}`);

  const res = await fetch(`${baseUrl}/admin/whatever`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-fake-vite"), "1");
  assert.notEqual(res.headers.get("connection"), "close");
});

test("createDevProxyRequestHandler: rewrites a bare /admin to /admin/ before it reaches Vite (Vite's own base match is exact)", async (t) => {
  const receivedPaths: string[] = [];
  const fakeVite = createHttpServer((req, res) => {
    receivedPaths.push(req.url ?? "");
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html></html>");
  });
  fakeVite.listen(0);
  t.after(() => new Promise<void>((resolve) => fakeVite.close(() => resolve())));
  await new Promise<void>((resolve) => fakeVite.on("listening", () => resolve()));
  const fakeViteAddress = fakeVite.address();
  if (fakeViteAddress === null || typeof fakeViteAddress === "string") throw new Error("test setup: expected a bound TCP address");

  const baseUrl = await startProxyApp(t, `http://127.0.0.1:${fakeViteAddress.port}`);

  const res = await fetch(`${baseUrl}/admin`, { redirect: "manual" });
  assert.equal(res.status, 200, "a bare /admin must be served, not redirected or 404ed");
  assert.deepEqual(receivedPaths, ["/admin/"]);
});

test("createDevProxyRequestHandler: an unreachable Vite origin gets a 502, not a hang or a crash", async (t) => {
  // Port 1 is a privileged port nothing in this test suite is listening on; the OS refuses the
  // connection immediately (ECONNREFUSED) instead of timing out, keeping this test fast.
  const baseUrl = await startProxyApp(t, "http://127.0.0.1:1");

  const res = await fetch(`${baseUrl}/admin/`);
  assert.equal(res.status, 502);
});

for (const protocol of ["http", "https"] as const) {
for (const immediateFrame of [false, true]) {
test(`createDevProxyUpgradeListener: forwards HMR data in both directions through a real ${protocol} upstream (immediate frame: ${immediateFrame})`, { timeout: 8_000 }, async (t) => {
  const tunnelSockets = new Set<import("node:stream").Duplex>();
  t.after(() => { for (const socket of tunnelSockets) socket.destroy(); });

  // Stands in for Vite's own ws server: performs a real RFC 6455 handshake so this test proves the
  // proxy carries a genuine upgrade (matching `Sec-WebSocket-Accept`), not just that some bytes moved.
  const rejectPlainRequest = (_req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => { res.writeHead(404).end(); };
  const fakeVite = protocol === "https" ? createHttpsServer(DEV_PROXY_TLS, rejectPlainRequest) : createHttpServer(rejectPlainRequest);
  const clientFrame = Buffer.from([0x81, 0x82, 1, 2, 3, 4, 0x68 ^ 1, 0x69 ^ 2]); // masked "hi"
  const serverFrame = Buffer.concat([Buffer.from([0x81, 9]), Buffer.from("hmr-reply")]);
  const greetingFrame = immediateFrame ? Buffer.concat([Buffer.from([0x81, 5]), Buffer.from("hello")]) : Buffer.alloc(0);
  const expectedFrames = Buffer.concat([greetingFrame, serverFrame]);
  let upstreamClosed!: () => void;
  const upstreamTermination = new Promise<void>((resolve) => { upstreamClosed = resolve; });
  fakeVite.on("upgrade", (req, socket, head) => {
    assert.equal(req.url, "/admin/?token=abc");
    tunnelSockets.add(socket);
    socket.on("close", upstreamClosed);
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash("sha1")
      .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");
    socket.write(Buffer.concat([
      Buffer.from(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: vite-hmr\r\n\r\n`),
      greetingFrame,
    ]));
    // A real WS server (the `ws` package Vite itself uses) closes its side on disconnect; this bare
    // stand-in must do the same or `fakeVite.close()` below hangs forever. `http.Server` sockets are
    // `allowHalfOpen: true`, so a graceful disconnect only ever delivers `end`, never `close` — the
    // exact gap `dev-proxy.ts`'s own `destroyOnTermination` exists to close on the proxy side.
    socket.on("end", () => socket.destroy());
    let buffered = Buffer.alloc(0);
    const receiveFrame = (bytes: Buffer) => {
      buffered = Buffer.concat([buffered, bytes]);
      if (buffered.length < clientFrame.length) return;
      if (!buffered.equals(clientFrame)) { socket.destroy(); return; }
      socket.write(serverFrame);
    };
    socket.on("data", receiveFrame);
    if (head.length > 0) receiveFrame(head);
  });
  fakeVite.listen(0);
  t.after(() => new Promise<void>((resolve) => fakeVite.close(() => resolve())));
  await new Promise<void>((resolve) => fakeVite.on("listening", () => resolve()));
  const fakeViteAddress = fakeVite.address();
  if (fakeViteAddress === null || typeof fakeViteAddress === "string") throw new Error("test setup: expected a bound TCP address");

  const devProxyUrl = `${protocol}://127.0.0.1:${fakeViteAddress.port}`;

  const proxyServer = createHttpServer((_req, res) => res.writeHead(404).end());
  proxyServer.on("upgrade", createDevProxyUpgradeListener({ devProxyUrl, basePath: "/admin" }));
  proxyServer.listen(0);
  t.after(() => new Promise<void>((resolve) => proxyServer.close(() => resolve())));
  await new Promise<void>((resolve) => proxyServer.on("listening", () => resolve()));
  const proxyAddress = proxyServer.address();
  if (proxyAddress === null || typeof proxyAddress === "string") throw new Error("test setup: expected a bound TCP address");

  const clientKey = crypto.randomBytes(16).toString("base64");
  const expectedAccept = crypto
    .createHash("sha1")
    .update(clientKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");

  const { request } = await import("node:http");
  // A raw client can put the first frame in the same write as its handshake. Node exposes those
  // already-read bytes as `head`; the ordinary HTTP client below sends its frame after upgrading.
  const { connect } = await import("node:net");
  const upgrade = immediateFrame ? await new Promise<{ statusCode?: number | undefined; headers: Record<string, unknown> }>((resolve, reject) => {
    const socket = connect(proxyAddress.port, "127.0.0.1");
    tunnelSockets.add(socket);
    let buffered = Buffer.alloc(0);
    socket.on("error", reject);
    socket.on("connect", () => socket.write(Buffer.concat([
      Buffer.from(`GET /admin?token=abc HTTP/1.1\r\nHost: 127.0.0.1:${proxyAddress.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${clientKey}\r\n\r\n`),
      clientFrame,
    ])));
    socket.on("data", (bytes) => {
      buffered = Buffer.concat([buffered, bytes]);
      const boundary = buffered.indexOf("\r\n\r\n");
      if (boundary < 0 || buffered.length < boundary + 4 + expectedFrames.length) return;
      try {
        const header = buffered.subarray(0, boundary).toString("utf8");
        assert.match(header, /^HTTP\/1\.1 101 Switching Protocols\r\n/);
        const accept = /^Sec-WebSocket-Accept: (.+)$/m.exec(header)?.[1]?.trim();
        assert.equal(accept, expectedAccept);
        assert.deepEqual(buffered.subarray(boundary + 4), expectedFrames, "both handshake heads survive unchanged");
        socket.resetAndDestroy();
        resolve({ statusCode: Number(header.split(" ")[1]), headers: { "sec-websocket-accept": accept } });
      } catch (error) { socket.destroy(); reject(error); }
    });
  }) : await new Promise<{ statusCode?: number | undefined; headers: Record<string, unknown> }>((resolve, reject) => {
    const req = request({
      hostname: "127.0.0.1",
      port: proxyAddress.port,
      path: "/admin/?token=abc",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": clientKey,
      },
    });
    req.on("upgrade", (res, socket, head) => {
      tunnelSockets.add(socket);
      let buffered = head;
      socket.on("data", (bytes) => {
        buffered = Buffer.concat([buffered, bytes]);
        if (buffered.length < expectedFrames.length) return;
        try {
          assert.deepEqual(buffered, expectedFrames, "upstream HMR payload must cross the pipe unchanged");
          // Destroy rather than half-close: the upstream keeps a WebSocket open for its lifetime,
          // so end() can leave server.close() waiting forever. This also exercises the proxy's
          // cross-destroy cleanup, whose upstream close is awaited below.
          socket.destroy();
          resolve({ statusCode: res.statusCode, headers: res.headers });
        } catch (error) {
          socket.destroy();
          reject(error);
        }
      });
      socket.on("error", reject);
      socket.write(clientFrame);
    });
    req.on("response", (res) => reject(new Error(`expected an upgrade, got a plain ${res.statusCode} response`)));
    req.on("error", reject);
    req.end();
  });

  assert.equal(upgrade.statusCode, 101);
  assert.equal(upgrade.headers["sec-websocket-accept"], expectedAccept);
  await upstreamTermination;
});
}
}

test("createDevProxyUpgradeListener: ignores an upgrade request outside /admin, leaving the socket untouched for any other listener", async () => {
  const listener = createDevProxyUpgradeListener({ devProxyUrl: "http://127.0.0.1:1", basePath: "/admin" });
  const capturedListener = listener as unknown as (req: unknown, socket: unknown, head: unknown) => void;

  let destroyed = false;
  const fakeSocket = { destroy: () => (destroyed = true), write: () => {}, on: () => {} };
  // A non-/admin upgrade (e.g. some other future WS route) must be left alone, not destroyed —
  // destroying it here would pre-empt any other 'upgrade' listener on the same server.
  capturedListener({ url: "/something-else" }, fakeSocket, Buffer.alloc(0));

  assert.equal(destroyed, false);
});

test("createDevProxyRequestHandler proxies HTTPS content through a self-signed development certificate", async (t) => {
  const upstream = createHttpsServer(DEV_PROXY_TLS, (req, res) => {
    res.writeHead(req.url === "/admin/tls-probe" ? 200 : 404, { "content-type": "text/plain" });
    res.end("TLS upstream content");
  });
  t.after(() => { upstream.closeAllConnections(); return new Promise<void>((resolve) => upstream.close(() => resolve())); });
  upstream.listen(0);
  await new Promise<void>((resolve) => upstream.on("listening", resolve));
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = await startProxyApp(t, `https://127.0.0.1:${address.port}`);
  const res = await fetch(`${baseUrl}/admin/tls-probe`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "TLS upstream content");
});

test("upgrade to an unavailable upstream closes the client socket", { timeout: 8_000 }, async (t) => {
  const { request } = await import("node:http");
  // Drop the handshake at the transport boundary, without depending on a local unused port.
  const upstream = createHttpServer((req) => req.socket.destroy());
  upstream.listen(0);
  await once(upstream, "listening");
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  t.after(() => new Promise<void>((resolve) => upstream.close(() => resolve())));
  const devProxyUrl = `http://127.0.0.1:${address.port}`;
  const server = createHttpServer();
  server.on("upgrade", createDevProxyUpgradeListener({ devProxyUrl, basePath: "/admin" }));
  server.listen(0);
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const proxyAddress = server.address();
  assert.ok(proxyAddress && typeof proxyAddress !== "string");
  const error = await new Promise<NodeJS.ErrnoException>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: proxyAddress.port, path: "/admin/", headers: { Connection: "Upgrade", Upgrade: "websocket" } });
    req.on("error", resolve);
    req.on("response", () => reject(new Error("an unavailable websocket upstream must close the socket")));
    req.end();
  });
  assert.equal(error.code, "ECONNRESET");
});

test("createDevProxyRequestHandler: an upstream that dies after its response headers were relayed tears the client response down instead of writing a second (502) head", { timeout: 8_000 }, async (t) => {
  const { request: httpRequest } = await import("node:http");
  // Answers before reading the upload, then drops the connection while the client is still sending:
  // the proxy's upstream request then fails AFTER this response's headers already went to the client.
  const fakeVite = createHttpServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("partial");
    setTimeout(() => req.socket.destroy(), 50);
  });
  fakeVite.listen(0);
  t.after(() => new Promise<void>((resolve) => fakeVite.close(() => resolve())));
  await once(fakeVite, "listening");
  const fakeViteAddress = fakeVite.address();
  if (fakeViteAddress === null || typeof fakeViteAddress === "string") throw new Error("test setup: expected a bound TCP address");
  const baseUrl = await startProxyApp(t, `http://127.0.0.1:${fakeViteAddress.port}`);

  const outcome = await new Promise<{ status: number | undefined; body: string; ended: "complete" | "torn-down" }>((resolve) => {
    const upload = httpRequest(`${baseUrl}/admin/upload`, { method: "POST", headers: { "content-type": "text/plain" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body, ended: "complete" }));
      res.on("error", () => resolve({ status: res.statusCode, body, ended: "torn-down" }));
    });
    upload.on("error", () => { /* the torn-down response is the assertion; the upload leg dying with it is expected */ });
    const timer = setInterval(() => { if (!upload.destroyed) upload.write("x".repeat(64 * 1024)); }, 10);
    upload.on("close", () => clearInterval(timer));
    t.after(() => { clearInterval(timer); upload.destroy(); });
  });

  assert.equal(outcome.status, 200, "the upstream's own status reached the client first");
  assert.equal(outcome.ended, "torn-down");
  assert.doesNotMatch(outcome.body, /Admin dev proxy: .* is unreachable/, "no 502 text is appended to an already-started response");
  // The admin server survived the late failure and still relays the next request.
  const next = await fetch(`${baseUrl}/admin/`);
  assert.equal(next.status, 200);
  await next.body?.cancel();
});

// Pure-function coverage for `resolveDevProxyPath` — the bare-`/admin` fix the dev proxy needs because
// Vite's `base: "/admin/"` only falls through to `index.html` on an exact match, trailing slash
// included (confirmed against the installed Vite 7.3.6 source; see `dev-proxy.ts`'s module doc).
// Kept apart from the real-server integration tests above since these need no server at all.
test("resolveDevProxyPath: rewrites a bare /admin to /admin/", () => {
  assert.equal(resolveDevProxyPath({ basePath: "/admin", url: "/admin" }), "/admin/");
});

test("resolveDevProxyPath: preserves the query string when rewriting a bare /admin", () => {
  assert.equal(resolveDevProxyPath({ basePath: "/admin", url: "/admin?foo=bar" }), "/admin/?foo=bar");
});

test("resolveDevProxyPath: leaves /admin/ (already exact) unchanged", () => {
  assert.equal(resolveDevProxyPath({ basePath: "/admin", url: "/admin/" }), "/admin/");
});

test("resolveDevProxyPath: leaves an /admin/* subpath unchanged", () => {
  assert.equal(resolveDevProxyPath({ basePath: "/admin", url: "/admin/src/main.tsx?t=1" }), "/admin/src/main.tsx?t=1");
});

test("resolveDevProxyPath: does not mistake a longer path for the bare /admin case", () => {
  // A naive `startsWith("/admin")` check would wrongly match this; the rewrite must compare the
  // exact pathname, not a prefix.
  assert.equal(resolveDevProxyPath({ basePath: "/admin", url: "/adminfoo" }), "/adminfoo");
});
