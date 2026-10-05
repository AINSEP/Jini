import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { test } from "../legacy-test.js";

import { fetchAgentPluginArchive, maxAgentPluginArchiveBytes } from "../test-support.js";
import { AgentPluginFetchError } from "../../fetch-archive.js";
import { maxAgentPluginInstallArchiveBytes } from "../test-support.js";


/**
 * @file Unit tests for `fetchAgentPluginArchive()`. Every case that is genuinely about real HTTP
 * (status codes, redirects, chunked bodies, empty bodies) runs against a real loopback `node:http`
 * server rather than a mocked `fetch` — per this feature's own testing convention (`install.ts`'s
 * suite exercises both a scripted double AND the real `yauzl` adapter). `fetchImpl` injection is used
 * only for the two cases a real server cannot express: a response whose OWN reported `.url` differs
 * from what it declared (a lying/synthetic redirect target) and a response whose `Content-Length`
 * header under-reports its actual body size — Node's `http` module itself enforces that the two
 * agree for a real server, so that specific lie can only be modeled with a fabricated `Response`.
 */

/** Starts a real loopback server for the duration of `run`, then closes it — mirrors this feature's
 * own `mkdtemp`/`finally` cleanup discipline (see `force-remove.ts`) applied to a server instead of a
 * directory. */
async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected the loopback server to report an AddressInfo");
  }
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

/** Builds a fabricated `Response`-shaped value for the two cases described in this file's header
 * that a real server cannot express. Never used for anything a real server CAN express. */
function fakeResponse(init: {
  url: string;
  headers?: Record<string, string>;
  bodyChunks?: readonly Uint8Array[];
}): Response {
  const body =
    init.bodyChunks === undefined
      ? null
      : new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of init.bodyChunks ?? []) controller.enqueue(chunk);
            controller.close();
          },
        });
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    url: init.url,
    headers: new Headers(init.headers ?? {}),
    body,
  } as unknown as Response;
}

test("fetchAgentPluginArchive rejects a non-absolute URL with UNSUPPORTED_URL", async () => {
  await assert.rejects(
    () => fetchAgentPluginArchive({ url: "not-a-url" }),
    (error: unknown) => {
      assert.ok(error instanceof AgentPluginFetchError);
      assert.equal(error.code, "UNSUPPORTED_URL");
      assert.equal(error.message, "'[invalid URL]' is not an absolute URL");
      return true;
    },
  );
});

test("fetchAgentPluginArchive rejects a non-http(s) scheme with UNSUPPORTED_URL", async () => {
  await assert.rejects(
    () => fetchAgentPluginArchive({ url: "file:///etc/passwd" }),
    (error: unknown) => {
      assert.ok(error instanceof AgentPluginFetchError);
      assert.equal(error.code, "UNSUPPORTED_URL");
      assert.equal(
        error.message,
        "requested URL 'file:///etc/passwd' uses unsupported scheme 'file:' — only https: and http: are allowed",
      );
      return true;
    },
  );
});

test("fetchAgentPluginArchive reports a connection failure as REQUEST_FAILED", async () => {
  // Bind to get a real, momentarily-live port, then close the server before fetching it — the port
  // reliably refuses the connection, which is what a genuinely unreachable registry host looks like.
  const server = createServer((_req, res) => res.end());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected the loopback server to report an AddressInfo");
  }
  const url = `http://127.0.0.1:${address.port}`;
  await new Promise<void>((resolve) => server.close(() => resolve()));

  await assert.rejects(
    () => fetchAgentPluginArchive({ url }),
    (error: unknown) => {
      assert.ok(error instanceof AgentPluginFetchError);
      assert.equal(error.code, "REQUEST_FAILED");
      assert.equal(error.message.startsWith(`could not fetch '${url}': `), true);
      assert.ok(error.cause instanceof Error);
      return true;
    },
  );
});

test("fetchAgentPluginArchive reports a non-2xx status as HTTP_ERROR", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(404, "Not Found");
      res.end("nope");
    },
    async (baseUrl) => {
      await assert.rejects(
        () => fetchAgentPluginArchive({ url: baseUrl }),
        (error: unknown) => {
          assert.ok(error instanceof AgentPluginFetchError);
          assert.equal(error.code, "HTTP_ERROR");
          assert.equal(error.message, `'${baseUrl}' returned HTTP 404 Not Found`);
          return true;
        },
      );
    },
  );
});

