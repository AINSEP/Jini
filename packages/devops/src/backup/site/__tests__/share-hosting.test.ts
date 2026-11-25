import { describe, it, expect } from "vitest";
import { createShareHosting, type ShareHostingRegistry, type SharePeerDeps } from "../share-hosting.js";
import { SiteShareRefusal } from "../share-refusal.js";

/** A neutral host: 4-letter tokens, `.pkg.zip` artifacts, its own provider id and origin setting. */
const KEY = "_share/abcd/site.pkg.zip";
const BYTES = new TextEncoder().encode("archive");
const SETTING = "HOST_PUBLIC_ORIGIN";
const PROVIDER = "host-server";
const PEER_BASE = "https://peer.example.test";

type Row = { token: string; file: string; shareId: string; site: string };
function fixture(rows: Row[] = [], existing: { site: string; sha256: string } | null = null) {
  const calls: string[] = [];
  const registry: ShareHostingRegistry = {
    directory: "/shares",
    findToken: async () => existing,
    list: async () => rows,
    disable: async ({ shareId }) => { calls.push(`disable:${shareId}`); },
    deleteArtifact: async ({ shareId }) => { calls.push(`delete:${shareId}`); },
  };
  const peerCalls: { method: string; path: string; archive?: Uint8Array | undefined }[] = [];
  let peerFailure: { peerStatus: number } | undefined;
  const hosting = createShareHosting<ShareHostingRegistry, SharePeerDeps>({
    callPeer: async ({ request }) => { peerCalls.push({ method: request.method, path: request.path, archive: request.archive }); if (peerFailure) throw Object.assign(new Error("peer"), peerFailure); },
    peerUrl: ({ baseUrl, path }) => `${baseUrl}${path}`,
    receiveArtifact: async ({ token, file }) => { calls.push(`receive:${token}/${file}`); },
    tokenPattern: "[A-Za-z]{4}",
    artifactFilePattern: "[a-z0-9-]+\\.pkg\\.zip",
    serverProvider: PROVIDER,
    publicOriginSetting: SETTING,
  });
  return { registry, calls, peerCalls, hosting, failPeer: (status: number) => { peerFailure = { peerStatus: status }; } };
}
const peer: SharePeerDeps = { credential: { baseUrl: PEER_BASE, remoteWorkspaceId: "ws/1" } };
const attachment = (bytes: number, over: Record<string, string> = {}) => new Response(null, { status: 200, headers: { "content-length": String(bytes), "cache-control": "no-store", "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow", "content-disposition": "attachment; filename=x", ...over } });
function http(response: () => Response) {
  const sent: { headers: unknown; redirect: unknown }[] = [];
  return { sent, http: { send: async (input: { request: { headers: unknown } }, options: { redirect: unknown }) => { sent.push({ headers: input.request.headers, redirect: options.redirect }); return response(); } } as never };
}
const refusal = (code: string) => (error: unknown) => error instanceof SiteShareRefusal && error.code === code;

