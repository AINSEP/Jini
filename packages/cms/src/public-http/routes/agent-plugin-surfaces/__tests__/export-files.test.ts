import { describe, expect, it } from "vitest";
import type { AgentPluginExport } from "@jini-ai/core/contracts/site/agent-plugins-manifest";
import { createPluginExportFilesRoute, type PluginExportFilesRouteDeps, type PluginExportOwner } from "../export-files.js";

/** @file The public plugin export-files spec: the limiter is charged per client before any catalog read, only a
 * declared stylesheet/image/script of the single enabled owner is read, every refusal or fault is the same plain
 * 404, and the answer is buffered so the host writes `Content-Length`, its ETag and a 304 as `res.send` did. */

const signal = new AbortController().signal;
type Plugin = { readonly pluginId: string; readonly root: string };
type Owner = PluginExportOwner<Plugin>;

const entry: AgentPluginExport = { styles: "components/a.css", assets: { mark: "components/mark.png", logo: "components/logo.svg", sneaky: "components/x.js", page: "components/y.html" }, scripts: ["components/widget.js", "https://assets.vendor.test/loader.js"] } as AgentPluginExport;
const owner: Owner = { enabled: true, plugin: { pluginId: "demo", root: "/pkg" }, exports: { button: entry } };

function harness({ allowed = true, owners = [owner] as readonly Owner[], body = "body" as string | Uint8Array, fault = {} as { limiter?: Error; list?: Error; read?: Error } } = {}) {
  const calls: unknown[] = [];
  const deps: PluginExportFilesRouteDeps<Owner> = {
    workspaceId: "ws-1",
    limiter: { check: async (input) => { calls.push(["check", input]); if (fault.limiter) throw fault.limiter; return allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: 42 }; } },
    source: {
      list: async (input) => { calls.push(["list", input]); if (fault.list) throw fault.list; return owners; },
      readAsset: async (input) => { calls.push(["read", input]); if (fault.read) throw fault.read; return body; },
    },
  };
  return { deps, calls };
}

const route = createPluginExportFilesRoute<Owner>({ pathPrefix: "/api/exports/v1" });

function run(deps: PluginExportFilesRouteDeps<Owner>, { facts = { clientAddress: "198.51.100.7" } as { clientAddress: string } | null, component = "button", path = "components/mark.png" } = {}) {
  return route.handle({ raw: { body: undefined, query: {}, params: { pluginId: "demo", component, 0: path }, ...(facts ? { facts } : {}) }, deps }, { signal });
}

async function wire(response: Response) {
  return { status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()).toString("utf8") };
}

const NOT_FOUND = { status: 404, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" }, body: "Not found" };
const SERVED = { "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "referrer-policy": "no-referrer", "cache-control": "public, max-age=60" };

describe("createPluginExportFilesRoute", () => {
  it("pins method, path, the request facts it reads and the buffered reply", () => {
    expect(route.method).toBe("get");
    expect(route.path).toBe("/api/exports/v1/:pluginId/:component/*");
    expect(route.requestFacts).toBe(true);
    expect(route.bufferedReply).toBe(true);
    expect("readHeaders" in route).toBe(false);
  });

  it("serves a declared file with the isolation headers, charging the client first and passing the owner's plugin and the path as given", async () => {
    const { deps, calls } = harness({ body: new Uint8Array([1, 2]) });
    const served = await run(deps);
    expect(served.status).toBe(200);
    expect(Object.fromEntries(served.headers)).toEqual({ ...SERVED, "content-type": "image/png" });
    expect([...new Uint8Array(await served.arrayBuffer())]).toEqual([1, 2]);
    expect(calls).toEqual([["check", { key: "198.51.100.7" }], ["list", { workspaceId: "ws-1" }], ["read", { plugin: owner.plugin, filename: "components/mark.png" }]]);
  });

  it("serves the stylesheet, svg and a declared package script under their own types; a text body states utf-8 as Express added", async () => {
    const cases: [string, string][] = [["components/a.css", "text/css; charset=utf-8"], ["components/logo.svg", "image/svg+xml; charset=utf-8"], ["components/widget.js", "text/javascript; charset=utf-8"]];
    for (const [path, type] of cases) {
      expect(await wire(await run(harness({ body: "x" }).deps, { path }))).toEqual({ status: 200, headers: { ...SERVED, "content-type": type }, body: "x" });
    }
  });

  it("refuses a limited client with 429, Retry-After and the html text Express defaulted to, before any catalog read", async () => {
    const { deps, calls } = harness({ allowed: false });
    expect(await wire(await run(deps))).toEqual({ status: 429, headers: { "cache-control": "no-store", "content-type": "text/html; charset=utf-8", "retry-after": "42" }, body: "Too many requests" });
    expect(calls).toEqual([["check", { key: "198.51.100.7" }]]);
  });

  it("answers the same 404, reading nothing, for an unknown, disabled, duplicated, undeclared or wrongly-typed file", async () => {
    const refused: [string, ReturnType<typeof harness>, { component?: string; path?: string }][] = [
      ["no owner", harness({ owners: [] }), {}],
      ["disabled", harness({ owners: [{ ...owner, enabled: false }] }), {}],
      ["duplicate owner", harness({ owners: [owner, owner] }), {}],
      ["other plugin", harness({ owners: [{ ...owner, plugin: { pluginId: "other", root: "/o" } }] }), {}],
      ["missing component", harness(), { component: "absent" }],
      ["undeclared file", harness(), { path: "components/other.png" }],
      ["declared html", harness(), { path: "components/y.html" }],
      ["js declared under assets", harness(), { path: "components/x.js" }],
      ["remote script", harness(), { path: "https://assets.vendor.test/loader.js" }],
      ["no extension", harness({ owners: [{ ...owner, exports: { button: { styles: "LICENSE" } as AgentPluginExport } }] }), { path: "LICENSE" }],
    ];
    for (const [name, { deps, calls }, input] of refused) {
      expect(await wire(await run(deps, input)), name).toEqual(NOT_FOUND);
      expect(calls.some((call) => (call as unknown[])[0] === "read"), name).toBe(false);
    }
  });

  it("serves a declared upper-case extension by its lower-cased type, byte bodies keeping that type untouched", async () => {
    const upper: Owner = { ...owner, exports: { button: { assets: { mark: "components/MARK.PNG" } } as AgentPluginExport } };
    expect((await run(harness({ owners: [upper], body: new Uint8Array([9]) }).deps, { path: "components/MARK.PNG" })).headers.get("content-type")).toBe("image/png");
  });

  it("hides any fault (limiter, catalog, read) behind the 404 and does no plugin I/O after a limiter fault", async () => {
    const failing = harness({ fault: { limiter: new Error("counter storage at /srv/secret") } });
    expect(await wire(await run(failing.deps))).toEqual(NOT_FOUND);
    expect(failing.calls).toHaveLength(1);
    expect(await wire(await run(harness({ fault: { list: new Error("/private/package/path") } }).deps))).toEqual(NOT_FOUND);
    expect(await wire(await run(harness({ fault: { read: new Error("/private/asset/path") } }).deps))).toEqual(NOT_FOUND);
  });

  it("fails closed with the 404 and no limiter call when the host resolved no client address", async () => {
    const { deps, calls } = harness();
    expect(await wire(await run(deps, { facts: null }))).toEqual(NOT_FOUND);
    expect(calls).toEqual([]);
  });
});