test("fetchAgentPluginArchive reports a 2xx empty body as EMPTY_BODY", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200);
      res.end();
    },
    async (baseUrl) => {
      await assert.rejects(
        () => fetchAgentPluginArchive({ url: baseUrl }),
        (error: unknown) => {
          assert.ok(error instanceof AgentPluginFetchError);
          assert.equal(error.code, "EMPTY_BODY");
          assert.equal(error.message, `'${baseUrl}' returned an empty body`);
          return true;
        },
      );
    },
  );
});

test("fetchAgentPluginArchive rejects a real server's declared Content-Length over the cap with ARCHIVE_TOO_LARGE", async () => {
  const body = Buffer.alloc(1000, 7);
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-length": String(body.byteLength) });
      res.end(body);
    },
    async (baseUrl) => {
      await assert.rejects(
        () => fetchAgentPluginArchive({ url: baseUrl }, { maxBytes: 100 }),
        (error: unknown) => {
          assert.ok(error instanceof AgentPluginFetchError);
          assert.equal(error.code, "ARCHIVE_TOO_LARGE");
          assert.equal(error.message, `'${baseUrl}' declares 1000 bytes, over the 100-byte cap`);
          return true;
        },
      );
    },
  );
});

test("fetchAgentPluginArchive rejects an oversized declared Content-Length without pulling a single body chunk", async () => {
  // Declares 1000 bytes but would deliver only 10, so a regression that reads the body FIRST and
  // checks the header afterwards still throws this exact error. Only the pull counter can tell an
  // up-front reject from a read-then-reject. highWaterMark 0 stops the stream pre-pulling on its own.
  // (A real server cannot declare a length its body does not match - see this file's header.)
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(10).fill(9));
      controller.close();
    },
  }, { highWaterMark: 0 });
  const response = {
    ok: true,
    status: 200,
    statusText: "OK",
    url: "https://plugins.example/archive.zip",
    headers: new Headers({ "content-length": "1000" }),
    body,
  } as unknown as Response;
  const fetchImpl = (async () => response) as unknown as typeof globalThis.fetch;

  await assert.rejects(
    () => fetchAgentPluginArchive({ url: "https://plugins.example/archive.zip" }, { fetchImpl, maxBytes: 100 }),
    (error: unknown) => {
      assert.ok(error instanceof AgentPluginFetchError);
      assert.equal(error.code, "ARCHIVE_TOO_LARGE");
      assert.equal(error.message, "'https://plugins.example/archive.zip' declares 1000 bytes, over the 100-byte cap");
      return true;
    },
  );
  assert.equal(pulls, 0, "the body must not be read once the declared length is over the cap");
});

