import { defaultFederationMessages } from "../messages.js";
import assert from "node:assert/strict";
import { onTestFinished, test, vi } from "vitest";
import { connectMcpHttpSession } from "../adapter.http.js";
import { McpAuthFailedError } from "../mcp-protocol.js";
import { buildFederatedMcpRegistrations } from "../registrations.js";
import { createDefaultConnect } from "../stdio/default-connect.js";
import { IDENTITY_STDIO_LAUNCH_RESOLVER } from "../stdio/stdio-launch-resolver.js";
import { ScriptedMcpHttpExchange } from "../testing/adapter.memory.js";
import { clientInfo, messages as federationMessages } from "./fixtures.js";

const spec = { url: "https://example.invalid/mcp", headers: {} };
const config = { connectionId: "hosted", label: "Hosted", allowedToolNames: ["inspect"],
  writeAllowedToolNames: [], connectTimeoutMs: 100, callTimeoutMs: 100, maxResultBytes: 4096, maxTools: 1 };
const diagnostic = "mcp-federation: authentication challenge hook failed";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function fixture(options: Parameters<typeof connectMcpHttpSession>[1], { delayMs = 0, sessionId }: {
  delayMs?: number; sessionId?: string;
} = {}) {
  const exchange = new ScriptedMcpHttpExchange({ respond: ({ request }) => {
    if (request.message?.method === "tools/call") return { status: 401, body: "",
      sessionId, wwwAuthenticate: "Bearer scope=inspect" };
    if (request.message?.method === "notifications/initialized") return { status: 202, body: "" };
    return { body: { jsonrpc: "2.0", id: request.message?.id, result: {
      protocolVersion: "2025-06-18", serverInfo: { name: "fixture" },
    } } };
  } });
  const session = await connectMcpHttpSession({ messages: defaultFederationMessages, spec, clientInfo, requestTimeoutMs: 100, bearerToken: () => undefined,
    exchange: { send: async (request, options = {}) => {
      if (delayMs && JSON.parse(options.body ?? "{}").method === "tools/call") {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
      return exchange.send(request, options);
    } },
  }, options);
  onTestFinished(() => session.close({}));
  return { session, exchange };
}

for (const asynchronous of [false, true]) test(`a ${asynchronous ? "rejected" : "throwing"} challenge hook is logged and preserves auth revocation`, async () => {
  const warnings: string[] = [];
  const { session, exchange } = await fixture({
    onAuthenticationChallenge: () => {
      if (asynchronous) return Promise.reject(new Error("observer failed"));
      throw new Error("observer failed");
    },
    logger: { warn: ({ message }) => { warnings.push(message); } },
  });
  const revoked = new Error("authorization revoked");
  const authFailures: McpAuthFailedError[] = [];
  const { registrations } = buildFederatedMcpRegistrations({ session, config, nativeToolIds: new Set(),
    tools: [{ name: "inspect", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }],
    deps: { messages: federationMessages, errorCode: "EXTERNAL_MCP", scope: "workspace", permissionGate: async () => undefined,
      onAuthFailed: async ({ connectionId, error }) => {
        assert.equal(connectionId, config.connectionId);
        authFailures.push(error);
        throw revoked;
      },
    },
  });
  assert.equal(registrations.length, 1);
  await assert.rejects(registrations[0]!.handler({ executionId: "execution", principal: { id: "principal" },
    run: { id: "run" }, input: {}, signal: new AbortController().signal }), (error: unknown) => error === revoked);
  assert.equal(authFailures.length, 1);
  assert.ok(authFailures[0] instanceof McpAuthFailedError);
  assert.match(authFailures[0].message, /refused 'tools\/call' with 401/);
  assert.deepEqual(warnings, [diagnostic]);
  assert.equal(exchange.sent.filter((request) => request.message?.method === "tools/call").length, 1);
});

test("logger failure cannot replace a 401 auth error", async () => {
  const { session } = await fixture({ onAuthenticationChallenge: () => { throw new Error("hook failed"); },
    logger: { warn: () => { throw new Error("logger failed"); } },
  });
  await assert.rejects(session.callTool({ name: "inspect", arguments: {} }), McpAuthFailedError);
});

test("a hook failure still preserves auth errors when no logger was supplied", async () => {
  const { session } = await fixture({ onAuthenticationChallenge: () => Promise.reject(new Error("hook failed")) });
  await assert.rejects(session.callTool({ name: "inspect", arguments: {} }), McpAuthFailedError);
});

test("a malformed session id on a 401 cannot supersede the authentication failure", async () => {
  // An invalid session id must not supersede a known authentication failure either.
  const { session } = await fixture({ onAuthenticationChallenge: () => undefined }, { sessionId: "bad\r\nsession" });
  await assert.rejects(session.callTool({ name: "inspect", arguments: {} }), McpAuthFailedError);
});

test("a pending hook uses the remaining request budget, aborts its signal, and releases the timer", async () => {
  vi.useFakeTimers();
  onTestFinished(() => { vi.useRealTimers(); });
  const started = deferred<AbortSignal>();
  const { session } = await fixture({ onAuthenticationChallenge: (_challenge, { signal } = {}) => {
    assert.ok(signal);
    started.resolve(signal);
    return new Promise<void>(() => {});
  } }, { delayMs: 75 });
  let settled = false;
  const call = session.callTool({ name: "inspect", arguments: {} });
  const failure = assert.rejects(call, McpAuthFailedError);
  void call.then(() => { settled = true; }, () => { settled = true; });
  await vi.advanceTimersByTimeAsync(75);
  const signal = await started.promise;
  assert.equal(signal.aborted, false);
  await vi.advanceTimersByTimeAsync(24);
  assert.equal(settled, false);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(settled, true, "the hook must not start a fresh timeout after the exchange");
  await failure;
  assert.equal(signal.aborted, true);
  assert.equal(vi.getTimerCount(), 0);
});

test("caller cancellation releases a pending hook; its later rejection is consumed and logged", async () => {
  vi.useFakeTimers();
  onTestFinished(() => { vi.useRealTimers(); });
  const started = deferred<AbortSignal>();
  const hook = deferred<void>();
  const warnings: string[] = [];
  const { session } = await fixture({ onAuthenticationChallenge: (_challenge, { signal } = {}) => {
    assert.ok(signal);
    started.resolve(signal);
    return hook.promise;
  }, logger: { warn: ({ message }) => { warnings.push(message); } } });
  const caller = new AbortController();
  const removed = vi.spyOn(caller.signal, "removeEventListener");
  onTestFinished(() => removed.mockRestore());
  const failure = assert.rejects(session.callTool({ name: "inspect", arguments: {} }, { signal: caller.signal }), McpAuthFailedError);
  const signal = await started.promise;
  caller.abort();
  await failure;
  assert.equal(signal.aborted, true);
  assert.equal(vi.getTimerCount(), 0);
  assert.equal(removed.mock.calls.filter(([event]) => event === "abort").length, 1);
  hook.reject(new Error("late observer failure"));
  await vi.advanceTimersByTimeAsync(0);
  assert.deepEqual(warnings, [diagnostic]);
});

test("the default connector forwards the injected logger and challenge hook to HTTP sessions", async () => {
  const logger = { warn: () => undefined };
  const onAuthenticationChallenge = () => undefined;
  let connected = false;
  const connect = createDefaultConnect({ resolver: IDENTITY_STDIO_LAUNCH_RESOLVER, clientInfo, messages: federationMessages,
    bearerToken: () => undefined }, { logger, onAuthenticationChallenge,
    connectHttp: async (_deps, options) => {
      assert.equal(options?.logger, logger);
      assert.equal(options?.onAuthenticationChallenge, onAuthenticationChallenge);
      connected = true;
      return { listTools: async () => [], callTool: async () => ({}), close: async () => undefined };
    },
  });
  await connect({ connection: { config, launch: spec } });
  assert.equal(connected, true);
});
