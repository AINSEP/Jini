import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { SiteShareRegistry, newShareIdentity, SHARE_TOKEN, SHARE_TOKEN_ALPHABET, SHARE_TOKEN_LENGTH, type SiteShareRecord } from "../share-registry.js";

/** A neutral host: `.pkg.zip` artifacts, file names `<stem>.pkg.zip`, a 16-byte archive cap. */
const SHARE_FILE = /^[a-z0-9-]{1,20}\.pkg\.zip$/;
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
function registry(over: { maxArchiveBytes?: number } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "share-registry-"));
  dirs.push(directory);
  return new SiteShareRegistry({ directory, host: { artifactSuffix: ".pkg.zip", shareFile: SHARE_FILE, maxArchiveBytes: over.maxArchiveBytes ?? 16 } });
}
function row(over: Partial<SiteShareRecord> = {}): SiteShareRecord {
  const { shareId, token } = newShareIdentity({});
  return { shareId, token, site: "ws", file: "site.pkg.zip", bytes: 1, sha256: "x", url: null, status: "active", createdAt: "2026-01-01T00:00:00.000Z", revokedAt: null, ...over };
}

describe("share identity", () => {
  it("mints a UUID share id and a token of exactly SHARE_TOKEN_LENGTH letters from the alphabet", () => {
    const { shareId, token } = newShareIdentity({});
    expect(shareId).toMatch(/^[0-9a-f-]{36}$/);
    expect(token).toHaveLength(SHARE_TOKEN_LENGTH);
    expect([...token].every(c => SHARE_TOKEN_ALPHABET.includes(c))).toBe(true);
    expect(SHARE_TOKEN.test(token)).toBe(true);
    expect(SHARE_TOKEN.test("a".repeat(SHARE_TOKEN_LENGTH - 1))).toBe(false);
    expect(SHARE_TOKEN.test("1".repeat(SHARE_TOKEN_LENGTH))).toBe(false);
  });
});

describe("site share registry host injection", () => {
  it("names the private artifact with the injected suffix", () => {
    const r = registry(); const { shareId } = newShareIdentity({});
    expect(r.artifactPath({ shareId })).toBe(path.join(r.directory, `${shareId}.pkg.zip`));
  });

  it("serves a token only with a file matching the injected shape, and only while active and acknowledged", async () => {
    const r = registry(); const a = row();
    await r.put({ record: a });
    expect((await r.findToken({ token: a.token, file: "site.pkg.zip" }))?.shareId).toBe(a.shareId);
    expect(await r.findToken({ token: a.token, file: "site.other.zip" })).toBeNull();
    expect(await r.findToken({ token: a.token, file: "other.pkg.zip" })).toBeNull();
    const odd = row({ file: "odd-name.zip" }); await r.put({ record: odd });
    expect(await r.findToken({ token: odd.token, file: "odd-name.zip" })).toBeNull();
    const held = row({ needsAcknowledgement: true }); await r.put({ record: held });
    expect(await r.findToken({ token: held.token, file: "site.pkg.zip" })).toBeNull();
  });

  it("refuses a record whose file does not match the injected shape's token claim, reusing a token only for its own record", async () => {
    const r = registry(); const a = row();
    await r.put({ record: a });
    await expect(r.put({ record: row({ token: a.token }) })).rejects.toMatchObject({ code: "TOKEN_EXISTS" });
    await expect(r.reserveToken({ token: "short", shareId: a.shareId })).rejects.toMatchObject({ code: "INVALID_INPUT", message: "Invalid share token." });
  });

  it("enforces the injected archive cap before writing, then keeps exactly the bytes it was given", async () => {
    const r = registry(); const { shareId } = newShareIdentity({});
    await expect(r.writeArtifact({ shareId, bytes: Buffer.alloc(17) })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect(fs.existsSync(r.artifactPath({ shareId }))).toBe(false);
    await r.writeArtifact({ shareId, bytes: Buffer.alloc(16, 7) });
    expect((await r.readArtifact({ shareId })).equals(Buffer.alloc(16, 7))).toBe(true);
    await r.deleteArtifact({ shareId });
    await r.deleteArtifact({ shareId });
    expect(fs.existsSync(r.artifactPath({ shareId }))).toBe(false);
  });

  it("revokes with a permanent tombstone scoped to its site, so a re-put cannot resurrect access", async () => {
    const r = registry(); const a = row();
    await r.put({ record: a });
    expect(await r.disable({ shareId: a.shareId, site: "other" })).toBeNull();
    const revoked = await r.disable({ shareId: a.shareId, site: "ws" });
    expect(revoked?.status).toBe("revoked");
    expect((await r.get({ shareId: a.shareId }))?.status).toBe("revoked");
    expect(await r.findToken({ token: a.token, file: "site.pkg.zip" })).toBeNull();
    expect((await r.list({ site: "ws" })).map(x => x.shareId)).toEqual([a.shareId]);
    expect(await r.list({ site: "other" })).toEqual([]);
  });
});

it("reports an uninitialized registry and an unreserved but well-formed token as absent", async () => {
  const r = registry();
  const a = row();
  fs.rmdirSync(r.directory);
  expect(await r.list({})).toEqual([]);
  await r.put({ record: a });
  const missing = row();
  expect(await r.findToken({ token: missing.token, file: missing.file })).toBeNull();
  expect(await r.findToken({ token: a.token, file: a.file })).toEqual(a);
});

it("retries revocation without replacing its existing tombstone", async () => {
  const r = registry();
  const a = row();
  await r.put({ record: a });
  const first = await r.disable({ shareId: a.shareId, site: a.site });
  const second = await r.disable({ shareId: a.shareId, site: a.site });
  expect(first).toEqual({ ...a, status: "revoked", revokedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
  expect(second).toEqual(first);
  expect(await r.get({ shareId: a.shareId })).toEqual(first);
  expect(await r.findToken({ token: a.token, file: a.file })).toBeNull();
});