test("fetchAgentPluginArchive stops a stalled streaming download when the caller aborts, and the connection closes", async () => {
  // The server sends one chunk and then never finishes, so only the forwarded AbortSignal can end
  // the body read. A regression that drops the signal hangs here until the bounded race below.
  let requestClosed!: () => void;
  const serverSawClose = new Promise<void>((resolve) => { requestClosed = resolve; });
  const server: Server = createServer((req, res) => {
    req.on("close", () => requestClosed());
    res.writeHead(200);
    res.write(Buffer.alloc(16, 3));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected an AddressInfo");
  const url = `http://127.0.0.1:${address.port}/archive.zip`;
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  try {
    let responded!: () => void;
    const fetchResolved = new Promise<void>((resolve) => { responded = resolve; });
    const fetchImpl = (async (input: string, init?: RequestInit) => {
      const response = await globalThis.fetch(input, init);
      responded();
      return response;
    }) as unknown as typeof globalThis.fetch;
    const download = fetchAgentPluginArchive({ url }, { fetchImpl, signal: controller.signal });
    await fetchResolved;
    controller.abort();
    const outcome = await Promise.race([
      download.then(() => "resolved", (error: unknown) => error),
      new Promise((resolve) => { timer = setTimeout(() => resolve("still-reading"), 2000); }),
    ]);
    assert.ok(outcome instanceof AgentPluginFetchError, `expected the aborted download to reject, got ${String(outcome)}`);
    assert.equal(outcome.code, "REQUEST_FAILED");
    assert.equal(outcome.message, `could not read '${url}': archive response body failed`);
    await serverSawClose;
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("fetchAgentPluginArchive enforces the cap on bytes actually read when no Content-Length is declared", async () => {
  // No content-length header -> Node sends this chunked, so the header-based early reject cannot
  // fire at all; only the streaming cap enforced against bytes actually observed can catch this.
  await withServer(
    (_req, res) => {
      res.writeHead(200);
      res.write(Buffer.alloc(80, 1));
      res.write(Buffer.alloc(80, 2));
      res.end();
    },
    async (baseUrl) => {
      await assert.rejects(
        () => fetchAgentPluginArchive({ url: baseUrl }, { maxBytes: 100 }),
        (error: unknown) => {
          assert.ok(error instanceof AgentPluginFetchError);
          assert.equal(error.code, "ARCHIVE_TOO_LARGE");
          assert.equal(error.message, `'${baseUrl}' body exceeded the 100-byte cap`);
          return true;
        },
      );
    },
  );
});

test("fetchAgentPluginArchive enforces the cap on actual bytes even when Content-Length under-declares", async () => {
  // The one case a real server cannot express (Node's http module refuses to let a response's actual
  // byte count disagree with a manually-set Content-Length header) — see this file's header. Declares
  // 10 bytes (well under the 50-byte maxBytes below) but actually streams 200.
  const response = fakeResponse({
    url: "https://plugins.example/archive.zip",
    headers: { "content-length": "10" },
    bodyChunks: [new Uint8Array(100).fill(1), new Uint8Array(100).fill(2)],
  });
  const fetchImpl = (async () => response) as unknown as typeof globalThis.fetch;

  await assert.rejects(
    () => fetchAgentPluginArchive({ url: "https://plugins.example/archive.zip" }, { fetchImpl, maxBytes: 50 }),
    (error: unknown) => {
      assert.ok(error instanceof AgentPluginFetchError);
      assert.equal(error.code, "ARCHIVE_TOO_LARGE");
      assert.equal(error.message, "'https://plugins.example/archive.zip' body exceeded the 50-byte cap");
      return true;
    },
  );
});

test("fetchAgentPluginArchive follows a real redirect and reports the final resolved URL and digest", async () => {
  const zipBytes = Buffer.from("plugin-archive-bytes");
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/zip" });
      res.end(zipBytes);
    },
    async (targetUrl) => {
      await withServer(
        (_req, res) => {
          res.writeHead(302, { location: targetUrl });
          res.end();
        },
        async (redirectUrl) => {
          const result = await fetchAgentPluginArchive({ url: redirectUrl });
          assert.equal(result.resolvedUrl, `${targetUrl}/`);
          assert.deepEqual(Buffer.from(result.archive), zipBytes);
          assert.equal(result.sha256, createHash("sha256").update(zipBytes).digest("hex"));
        },
      );
    },
  );
});

test("fetchAgentPluginArchive rejects a redirect that lands on a disallowed scheme", async () => {
  const response = fakeResponse({ url: "file:///etc/passwd", bodyChunks: [] });
  const fetchImpl = (async () => response) as unknown as typeof globalThis.fetch;

  await assert.rejects(
    () => fetchAgentPluginArchive({ url: "https://plugins.example/archive.zip" }, { fetchImpl }),
    (error: unknown) => {
      assert.ok(error instanceof AgentPluginFetchError);
      assert.equal(error.code, "UNSUPPORTED_URL");
      assert.equal(
        error.message,
        "redirected-to URL 'file:///etc/passwd' uses unsupported scheme 'file:' — only https: and http: are allowed",
      );
      return true;
    },
  );
});

test("fetchAgentPluginArchive falls back to the requested URL when the response reports no URL of its own", async () => {
  const response = fakeResponse({ url: "", bodyChunks: [new Uint8Array([1, 2, 3])] });
  const fetchImpl = (async () => response) as unknown as typeof globalThis.fetch;

  const result = await fetchAgentPluginArchive(
    { url: "https://plugins.example/archive.zip" },
    { fetchImpl },
  );
  assert.equal(result.resolvedUrl, "https://plugins.example/archive.zip");
});

test("the fetch module's byte cap is pinned to install.ts's own archive cap", () => {
  assert.equal(maxAgentPluginArchiveBytes(), maxAgentPluginInstallArchiveBytes());
  assert.equal(maxAgentPluginArchiveBytes(), 32 * 1024 * 1024);
});
