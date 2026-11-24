import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";

/**
 * @file A parsed upstream response always carries a status line, so the proxy's "no status" guards
 * cannot be reached through a real socket. These cases drive `dev-proxy.ts` with a faked
 * `node:http` `request` that hands back a status-less response, proving each guard tears the
 * connection down instead of writing a head with an undefined status.
 */

const requestCalls: Array<{ onResponse: ((res: unknown) => void) | undefined; proxyReq: EventEmitter & { destroy: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> } }> = [];

vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http")>();
  return {
    ...actual,
    request: (_options: unknown, onResponse?: (res: unknown) => void) => {
      const proxyReq = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: vi.fn() });
      requestCalls.push({ onResponse, proxyReq });
      return proxyReq;
    },
  };
});

const { createDevProxyRequestHandler, createDevProxyUpgradeListener } = await import("../dev-proxy.js");

describe("dev-proxy against an upstream response with no status line", () => {
  test("request handler: drains the response and destroys the upstream request with an error, never writing a head", () => {
    const handler = createDevProxyRequestHandler({ devProxyUrl: "http://127.0.0.1:1", basePath: "/admin" });
    const req = { method: "GET", headers: {}, url: "/admin/", pipe: vi.fn() };
    const res = { writeHead: vi.fn() };
    handler(req as never, res as never, vi.fn());
    const call = requestCalls.at(-1);
    assert.ok(call?.onResponse);
    const proxyRes = { statusCode: undefined, headers: {}, resume: vi.fn(), pipe: vi.fn() };
    call.onResponse(proxyRes);
    expect(proxyRes.resume).toHaveBeenCalledOnce();
    expect(call.proxyReq.destroy).toHaveBeenCalledWith(new Error("admin dev proxy response has no status code"));
    expect(res.writeHead).not.toHaveBeenCalled();
    expect(proxyRes.pipe).not.toHaveBeenCalled();
  });

  test("upgrade listener: destroys both sockets (client with an error) and writes nothing to the client", () => {
    const listener = createDevProxyUpgradeListener({ devProxyUrl: "http://127.0.0.1:1", basePath: "/admin" });
    const clientSocket = { destroy: vi.fn(), write: vi.fn(), on: vi.fn(), pipe: vi.fn() };
    listener({ url: "/admin/?token=abc", method: "GET", headers: {} } as never, clientSocket as never, Buffer.alloc(0));
    const call = requestCalls.at(-1);
    assert.ok(call);
    const proxySocket = { destroy: vi.fn(), write: vi.fn(), pipe: vi.fn() };
    call.proxyReq.emit("upgrade", { statusCode: undefined, statusMessage: undefined, rawHeaders: [] }, proxySocket, Buffer.alloc(0));
    expect(proxySocket.destroy).toHaveBeenCalledOnce();
    expect(clientSocket.destroy).toHaveBeenCalledWith(new Error("admin dev proxy upgrade response has no status line"));
    expect(clientSocket.write).not.toHaveBeenCalled();
  });
});
