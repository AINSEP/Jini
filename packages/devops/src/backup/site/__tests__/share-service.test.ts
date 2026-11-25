import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactStorePort } from "@jini-ai/core/contracts/site/devops-deploy";
import type { ShareDelivery } from "../share-hosting.js";
import { SiteShareRegistry } from "../share-registry.js";
import { SHARE_DOWNLOAD_HEADERS, createSiteShareService, shareFileStem, type ShareServiceHost } from "../share-service.js";

/** A neutral host: `.pkg.zip` artifacts, a `local-fs` own-folder provider. */
const HOST: ShareServiceHost = { shareFile: /^[a-z0-9][a-z0-9-]{0,79}\.pkg\.zip$/, artifactSuffix: ".pkg.zip", ownFolderProvider: "local-fs",
  expiry: { choices: [7, 30, 90], copy: { choices: "7, 30 or 90 days, or never.", notHostedHere: "Only own-folder links can expire.", remote: ({ provider }) => `${provider} links cannot expire.` },
    expiredMessage: ({ row }) => `Expired on ${row.expiresAt?.slice(0, 10) ?? "?"}.` } };
const ARCHIVE = Buffer.from("PK zip bytes");
const URL = "https://cdn.example/share.zip";
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function registry(): SiteShareRegistry {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "share-service-"));
  dirs.push(directory);
  return new SiteShareRegistry({ directory, host: { artifactSuffix: HOST.artifactSuffix, shareFile: HOST.shareFile, maxArchiveBytes: 1024 } });
}
function store(behaviour: Partial<ArtifactStorePort> = {}) {
  const calls = { uploads: [] as Parameters<ArtifactStorePort["upload"]>[0][], deletes: [] as string[], verifies: [] as Parameters<ArtifactStorePort["verify"]>[0][] };
  const port: ArtifactStorePort = {
    upload: async (required, optional) => { calls.uploads.push(required); return behaviour.upload ? behaviour.upload(required, optional) : { url: URL }; },
    delete: async (required, optional) => { calls.deletes.push(required.key); if (behaviour.delete) await behaviour.delete(required, optional); },
    verify: async (required, optional) => { calls.verifies.push(required); return behaviour.verify ? behaviour.verify(required, optional) : true; },
  };
  return { store: port, calls };
}
const delivery = (port: ArtifactStorePort, over: Partial<ShareDelivery> = {}): ShareDelivery => ({ provider: "s3", store: port, ...over });
const service = () => createSiteShareService({ host: HOST });

describe("receiveSiteShareArtifact", () => {
  for (const file of ["../x.pkg.zip", "Site.pkg.zip", "site.zip", "-site.pkg.zip"]) {
    it(`refuses the file name ${file} (the host's public shape) before reserving the token`, async () => {
      const reg = registry();
      await expect(service().receiveSiteShareArtifact({ registry: reg, site: "ws", token: "a".repeat(16), file, archive: ARCHIVE })).rejects.toMatchObject({ code: "INVALID_INPUT", message: "Invalid share file name." });
      expect(await reg.list({})).toEqual([]);
    });
  }

  it("stores the artifact with its hash, the sealed password and notices alongside the registry row", async () => {
    const reg = registry();
    const sealedPassword = { v: 1 } as never;
    const row = await service().receiveSiteShareArtifact({ registry: reg, site: "ws", token: "b".repeat(16), file: "site.pkg.zip", archive: ARCHIVE }, { storage: { provider: "s3", key: "k" }, sealedPassword, notices: ["n1"], notes: ["scope"] });
    expect(row).toMatchObject({ bytes: ARCHIVE.length, status: "active", url: null, storage: { provider: "s3", key: "k" }, hasEncryptedKeys: true, sealedPassword, notices: ["n1"], notes: ["scope"], needsAcknowledgement: false });
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await reg.get({ shareId: row.shareId }))?.sealedPassword).toEqual(sealedPassword);
  });

  it("removes an artifact the registry cannot finish writing and rethrows the write error", async () => {
    const reg = registry();
    await expect(service().receiveSiteShareArtifact({ registry: reg, site: "ws", token: "c".repeat(16), file: "site.pkg.zip", archive: Buffer.alloc(1025) })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect(await reg.list({})).toEqual([]);
  });
});

describe("shareFileStem", () => {
  for (const [name, stem] of [["My Site!", "my-site"], ["中文", "site"], ["--x--", "x"], ["a".repeat(90), "a".repeat(80)]] as const) {
    it(`files ${JSON.stringify(name).slice(0, 12)} as ${stem.slice(0, 20)}`, () => { expect(shareFileStem({ name })).toBe(stem); });
  }
});

