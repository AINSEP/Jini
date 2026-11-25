import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import type { SiteImportRecord } from "@jini-ai/core/contracts/site/site-import-history";
import { SiteImportRegistry, importSourceDigest, withoutQuery, type SiteImportUpload } from "../import-registry.js";
import { nodePayload } from "./node-payload.fixture.js";
import { SiteShareRefusal } from "../share-refusal.js";

const ID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const HOUR = 3_600_000;
const dirs: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

/** Plain-fs payload ports and a recording lock: the registry is exercised against injected deps only. */
function setup(log?: (line: string, error: unknown) => void) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "registry-"));
  dirs.push(directory);
  const writes: string[] = [];
  const locks: { lockPath: string; staleMs: number }[] = [];
  const registry = new SiteImportRegistry({ directory, payload: nodePayload({ writes, locks }) }, log ? { log } : {});
  fs.mkdirSync(registry.payloadDirectory, { mode: 0o700 });
  return { registry, directory, writes, locks };
}
const record = (over: Partial<SiteImportRecord> = {}): SiteImportRecord => ({ importId: ID_A, principalId: "owner", source: { url: "https://share.example.test/s/token?k=1" }, newSiteId: null, newSiteName: null, displayName: "Site", status: "verifying", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: Date.now() + HOUR, ...over });
const upload = (over: Partial<SiteImportUpload> = {}): SiteImportUpload => ({ uploadId: ID_B, principalId: "owner", createdAt: Date.now(), ...over });
const mode = (file: string) => fs.statSync(file).mode & 0o777;

