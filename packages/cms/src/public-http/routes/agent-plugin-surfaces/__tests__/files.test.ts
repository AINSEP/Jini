import { describe, expect, it } from "vitest";
import { createAdminSurfaceFilesRoute, type AdminSurfaceFilesRouteDeps } from "../files.js";

/** @file The public admin-surface files spec: the limiter is charged per client before any lookup, only
 * an admitted surface's declared file is read, every refusal or fault is the same plain 404, and the
 * answer is buffered so the host writes `Content-Length`, its ETag and a 304 as `res.send` did. */

const signal = new AbortController().signal;
type Surface = { readonly id: string };

function harness({ allowed = true, surface = { id: "s" } as Surface | null, file = { ok: true as const, body: "<p>✓</p>", headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame": "kept" } as Readonly<Record<string, string>> } as Awaited<ReturnType<AdminSurfaceFilesRouteDeps<Surface>["readSurfaceFile"]>>, fault = undefined as Error | undefined } = {}) {
  const calls: unknown[] = [];
  const deps: AdminSurfaceFilesRouteDeps<Surface> = {
    limiter: { check: async (input) => { calls.push(["check", input]); if (fault) throw fault; return allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: 42 }; } },
    findSurface: async (input) => { calls.push(["find", input]); return surface ?? undefined; },
    readSurfaceFile: async (input) => { calls.push(["read", input]); return file; },
  };
  return { deps, calls };
}

const route = createAdminSurfaceFilesRoute<Surface>({ pathPrefix: "/files/v1" });

function run(deps: AdminSurfaceFilesRouteDeps<Surface>, { facts = { clientAddress: "198.51.100.7" } as { clientAddress: string } | null, tail = "app/index.html" } = {}) {
  return route.handle({ raw: { body: undefined, query: {}, params: { pluginId: "p1", surfaceId: "settings", 0: tail }, ...(facts ? { facts } : {}) }, deps }, { signal });
}

async function wire(response: Response) {
  return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
}

const NOT_FOUND = { status: 404, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" }, body: "Not found" };

describe("createAdminSurfaceFilesRoute", () => {
  it("pins method, path, the request facts it reads and the buffered reply", () => {
    expect(route.method).toBe("get");
    expect(route.path).toBe("/files/v1/:pluginId/:surfaceId/*");
    expect(route.requestFacts).toBe(true);
    expect(route.bufferedReply).toBe(true);
    expect("readHeaders" in route).toBe(false);
  });

  it("serves the declared file with its headers, charging the client first and passing ids and path as given", async () => {
    const { deps, calls } = harness();
    expect(await wire(await run(deps))).toEqual({ status: 200, headers: { "content-type": "text/html; charset=utf-8", "x-frame": "kept" }, body: "<p>✓</p>" });
    expect(calls).toEqual([
      ["check", { key: "198.51.100.7" }],
      ["find", { pluginId: "p1", surfaceId: "settings" }],
      ["read", { surface: { id: "s" }, path: "app/index.html" }],
    ]);
  });

  it("states the utf-8 charset Express added to a text body: appended when absent, replacing another", async () => {
    for (const [type, expected] of [["application/octet-stream", "application/octet-stream; charset=utf-8"], ["text/css; charset=ISO-8859-1", "text/css; charset=utf-8"], [undefined, "text/html; charset=utf-8"]] as const) {
      const { deps } = harness({ file: { ok: true, body: "x", headers: type ? { "Content-Type": type } : {} } });
      expect((await run(deps)).headers.get("content-type")).toBe(expected);
    }
  });

  it("refuses a limited client with 429 and Retry-After, before any lookup", async () => {
    const { deps, calls } = harness({ allowed: false });
    expect(await wire(await run(deps))).toEqual({ status: 429, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8", "retry-after": "42", "x-content-type-options": "nosniff" }, body: "Too many requests" });
    expect(calls).toEqual([["check", { key: "198.51.100.7" }]]);
  });

  it("answers the same 404 for an unknown surface without reading, and for an undeclared file", async () => {
    const unknown = harness({ surface: null });
    expect(await wire(await run(unknown.deps))).toEqual(NOT_FOUND);
    expect(unknown.calls.map((call) => (call as unknown[])[0])).toEqual(["check", "find"]);
    expect(await wire(await run(harness({ file: { ok: false } }).deps))).toEqual(NOT_FOUND);
  });

  it("hides any fault (limiter, containment refusal) behind the 404 and does no plugin I/O after a limiter fault", async () => {
    const failing = harness({ fault: new Error("counter storage at /srv/secret") });
    expect(await wire(await run(failing.deps))).toEqual(NOT_FOUND);
    expect(failing.calls).toHaveLength(1);
    const { deps } = harness();
    expect(await wire(await run({ ...deps, readSurfaceFile: async () => { throw new Error("outside /srv/plugins"); } }))).toEqual(NOT_FOUND);
  });

  it("fails closed with the 404 and no limiter call when the host resolved no client address", async () => {
    const { deps, calls } = harness();
    expect(await wire(await run(deps, { facts: null }))).toEqual(NOT_FOUND);
    expect(calls).toEqual([]);
  });

  it("passes the empty wildcard tail through as an empty path", async () => {
    const { deps, calls } = harness({ file: { ok: false } });
    await run(deps, { tail: "" });
    expect(calls[2]).toEqual(["read", { surface: { id: "s" }, path: "" }]);
  });
});
