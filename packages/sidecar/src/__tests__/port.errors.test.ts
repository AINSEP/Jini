import type { Server } from "node:net";

import { beforeEach, describe, expect, it, vi } from "vitest";

/** listenOnPort/closeServer replaced by DI-style module fakes so every error SHAPE the forced-port
 *  path can see (string, null, codeless Error, numeric code) is pinned, and the probe server is
 *  proven closed. Real-socket behaviour stays covered by index.test.ts / audit-regressions. */
const net = vi.hoisted(() => ({ listenOnPort: vi.fn(), closeServer: vi.fn(async () => undefined) }));
vi.mock("../net.js", () => net);

const { allocatePort } = await import("../port.js");

beforeEach(() => {
  net.listenOnPort.mockReset();
  net.closeServer.mockClear();
});

describe("allocatePort forced-port error formatting", () => {
  it.each([
    ["code string", Object.assign(new Error("in use"), { code: "EADDRINUSE" }), "EADDRINUSE"],
    ["numeric code", Object.assign(new Error("n"), { code: 13 }), "13"],
    ["null code falls back to message", Object.assign(new Error("no code here"), { code: null }), "no code here"],
    ["codeless Error", new Error("plain failure"), "plain failure"],
    ["thrown string", "string failure", "string failure"],
    ["thrown null", null, "null"],
    ["object with code only", { code: "EACCES" }, "EACCES"],
  ])("%s → '(%s)' in the message, port not reserved", async (_label, thrown, detail) => {
    net.listenOnPort.mockRejectedValueOnce(thrown);
    const reserved = new Set<number>();
    await expect(allocatePort({}, { port: 4100, label: "web", reserved })).rejects.toThrow(`forced web port 4100 is not available (${detail})`);
    expect(reserved.size).toBe(0);
    expect(net.closeServer).not.toHaveBeenCalled();
  });

  it("closes the probe server after a successful forced bind and reserves the port", async () => {
    const server = { address: () => null } as unknown as Server;
    net.listenOnPort.mockResolvedValueOnce(server);
    const reserved = new Set<number>();
    await expect(allocatePort({}, { port: "65535", host: "::1", reserved })).resolves.toEqual({ port: 65535, source: "forced" });
    expect(net.listenOnPort).toHaveBeenCalledWith(65535, "::1");
    expect(net.closeServer).toHaveBeenCalledWith(server);
    expect([...reserved]).toEqual([65535]);
  });

  it.each([65536, -1, 1.5, "abc", "80x"])("refuses out-of-range/non-integer port %j before binding", async (port) => {
    await expect(allocatePort({}, { port, label: "api" })).rejects.toThrow("api port must be an integer between 1 and 65535");
    expect(net.listenOnPort).not.toHaveBeenCalled();
  });

  it.each([null, undefined, ""])("treats %j as 'no forced port' (dynamic)", async (port) => {
    net.listenOnPort.mockResolvedValueOnce({ address: () => ({ port: 5555 }) } as unknown as Server);
    await expect(allocatePort({}, { port: port as never })).resolves.toEqual({ port: 5555, source: "dynamic" });
    expect(net.listenOnPort).toHaveBeenCalledWith(0, "127.0.0.1");
  });

  it.each([null, "/tmp/pipe"])("dynamic probe refuses a non-TCP address (%j) and still closes the server", async (address) => {
    const server = { address: () => address } as unknown as Server;
    net.listenOnPort.mockResolvedValueOnce(server);
    await expect(allocatePort({}, {})).rejects.toThrow("failed to probe an ephemeral port");
    expect(net.closeServer).toHaveBeenCalledWith(server);
  });
});
