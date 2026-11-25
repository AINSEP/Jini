import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactStorePort } from "@jini-ai/core/contracts/site/devops-deploy";
import { SiteShareRegistry, newShareIdentity } from "../share-registry.js";
import { createSiteShareService, type ShareServiceHost } from "../share-service.js";
import { isShareExpired, shareExpiresAt, type ShareExpiryHost } from "../share-expiry.js";
import { createSiteShareBackend, type SiteShareHost } from "../share-backend.js";
import { SiteShareRefusal } from "../share-refusal.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-01T00:00:00.000Z");
const EXPIRY: ShareExpiryHost = {
  choices: [7, 30, 90],
  copy: { choices: "7, 30 or 90 days, or never.", notHostedHere: "Only own-folder links can expire.", remote: ({ provider }) => `${provider} links cannot expire.` },
  expiredMessage: ({ row }) => `Expired on ${row.expiresAt?.slice(0, 10) ?? "?"}.`,
};
const HOST: ShareServiceHost = { shareFile: /^[a-z0-9][a-z0-9-]{0,79}\.pkg\.zip$/, artifactSuffix: ".pkg.zip", ownFolderProvider: "local-fs", expiry: EXPIRY };
const service = createSiteShareService({ host: HOST });
const isOwnFolder = ({ storage }: { storage: { provider: string; binding?: string } }) => service.isOwnShareFolder({ storage });
const noStore = {} as ArtifactStorePort;
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function registry(clock: { now: number }): SiteShareRegistry {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "share-expiry-"));
  dirs.push(directory);
  return new SiteShareRegistry({ directory, host: { artifactSuffix: HOST.artifactSuffix, shareFile: HOST.shareFile, maxArchiveBytes: 1024 } }, { now: () => clock.now });
}
const refusal = (code: string, message?: string) => (error: unknown) => error instanceof SiteShareRefusal && error.code === code && (message === undefined || error.message === message);

describe("share expiry policy", () => {
  it("Never is the default and is accepted for any destination", () => {
    expect(shareExpiresAt({ days: null, now: NOW, destination: undefined, expiry: EXPIRY, ownFolderProvider: "local-fs", isOwnFolder })).toBeNull();
  });
  it("records now + days from the injected clock for an own-folder destination", () => {
    expect(shareExpiresAt({ days: 7, now: NOW, destination: { provider: "local-fs", binding: "/srv/shares" }, expiry: EXPIRY, ownFolderProvider: "local-fs", isOwnFolder })).toBe(new Date(NOW + 7 * DAY).toISOString());
  });
  it("refuses a day count the host does not offer, in the host's words", () => {
    expect(() => shareExpiresAt({ days: 8, now: NOW, destination: { provider: "local-fs", binding: "/srv" }, expiry: EXPIRY, ownFolderProvider: "local-fs", isOwnFolder })).toThrow(EXPIRY.copy.choices);
  });
  it("refuses a date for a remote provider, an unbound own provider, or no destination", () => {
    const at = (destination: { provider: string; binding?: string } | undefined) => () => shareExpiresAt({ days: 30, now: NOW, destination, expiry: EXPIRY, ownFolderProvider: "local-fs", isOwnFolder });
    expect(at({ provider: "s3" })).toThrow("s3 links cannot expire.");
    expect(at({ provider: "local-fs", binding: "https://peer.example" })).toThrow(EXPIRY.copy.notHostedHere);
    expect(at(undefined)).toThrow(EXPIRY.copy.notHostedHere);
  });
  it("absent expiry never expires; an unparseable one fails closed for serving", () => {
    expect(isShareExpired({ row: {}, now: NOW })).toBe(false);
    expect(isShareExpired({ row: { expiresAt: null }, now: NOW })).toBe(false);
    expect(isShareExpired({ row: { expiresAt: "garbage" }, now: NOW })).toBe(true);
    expect(isShareExpired({ row: { expiresAt: new Date(NOW + 1).toISOString() }, now: NOW })).toBe(false);
    expect(isShareExpired({ row: { expiresAt: new Date(NOW).toISOString() }, now: NOW })).toBe(true);
  });
});