describe("runtime share delivery", () => {
  it.each(["http://share.example.test", "https://share.example.test/path", "https://user:pw@share.example.test", "https://share.example.test/?q=1", "https://share.example.test/#h", "not a url"])("refuses %s, naming the injected setting", origin => {
    const { hosting, registry } = fixture();
    expect(() => hosting.createRuntimeShareDelivery({ registry, site: "ws", publicOrigin: origin, http: http(() => attachment(1)).http })).toThrow(expect.objectContaining({ code: "STORAGE_SETUP", message: `${SETTING} must be a public HTTPS origin without a path or credentials.` }));
  });

  it("binds the delivery to the registry directory under the injected provider and serves artifacts from the origin", async () => {
    const { hosting, registry, calls } = fixture();
    const delivery = hosting.createRuntimeShareDelivery({ registry, site: "ws", publicOrigin: "https://share.example.test", http: http(() => attachment(1)).http });
    expect({ provider: delivery.provider, binding: delivery.binding }).toEqual({ provider: PROVIDER, binding: "/shares" });
    expect(await delivery.store.upload({ key: KEY, bytes: BYTES, headers: {} })).toEqual({ url: `https://share.example.test/${KEY}` });
    expect(calls).toEqual(["receive:abcd/site.pkg.zip"]);
  });

  it("does not receive an identical artifact twice, and refuses a token that names different bytes or another site", async () => {
    const sha = "d1f5ea9b7a6c0b5ee4e8d6d4f1e1ab9e5f2d3c4b5a69788796a5b4c3d2e1f001";
    const same = fixture([], { site: "ws", sha256: "no" });
    const delivery = (f: ReturnType<typeof fixture>, site = "ws") => f.hosting.createRuntimeShareDelivery({ registry: f.registry, site, publicOrigin: "https://share.example.test", http: http(() => attachment(1)).http });
    await expect(delivery(same).store.upload({ key: KEY, bytes: BYTES, headers: {} })).rejects.toSatisfy(refusal("ARTIFACT_CHANGED"));
    const other = fixture([], { site: "other", sha256: sha });
    await expect(delivery(other).store.upload({ key: KEY, bytes: BYTES, headers: {} })).rejects.toSatisfy(refusal("ARTIFACT_CHANGED"));
    const { createHash } = await import("node:crypto");
    const matching = fixture([], { site: "ws", sha256: createHash("sha256").update(BYTES).digest("hex") });
    await delivery(matching).store.upload({ key: KEY, bytes: BYTES, headers: {} });
    expect(matching.calls).toEqual([]);
  });

  it("refuses a key outside the injected token and file shapes before touching the registry", async () => {
    const { hosting, registry, calls } = fixture();
    const delivery = hosting.createRuntimeShareDelivery({ registry, site: "ws", publicOrigin: "https://share.example.test", http: http(() => attachment(1)).http });
    for (const key of ["bad", "_share/abc/site.pkg.zip", "_share/abcd/site.other.zip", "_share/abcd/site.pkg.zip/x"]) {
      await expect(delivery.store.upload({ key, bytes: BYTES, headers: {} })).rejects.toSatisfy(refusal("INVALID_INPUT"));
      await expect(delivery.store.delete({ key })).rejects.toSatisfy(refusal("INVALID_INPUT"));
    }
    expect(calls).toEqual([]);
  });

  it("deletes by disabling then removing only the row for that key, and ignores an unknown key", async () => {
    const rows = [{ token: "abcd", file: "site.pkg.zip", shareId: "s1", site: "ws" }, { token: "efgh", file: "site.pkg.zip", shareId: "s2", site: "ws" }];
    const { hosting, registry, calls } = fixture(rows);
    const delivery = hosting.createRuntimeShareDelivery({ registry, site: "ws", publicOrigin: "https://share.example.test", http: http(() => attachment(1)).http });
    await delivery.store.delete({ key: "_share/zzzz/site.pkg.zip" });
    expect(calls).toEqual([]);
    await delivery.store.delete({ key: KEY });
    expect(calls).toEqual(["disable:s1", "delete:s1"]);
  });
});