describe("createSiteShare", () => {
  it("files a share under the host's artifact suffix and leaves a share without delivery local and URL-less", async () => {
    const row = await service().createSiteShare({ registry: registry(), site: "ws", name: "My Site", archive: ARCHIVE });
    expect([row.file, row.status, row.url, row.storage]).toEqual(["my-site.pkg.zip", "active", null, undefined]);
  });

  it("disables, deletes and refuses a share cancelled after it was received", async () => {
    const reg = registry(), fake = store(), controller = new AbortController();
    controller.abort();
    await expect(service().createSiteShare({ registry: reg, site: "ws", name: "Site", archive: ARCHIVE }, { delivery: delivery(fake.store), signal: controller.signal })).rejects.toMatchObject({ code: "CANCELLED" });
    expect((await reg.list({}))[0]?.status).toBe("revoked");
    expect(fake.calls.uploads).toEqual([]);
  });

  it("uploads with download headers, verifies anonymously and publishes the URL", async () => {
    const reg = registry(), fake = store();
    const row = await service().createSiteShare({ registry: reg, site: "ws", name: "Site", archive: ARCHIVE }, { delivery: delivery(fake.store, { binding: "bucket" }) });
    const key = `_share/${row.token}/site.pkg.zip`;
    expect(fake.calls.uploads).toEqual([{ key, bytes: ARCHIVE, headers: { ...SHARE_DOWNLOAD_HEADERS, "Content-Disposition": 'attachment; filename="site.pkg.zip"' } }]);
    expect(fake.calls.verifies).toEqual([{ key, url: URL, present: true, bytes: ARCHIVE.length }]);
    expect([row.url, row.storage]).toEqual([URL, { provider: "s3", key, binding: "bucket" }]);
    expect(await reg.get({ shareId: row.shareId })).toEqual(row);
  });

  it("purges and refuses an upload that cannot be verified anonymously", async () => {
    const reg = registry(), fake = store({ verify: async (required) => required.present === false });
    await expect(service().createSiteShare({ registry: reg, site: "ws", name: "Site", archive: ARCHIVE }, { delivery: delivery(fake.store) })).rejects.toMatchObject({ code: "DELIVERY_FAILED" });
    expect(fake.calls.deletes).toHaveLength(1);
    expect((await reg.list({}))[0]?.status).toBe("failed");
  });

  it("deletes nothing remotely after a failed delivery to the host's own share folder, but does for another binding of another provider", async () => {
    const own = store({ upload: async () => { throw new Error("down"); } });
    const reg = registry();
    await expect(service().createSiteShare({ registry: reg, site: "ws", name: "Site", archive: ARCHIVE }, { delivery: delivery(own.store, { provider: "local-fs", binding: path.resolve(reg.directory) }) })).rejects.toThrow("down");
    expect(own.calls.deletes).toEqual([]);
    const other = store({ upload: async () => { throw new Error("down"); } });
    await expect(service().createSiteShare({ registry: registry(), site: "ws", name: "Site", archive: ARCHIVE }, { delivery: delivery(other.store, { provider: "s3", binding: path.resolve(reg.directory) }) })).rejects.toThrow("down");
    expect(other.calls.deletes).toHaveLength(1);
  });
});

describe("isOwnShareFolder and revokeSiteShare", () => {
  it("is the own folder only for the host's provider with an absolute-path binding", () => {
    const { isOwnShareFolder } = service();
    expect(isOwnShareFolder({ storage: { provider: "local-fs", binding: path.resolve("/x") } })).toBe(true);
    expect(isOwnShareFolder({ storage: { provider: "local-fs", binding: "https://peer.example" } })).toBe(false);
    expect(isOwnShareFolder({ storage: { provider: "local-fs" } })).toBe(false);
    expect(isOwnShareFolder({ storage: { provider: "s3", binding: path.resolve("/x") } })).toBe(false);
  });

  it("revokes a share in the host's own folder without any delivery", async () => {
    const reg = registry();
    const row = await service().createSiteShare({ registry: reg, site: "ws", name: "Site", archive: ARCHIVE });
    await reg.put({ record: { ...row, storage: { provider: "local-fs", key: "k", binding: path.resolve(reg.directory) } } });
    expect((await service().revokeSiteShare({ registry: reg, site: "ws", shareId: row.shareId })).shareId).toBe(row.shareId);
  });

  it("needs the original delivery to revoke a share kept in another provider, and refuses an unknown share", async () => {
    const reg = registry();
    const row = await service().createSiteShare({ registry: reg, site: "ws", name: "Site", archive: ARCHIVE });
    await reg.put({ record: { ...row, storage: { provider: "s3", key: "k" } } });
    await expect(service().revokeSiteShare({ registry: reg, site: "ws", shareId: row.shareId })).rejects.toMatchObject({ code: "DELETE_FAILED" });
    await expect(service().revokeSiteShare({ registry: reg, site: "ws", shareId: "00000000-0000-0000-0000-000000000000" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("acknowledgeSiteShare", () => {
  it("persists consent before delivering a warned export's original storage", async () => {
    const reg = registry(), fake = store();
    const row = await service().createSiteShare({ registry: reg, site: "ws", name: "Site", archive: ARCHIVE }, { delivery: delivery(fake.store), credentialWarnings: [{ path: "a", kind: "k" } as never] });
    expect(row.needsAcknowledgement).toBe(true);
    expect(fake.calls.uploads).toEqual([]);
    const acknowledged = await service().acknowledgeSiteShare({ registry: reg, site: "ws", shareId: row.shareId }, { delivery: delivery(fake.store) });
    expect(acknowledged.needsAcknowledgement).toBe(false);
    expect((await reg.get({ shareId: row.shareId }))?.needsAcknowledgement).toBe(false);
  });
});
