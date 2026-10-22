import assert from "node:assert/strict";
import { inspect } from "node:util";
import { test } from "vitest";
import {
  AgentPluginFetchError,
  fetchAgentPluginArchive,
  type AgentPluginFetchErrorCode,
} from "../../fetch-archive.js";
import type { AgentPluginFetchPort } from "../../ports.js";

const SIGNED_URL = "https://archive-user:archive-password@plugins.example/archive.zip?signature=signed-token#private-fragment";
const SAFE_URL = "https://plugins.example/archive.zip";
const SECRET_VALUES = ["archive-user", "archive-password", "signature", "signed-token", "private-fragment", "redirect-user", "redirect-password", "redirect-token"];
const outboundGuard = { assertAllowed: async () => {} };

// Inspect causes and stacks too: hiding only the top-level message still leaks transport tokens.
async function rejectsWithoutSecrets({ run, code, message }: {
  run: () => Promise<unknown>;
  code: AgentPluginFetchErrorCode;
  message: string;
}): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof AgentPluginFetchError);
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    const diagnostic = inspect(error, { depth: 10 });
    for (const secret of SECRET_VALUES) assert.equal(diagnostic.includes(secret), false, secret);
    return true;
  });
}

test("status errors strip signed URL credentials, query and fragment", async () => {
  const fetch: AgentPluginFetchPort = async ({ url }) => {
    assert.equal(url, SIGNED_URL, "only diagnostics may be sanitized; the transport needs the signed URL");
    return new Response(null, { status: 404, statusText: "Not Found" });
  };
  await rejectsWithoutSecrets({
    run: () => fetchAgentPluginArchive({ url: SIGNED_URL, fetch, outboundGuard }),
    code: "HTTP_ERROR", message: `'${SAFE_URL}' returned HTTP 404 Not Found`,
  });
});

test("status errors cannot reflect secrets through a server-supplied reason phrase", async () => {
  await rejectsWithoutSecrets({
    run: () => fetchAgentPluginArchive({ url: SIGNED_URL, fetch: async () => new Response(null, {
      status: 404, statusText: `Failed ${SIGNED_URL}`,
    }), outboundGuard }),
    code: "HTTP_ERROR", message: `'${SAFE_URL}' returned HTTP 404 Not Found`,
  });
});

test("declared size-limit errors strip signed URL details before reading", async () => {
  let read = false;
  const response = new Response(new Uint8Array([1]), { headers: { "content-length": "1000" } });
  Object.defineProperty(response, "body", { get() { read = true; throw new Error("unexpected body read"); } });
  await rejectsWithoutSecrets({
    run: () => fetchAgentPluginArchive({ url: SIGNED_URL, fetch: async () => response, outboundGuard }, { maxBytes: 100 }),
    code: "ARCHIVE_TOO_LARGE", message: `'${SAFE_URL}' declares 1000 bytes, over the 100-byte cap`,
  });
  assert.equal(read, false);
});

test("streamed size-limit errors strip signed URL details and cancel the stream", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(80));
      controller.enqueue(new Uint8Array(80));
    },
    cancel() { cancelled = true; },
  }), { headers: { "content-length": "10" } });
  await rejectsWithoutSecrets({
    run: () => fetchAgentPluginArchive({ url: SIGNED_URL, fetch: async () => response, outboundGuard }, { maxBytes: 100 }),
    code: "ARCHIVE_TOO_LARGE", message: `'${SAFE_URL}' body exceeded the 100-byte cap`,
  });
  assert.equal(cancelled, true);
});

for (const body of [null, ""] as const) {
  test(`empty-body errors strip signed URL details (${body === null ? "no stream" : "empty stream"})`, async () => {
    await rejectsWithoutSecrets({
      run: () => fetchAgentPluginArchive({ url: SIGNED_URL, fetch: async () => new Response(body), outboundGuard }),
      code: "EMPTY_BODY", message: `'${SAFE_URL}' returned an empty body`,
    });
  });
}

for (const { name, error: transportError } of [
  { name: "Error with nested cause", error: new Error(`connection refused for ${SIGNED_URL}`, { cause: new Error("signed-token") }) },
  { name: "string rejection", error: `failed to fetch ${SIGNED_URL}` },
  { name: "bare token", error: new Error("signed-token") },
]) {
  test(`transport errors never expose raw messages or nested causes (${name})`, async () => {
    await rejectsWithoutSecrets({
      run: () => fetchAgentPluginArchive({ url: SIGNED_URL, fetch: async () => { throw transportError; }, outboundGuard }),
      code: "REQUEST_FAILED", message: `could not fetch '${SAFE_URL}': archive request failed`,
    });
  });
}