describe("registry and service expiry", () => {
  it("stops the public link at its own date using the injected clock, and deletes nothing", async () => {
    const clock = { now: NOW };
    const reg = registry(clock);
    const expiresAt = new Date(NOW + 7 * DAY).toISOString();
    const row = await service.receiveSiteShareArtifact({ registry: reg, site: "s", token: newShareIdentity({}).token, file: "site.pkg.zip", archive: Buffer.from("zip") }, { expiresAt, storage: { provider: "local-fs", key: "k", binding: reg.directory } });
    expect(row.expiresAt).toBe(expiresAt);
    expect(await reg.findToken({ token: row.token, file: row.file })).not.toBeNull();
    clock.now = NOW + 7 * DAY;
    expect(await reg.findToken({ token: row.token, file: row.file })).toBeNull();
    expect(fs.existsSync(reg.artifactPath(row))).toBe(true);
  });
  it("refuses a date for a non-own-folder delivery before anything is written", async () => {
    const reg = registry({ now: NOW });
    await expect(service.createSiteShare({ registry: reg, site: "s", name: "site", archive: Buffer.from("zip") }, { expiresAt: new Date(NOW + DAY).toISOString(), delivery: { provider: "s3", store: noStore } })).rejects.toSatisfy(refusal("INVALID_INPUT", "s3 links cannot expire."));
    expect(await reg.list({})).toEqual([]);
  });
  it("the expiry tombstone is permanent and create-only; revoked outranks expired; acknowledge answers the host message", async () => {
    const reg = registry({ now: NOW });
    const row = await service.receiveSiteShareArtifact({ registry: reg, site: "s", token: newShareIdentity({}).token, file: "site.pkg.zip", archive: Buffer.from("zip") }, { expiresAt: "2026-11-08T00:00:00.000Z" });
    await reg.markExpired({ shareId: row.shareId, expiresAt: "2026-11-08T00:00:00.000Z" });
    await reg.markExpired({ shareId: row.shareId, expiresAt: "ignored" });
    expect(fs.readFileSync(path.join(reg.directory, `${row.shareId}.expired`), "utf8")).toBe("2026-11-08T00:00:00.000Z");
    await reg.put({ record: { ...row, status: "active" } });
    expect((await reg.get({ shareId: row.shareId }))?.status).toBe("expired");
    await expect(service.acknowledgeSiteShare({ registry: reg, site: "s", shareId: row.shareId })).rejects.toSatisfy(refusal("EXPIRED", "Expired on 2026-11-08."));
    expect(service.shareExpiredMessage({ row })).toBe("Expired on 2026-11-08.");
    await reg.disable({ shareId: row.shareId, site: "s" });
    expect((await reg.get({ shareId: row.shareId }))?.status).toBe("revoked");
  });
});

describe("backend expiry", () => {
  const unused = (): never => { throw new Error("unused"); };
  function backend(delivery: () => Promise<unknown>, created: unknown[]) {
    const host: SiteShareHost = { redact: t => t, isClosedFailure: () => false, noThemeId: "none", zipOnlyMessage: "ZIP only.", downloadUrl: ({ shareId }) => `/d/${shareId}`, appVersionOf: () => "1",
      checkShareLimits: () => undefined, newShareIdentity: () => ({ shareId: "share-new", token: "TOKENTOKENTOKENB" }), allocateStaticExportThemes: () => [], parseStaticExportInput: () => ({}),
      captureStaticSite: unused, buildShareZip: async () => Buffer.from("zip"), buildStaticSiteZip: unused, acknowledgeSiteShare: unused, revokeSiteShare: unused,
      createSiteShare: async (_required, optional) => { created.push(optional.expiresAt); return { shareId: "share-new", token: "T", site: "a", file: "f", bytes: 1, sha256: "x", url: null, status: "active", createdAt: "c", revokedAt: null, ...(optional.expiresAt ? { expiresAt: optional.expiresAt } : {}) }; },
      isOwnShareFolder: ({ storage }) => storage.provider === "local-fs" && storage.binding === "/srv", ownFolderProvider: "local-fs", expiry: EXPIRY };
    return createSiteShareBackend({ registry: { get: async () => undefined, list: async () => [] }, site: "a", zip: {}, delivery, ownerPrincipalId: "owner",
      prepare: async () => ({ files: [], bufferedFiles: [], scopeNotes: {}, totalBytes: 0, site: { folderName: "a" } }), host }, { now: () => NOW });
  }
  it("offers the host's day choices only while new exports land in the own folder", async () => {
    expect(await backend(async () => ({ provider: "local-fs", binding: "/srv" }), []).expiryChoices({})).toEqual([7, 30, 90]);
    expect(await backend(async () => ({ provider: "s3" }), []).expiryChoices({})).toEqual([]);
    expect(await backend(async () => { throw new Error("broken"); }, []).expiryChoices({})).toEqual([]);
  });
  it("records the owner's choice from the injected clock, and refuses a remote destination before any job", async () => {
    const created: unknown[] = [];
    await backend(async () => ({ provider: "local-fs", binding: "/srv" }), created).create({ principalId: "owner", signal: new AbortController().signal, expiresInDays: 30 }, { waitMs: 1000 });
    expect(created).toEqual([new Date(NOW + 30 * DAY).toISOString()]);
    const remote: unknown[] = [];
    await expect(backend(async () => ({ provider: "s3" }), remote).create({ principalId: "owner", signal: new AbortController().signal, expiresInDays: 7 })).rejects.toSatisfy(refusal("INVALID_INPUT", "s3 links cannot expire."));
    expect(remote).toEqual([]);
  });
});