describe("site import registry (injected durable store)", () => {
  it("creates its directory private and resolved to an absolute path", () => {
    const { registry, directory } = setup();
    expect({ dir: registry.directory, mode: mode(directory) }).toEqual({ dir: path.resolve(directory), mode: 0o700 });
  });

  it("refuses an id that is not a lowercase UUID before touching disk", () => {
    const { registry } = setup();
    for (const id of ["../x", ID_A.toUpperCase(), `${ID_A}x`, ""]) {
      expect(() => registry.get({ importId: id, principalId: "owner" })).toThrow(expect.objectContaining({ code: "INVALID_INPUT", message: "Invalid import or upload id." }));
    }
  });

  it("stores a record owner-only and shows it only to its principal", () => {
    const { registry, directory } = setup();
    registry.put({ row: record() });
    expect(mode(path.join(directory, `${ID_A}.json`))).toBe(0o600);
    expect(registry.get({ importId: ID_A, principalId: "owner" }).importId).toBe(ID_A);
    expect(() => registry.get({ importId: ID_A, principalId: "other" })).toThrow(expect.objectContaining({ code: "NOT_FOUND", message: "Import not found." }));
    expect(registry.list({ principalId: "other" })).toEqual([]);
    expect(registry.list({}).map(r => r.importId)).toEqual([ID_A]);
  });

  it("refuses an unreadable record by name and leaves its bytes in place", () => {
    const { registry, directory } = setup();
    fs.writeFileSync(path.join(directory, `${ID_A}.json`), "{torn");
    expect(() => registry.get({ importId: ID_A, principalId: "owner" })).toThrow(expect.objectContaining({ code: "REGISTRY_UNREADABLE" }));
    expect(fs.readFileSync(path.join(directory, `${ID_A}.json`), "utf8")).toBe("{torn");
  });

  it("keeps only the share origin once an import is finished, but the full link while it runs", () => {
    const { registry } = setup();
    registry.put({ row: record({ status: "ready" }) });
    expect(registry.get({ importId: ID_A, principalId: "owner" }).source).toEqual({ url: "https://share.example.test" });
    registry.put({ row: record({ status: "creating" }) });
    expect(registry.get({ importId: ID_A, principalId: "owner" }).source).toEqual({ url: "https://share.example.test/s/token?k=1" });
  });

  it("writes its stores through the injected payload ports and runs transfers through the injected lock", async () => {
    const { registry, writes, locks, directory } = setup();
    registry.saveUpload({ row: upload() });
    expect(writes).toHaveLength(1);
    expect(path.dirname(writes[0]!)).toBe(registry.payloadDirectory);
    expect(await registry.exclusive({ run: async () => 42 })).toBe(42);
    expect(locks).toEqual([{ lockPath: path.join(directory, ".import.lock"), staleMs: Infinity }]);
  });

  it("claims an upload only for its principal within one hour", () => {
    const { registry } = setup();
    vi.useFakeTimers({ now: Date.UTC(2026, 0, 1), toFake: ["Date"] });
    registry.saveUpload({ row: upload() });
    expect(registry.getUpload({ uploadId: ID_B, principalId: "owner" }).uploadId).toBe(ID_B);
    expect(() => registry.getUpload({ uploadId: ID_B, principalId: "other" })).toThrow(SiteShareRefusal);
    vi.setSystemTime(Date.UTC(2026, 0, 1) + HOUR + 1);
    expect(() => registry.getUpload({ uploadId: ID_B, principalId: "owner" })).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("expiry removes an upload past one hour with its payload, keeps one exactly an hour old, and names an unremovable entry in the log", () => {
    const lines: string[] = [];
    const { registry } = setup((line) => lines.push(line));
    vi.useFakeTimers({ now: Date.UTC(2026, 0, 1), toFake: ["Date"] });
    registry.saveUpload({ row: upload() });
    fs.writeFileSync(registry.uploadPath({ uploadId: ID_B }), "zip");
    vi.setSystemTime(Date.UTC(2026, 0, 1) + HOUR);
    registry.expire({});
    expect(fs.existsSync(registry.uploadPath({ uploadId: ID_B }))).toBe(true);
    vi.setSystemTime(Date.UTC(2026, 0, 1) + HOUR + 1);
    registry.expire({});
    expect(fs.existsSync(registry.uploadPath({ uploadId: ID_B }))).toBe(false);
    const rm = vi.spyOn(fs, "rmSync").mockImplementation(() => { throw new Error("busy"); });
    // A stage is a directory; an orphan one (no pending record) is swept.
    fs.mkdirSync(path.join(registry.payloadDirectory, `${ID_A}.stage`));
    registry.expire({});
    rm.mockRestore();
    // The payload sweep names the failed operation; one unremovable entry does not stop it.
    expect(lines.some(line => line.includes("expire-import-payload"))).toBe(true);
  });

  it("fails an owner setup past its deadline and discards its stage", () => {
    const { registry } = setup();
    vi.useFakeTimers({ now: Date.UTC(2026, 0, 1), toFake: ["Date"] });
    registry.put({ row: record({ status: "needs-owner", expiresAt: Date.now() + 10 }) });
    fs.mkdirSync(registry.stagePath({ importId: ID_A }));
    registry.expire({});
    expect(fs.existsSync(registry.stagePath({ importId: ID_A }))).toBe(true);
    vi.setSystemTime(Date.UTC(2026, 0, 1) + 11);
    registry.expire({});
    expect(registry.get({ importId: ID_A, principalId: "owner" })).toMatchObject({ status: "failed", error: "Owner setup expired. Import the archive again." });
    expect(fs.existsSync(registry.stagePath({ importId: ID_A }))).toBe(false);
  });
});

describe("import source helpers", () => {
  it("reduces a link source to its origin and leaves an upload source unchanged", () => {
    expect(withoutQuery({ source: { url: "https://a.example.test/p?q=1" } })).toEqual({ url: "https://a.example.test" });
    expect(withoutQuery({ source: { uploadId: ID_B } })).toEqual({ uploadId: ID_B });
  });
  it("digests only a link source, over its full href", () => {
    expect(importSourceDigest({ source: { uploadId: ID_B } })).toBeUndefined();
    const a = importSourceDigest({ source: { url: "https://a.example.test/p?q=1" } });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(importSourceDigest({ source: { url: "https://a.example.test/p?q=2" } }));
  });
});