describe("peer share delivery", () => {
  it("uploads with PUT to the workspace-scoped artifact path and returns the peer url", async () => {
    const { hosting, peerCalls } = fixture();
    const delivery = hosting.createPeerShareDelivery({ peer, http: http(() => attachment(1)).http });
    expect({ provider: delivery.provider, binding: delivery.binding }).toEqual({ provider: PROVIDER, binding: PEER_BASE });
    expect(await delivery.store.upload({ key: KEY, bytes: BYTES, headers: {} })).toEqual({ url: `${PEER_BASE}/${KEY}` });
    expect(peerCalls).toEqual([{ method: "PUT", path: "/api/admin/v1/workspaces/ws%2F1/site-shares/artifacts/abcd/site.pkg.zip", archive: BYTES }]);
  });

  it("treats a 404 on delete as already cleaned up but rethrows any other peer failure", async () => {
    const missing = fixture(); missing.failPeer(404);
    await expect(missing.hosting.createPeerShareDelivery({ peer, http: http(() => attachment(1)).http }).store.delete({ key: KEY })).resolves.toBeUndefined();
    const broken = fixture(); broken.failPeer(500);
    await expect(broken.hosting.createPeerShareDelivery({ peer, http: http(() => attachment(1)).http }).store.delete({ key: KEY })).rejects.toMatchObject({ peerStatus: 500 });
    expect(broken.peerCalls[0]).toMatchObject({ method: "DELETE" });
  });

  it("verifies anonymously: only the exact url, only a 200 no-store attachment of the exact size, never with credentials", async () => {
    const { hosting } = fixture();
    const good = http(() => attachment(7));
    const delivery = (h: { http: never }) => hosting.createPeerShareDelivery({ peer, http: h.http }).store;
    const url = `${PEER_BASE}/${KEY}`;
    expect(await delivery(good).verify({ key: KEY, url, present: true, bytes: 7 })).toBe(true);
    expect(good.sent).toEqual([{ headers: {}, redirect: "error" }]);
    expect(await delivery(good).verify({ key: KEY, url: "https://elsewhere.test/x", present: true, bytes: 7 })).toBe(false);
    expect(await delivery(http(() => attachment(8))).verify({ key: KEY, url, present: true, bytes: 7 })).toBe(false);
    expect(await delivery(http(() => attachment(7, { "cache-control": "public" }))).verify({ key: KEY, url, present: true, bytes: 7 })).toBe(false);
    expect(await delivery(http(() => attachment(7, { "content-disposition": "inline" }))).verify({ key: KEY, url, present: true, bytes: 7 })).toBe(false);
    expect(await delivery(http(() => new Response(null, { status: 410 }))).verify({ key: KEY, url, present: false })).toBe(true);
    expect(await delivery(http(() => attachment(7))).verify({ key: KEY, url, present: false })).toBe(false);
  });
});

describe("delivery selection", () => {
  const object = { provider: "bucket-store", binding: "bucket-a", store: {} as never };
  const sources = (over: Record<string, unknown> = {}) => ({ peer: async () => peer, http: http(() => attachment(1)).http, objectStore: async () => object, ...over }) as never;

  it("prefers the connected peer, then the runtime delivery, then the object store", async () => {
    const { hosting } = fixture();
    expect((await hosting.resolveShareDelivery(sources()))?.binding).toBe(PEER_BASE);
    const runtime = { provider: PROVIDER, binding: "/shares", store: {} as never };
    expect(await hosting.resolveShareDelivery(sources({ peer: async () => undefined, runtime: () => runtime }))).toBe(runtime);
    expect(await hosting.resolveShareDelivery(sources({ peer: async () => { throw new Error("down"); } }))).toBe(object);
  });

  it("requires a saved binding to match the delivery's own, so a changed default never reaches another destination", async () => {
    const { hosting } = fixture();
    expect(await hosting.resolveShareDelivery(sources(), { provider: PROVIDER, binding: "https://old.example.test" })).toBeUndefined();
    expect((await hosting.resolveShareDelivery(sources(), { provider: PROVIDER, binding: PEER_BASE }))?.binding).toBe(PEER_BASE);
    expect(await hosting.resolveShareDelivery(sources(), { provider: "bucket-store", binding: "bucket-b" })).toBeUndefined();
    expect(await hosting.resolveShareDelivery(sources(), { provider: "bucket-store", binding: "bucket-a" })).toBe(object);
  });

  it("never falls back to the object store when the saved provider is the injected server provider", async () => {
    const { hosting } = fixture();
    const calls: string[] = [];
    const chosen = await hosting.resolveShareDelivery(sources({ peer: async () => undefined, objectStore: async () => { calls.push("objectStore"); return { ...object, provider: PROVIDER }; } }), { provider: PROVIDER });
    expect({ chosen, calls }).toEqual({ chosen: undefined, calls: [] });
  });

  it("reports a misconfigured runtime delivery by refusal code only, then falls back to the object store", async () => {
    const { hosting } = fixture();
    const warnings: unknown[][] = [];
    const runtime = () => { throw new SiteShareRefusal({ code: "STORAGE_SETUP", message: "https://user:secret@host" }); };
    const chosen = await hosting.resolveShareDelivery(sources({ peer: async () => undefined, runtime, logger: { warn: (...args: unknown[]) => { warnings.push(args); } } }));
    expect(chosen).toBe(object);
    expect(JSON.stringify(warnings)).toContain("STORAGE_SETUP");
    expect(JSON.stringify(warnings)).not.toContain("secret");
  });
});