test("transport errors after a redirect cannot leak another host's signed URL", async () => {
  const target = "https://redirect-user:redirect-password@cdn.example/archive.zip?token=redirect-token";
  const visited: string[] = [];
  await rejectsWithoutSecrets({
    run: () => fetchAgentPluginArchive({ url: SIGNED_URL, outboundGuard, fetch: async ({ url }) => {
      visited.push(url);
      if (url === SIGNED_URL) return new Response(null, { status: 302, headers: { location: target } });
      throw new Error(`could not contact ${target}`);
    } }),
    code: "REQUEST_FAILED", message: `could not fetch '${SAFE_URL}': archive request failed`,
  });
  assert.deepEqual(visited, [SIGNED_URL, target]);
});

test("body transport failures are sanitized after a successful response", async () => {
  const response = new Response(new ReadableStream({ start(controller) { controller.error(new Error(SIGNED_URL)); } }));
  await rejectsWithoutSecrets({
    run: () => fetchAgentPluginArchive({ url: SIGNED_URL, fetch: async () => response, outboundGuard }),
    code: "REQUEST_FAILED", message: `could not read '${SAFE_URL}': archive response body failed`,
  });
});

test("outbound guard failures cannot leak transport tokens", async () => {
  await rejectsWithoutSecrets({
    run: () => fetchAgentPluginArchive({ url: SIGNED_URL,
      fetch: async () => { throw new Error("unexpected fetch"); },
      outboundGuard: { assertAllowed: async () => { throw new Error(SIGNED_URL); } },
    }),
    code: "REQUEST_FAILED", message: `could not fetch '${SAFE_URL}': archive request failed`,
  });
});

test("unsupported-scheme errors sanitize parsed URLs", async () => {
  await rejectsWithoutSecrets({
    run: () => fetchAgentPluginArchive({ url: SIGNED_URL.replace("https:", "ftp:"), fetch: async () => new Response(), outboundGuard }),
    code: "UNSUPPORTED_URL", message: "requested URL 'ftp://plugins.example/archive.zip' uses unsupported scheme 'ftp:' — only https: and http: are allowed",
  });
});

test("malformed URL errors never echo an unparseable credential-bearing input", async () => {
  await rejectsWithoutSecrets({
    run: () => fetchAgentPluginArchive({ url: "https://archive-user:archive-password@[?signature=signed-token", fetch: async () => new Response(), outboundGuard }),
    code: "UNSUPPORTED_URL", message: "'[invalid URL]' is not an absolute URL",
  });
});

test("final response URL validation sanitizes credentials and query", async () => {
  const response = new Response("archive");
  Object.defineProperty(response, "url", { value: SIGNED_URL.replace("https:", "ftp:") });
  await rejectsWithoutSecrets({
    run: () => fetchAgentPluginArchive({ url: SAFE_URL, fetch: async () => response, outboundGuard }),
    code: "UNSUPPORTED_URL", message: "redirected-to URL 'ftp://plugins.example/archive.zip' uses unsupported scheme 'ftp:' — only https: and http: are allowed",
  });
});

test("successful downloads preserve the signed resolved URL and archive bytes", async () => {
  const archive = new Uint8Array([1, 2, 3]);
  const result = await fetchAgentPluginArchive({ url: SIGNED_URL, fetch: async () => new Response(archive), outboundGuard });
  assert.deepEqual(result.archive, archive);
  assert.equal(result.resolvedUrl, SIGNED_URL);
});


test("a body transport cannot smuggle secret text through a matching size-limit error type", async () => {
  const response = new Response(new ReadableStream({ start(controller) {
    controller.error(new AgentPluginFetchError({ code: "ARCHIVE_TOO_LARGE", message: SIGNED_URL }, { cause: new Error("signed-token") }));
  } }));
  await rejectsWithoutSecrets({
    run: () => fetchAgentPluginArchive({ url: SIGNED_URL, fetch: async () => response, outboundGuard }, { maxBytes: 100 }),
    code: "ARCHIVE_TOO_LARGE", message: `'${SAFE_URL}' body exceeded the 100-byte cap`,
  });
});
