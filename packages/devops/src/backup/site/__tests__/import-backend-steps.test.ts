import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  deadlineSignal, downloadShareArchive, importSiteSlug, parseImportInput, reconcileInterruptedImports, requireFreeSpace, requireOwnerSetup,
  requireStagingBudget, siteImportView, startImportedSite, type ImportHttpClient, type SiteImportStepsHost,
} from "../import-backend-steps.js";
import type { SiteImportRecord } from "@jini-ai/core/contracts/site/site-import-history";
import type { SiteImportRegistry } from "../import-registry.js";
import { SiteShareRefusal } from "../share-refusal.js";

const UPLOAD_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const INPUT = (message: string) => ({ code: "INVALID_INPUT", message });
const SOURCE = INPUT("Provide exactly one source: url or uploadId; optional displayName and requestId only.");

function host(overrides: Partial<SiteImportStepsHost> = {}): SiteImportStepsHost {
  return {
    maxArchiveBytes: 1024, maxExpandedBytes: 1, errorLogOptions: {},
    copy: { homeSpace: "home space copy", stagingSpace: "staging space copy", downloadFailed: "download failed copy", uploadTooLarge: "upload copy" },
    developmentDefaultPassword: "dev-default", timeoutMsOf: () => undefined, assertPortableName: () => undefined,
    reconcileCreation: async () => "failed", ...overrides,
  };
}
const row = (overrides: Partial<SiteImportRecord> = {}): SiteImportRecord => ({
  importId: "imp-1", principalId: "p1", source: { uploadId: UPLOAD_ID }, newSiteId: null, newSiteName: null, displayName: "Sample", status: "needs-owner",
  createdAt: "2026-01-01T00:00:00Z", expiresAt: 1, ...overrides,
});
const httpReturning = (response: Awaited<ReturnType<ImportHttpClient["send"]>>, seen: Array<Parameters<ImportHttpClient["send"]>[0]> = []): ImportHttpClient => ({ send: async (request) => { seen.push(request); return response; } });
const ZIP = Buffer.from("zip-bytes");
const signal = new AbortController().signal;

afterEach(() => { vi.restoreAllMocks(); });

describe("parseImportInput", () => {
  it.each([
    ["no source", {}], ["both sources", { url: "https://a.example/x.zip", uploadId: UPLOAD_ID }], ["an unknown key", { url: "https://a.example/x.zip", path: "/etc" }],
    ["null", null], ["a string", "https://a.example/x.zip"], ["an array", Object.assign([], { url: "https://a.example/x.zip" })],
  ])("refuses input with %s as a source error", (_label, input) => { expect(() => parseImportInput({ input })).toThrow(expect.objectContaining(SOURCE)); });

  it.each(["", "  ", "x".repeat(201), 7])("refuses displayName %j", (displayName) => {
    expect(() => parseImportInput({ input: { uploadId: UPLOAD_ID, displayName } })).toThrow(expect.objectContaining(INPUT("displayName must be 1..200 characters.")));
  });
  it.each(["", "a b", "x".repeat(129), 9])("refuses requestId %j", (requestId) => {
    expect(() => parseImportInput({ input: { uploadId: UPLOAD_ID, requestId } })).toThrow(expect.objectContaining(INPUT("requestId must be 1..128 letters, digits, dashes or underscores.")));
  });
  it.each([7, "x".repeat(4097), "not a url", "http://a.example/x.zip", "https://u:p@a.example/x.zip", "https://a.example/x.zip#frag"])("refuses url %j", (url) => {
    expect(() => parseImportInput({ input: { url } })).toThrow(SiteShareRefusal);
  });
  it.each(["nope", "0F8FAD5B-D9CB-469F-A165-70867728950E", 5])("refuses uploadId %j", (uploadId) => {
    expect(() => parseImportInput({ input: { uploadId } })).toThrow(expect.objectContaining(INPUT("uploadId must come from the authenticated ZIP upload endpoint.")));
  });
  it("normalises an https url and carries only the given optional fields", () => {
    expect(parseImportInput({ input: { url: "https://A.example/x.zip" } })).toEqual({ source: { url: "https://a.example/x.zip" } });
    expect(parseImportInput({ input: { uploadId: UPLOAD_ID, displayName: "x".repeat(200), requestId: "r-1_A" } })).toEqual({ source: { uploadId: UPLOAD_ID }, displayName: "x".repeat(200), requestId: "r-1_A" });
  });
});

describe("downloadShareArchive", () => {
  const url = "https://provider.example/share/file.zip?id=sample-query";
  it("asks for an identity GET bounded by the host's archive cap and returns the bytes", async () => {
    const seen: Array<Parameters<ImportHttpClient["send"]>[0]> = [];
    const archive = await downloadShareArchive({ http: httpReturning({ status: 200, headers: { "Content-Type": "application/zip; charset=x" }, bodyBytes: ZIP, bodyBytesTruncated: false }, seen), url, signal, host: host() });
    expect(archive.equals(ZIP)).toBe(true);
    expect(seen[0]).toMatchObject({ method: "GET", url, maxResponseBytes: 1024, bodyAs: "bytes", headers: { Accept: "application/zip", "Accept-Encoding": "identity" }, idleTimeoutMs: 30_000, totalDeadlineMs: 240_000 });
  });
  it("names only the origin and the host-reported seconds when the download times out", async () => {
    const http: ImportHttpClient = { send: async () => { throw new Error("slow"); } };
    const failure = downloadShareArchive({ http, url, signal, host: host({ timeoutMsOf: ({ error }) => (error instanceof Error ? 45_000 : undefined) }) });
    await expect(failure).rejects.toMatchObject({ code: "DOWNLOAD_TIMEOUT", message: "The share download from https://provider.example timed out after 45 seconds. Download the ZIP file and import it." });
  });
  it("rethrows a non-timeout transport failure unchanged", async () => {
    const boom = new Error("reset");
    await expect(downloadShareArchive({ http: { send: async () => { throw boom; } }, url, signal, host: host() })).rejects.toBe(boom);
  });
  it.each([
    ["a non-200 status", { status: 500, headers: {}, bodyBytes: ZIP, bodyBytesTruncated: false }],
    ["a truncated body", { status: 200, headers: { "content-type": "application/zip" }, bodyBytes: ZIP, bodyBytesTruncated: true }],
    ["no body", { status: 200, headers: { "content-type": "application/zip" } }],
  ])("refuses %s with the host's download copy", async (_label, response) => {
    await expect(downloadShareArchive({ http: httpReturning(response), url, signal, host: host() })).rejects.toMatchObject({ code: "DOWNLOAD_FAILED", message: "download failed copy" });
  });
  it("refuses a body that is not labelled ZIP or binary", async () => {
    await expect(downloadShareArchive({ http: httpReturning({ status: 200, headers: { "content-type": "text/html" }, bodyBytes: ZIP, bodyBytesTruncated: false }), url, signal, host: host() })).rejects.toMatchObject({ code: "INVALID_CONTENT_TYPE" });
  });
});

describe("owner setup, slug and view", () => {
  it("refuses an import that is not awaiting owner setup, or that reuses the host's development default password", () => {
    expect(() => requireOwnerSetup({ row: row({ status: "ready" }), adminPassword: "new-password", host: host() })).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(() => requireOwnerSetup({ row: row(), adminPassword: undefined, host: host() })).toThrow(expect.objectContaining({ code: "INVALID_PASSWORD" }));
    expect(() => requireOwnerSetup({ row: row(), adminPassword: "dev-default", host: host() })).toThrow(expect.objectContaining({ code: "INVALID_PASSWORD" }));
    expect(() => requireOwnerSetup({ row: row(), adminPassword: "other-password", host: host() })).not.toThrow();
  });
  it("checks the portable name before and after slugification through the host", () => {
    const checked: string[] = [];
    const assertPortableName = ({ name }: { name: string }) => { checked.push(name); if (name === "bad-slug") throw new Error("not portable"); };
    expect(importSiteSlug({ displayName: "My Site", host: host({ assertPortableName }) })).toBe("my-site");
    expect(checked).toEqual(["My Site", "my-site"]);
    expect(importSiteSlug({ displayName: "日本語", host: host() })).toBe("imported-site");
    expect(() => importSiteSlug({ displayName: "Bad Slug", host: host({ assertPortableName }) })).toThrow("not portable");
  });
  it("builds the owner-setup link under the caller's setupBase only while setup is pending", () => {
    expect(siteImportView({ row: row(), setupBase: "/imports" }).setupUrl).toBe("/imports/imp-1/owner");
    expect(siteImportView({ row: row({ status: "ready" }), setupBase: "/imports" }).setupUrl).toBeUndefined();
    expect(siteImportView({ row: row({ status: "ready" }), setupBase: "/imports" }).credentialWarnings).toEqual([]);
  });
});

describe("startImportedSite", () => {
  const ready = row({ status: "ready" });
  it("records the start failure without throwing and logs it through the host's redaction policy", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const secret = "S".repeat(24);
    const errorLogOptions = { extraPatterns: [{ name: "sample_key", regex: /(?<=samplekey_)[A-Z]{20,}/g }] };
    const started = await startImportedSite({ row: ready, name: "site", startSite: async () => { throw new Error(`failed samplekey_${secret}`); }, host: host({ errorLogOptions }) });
    expect(started.error).toBe("Site created with its owner. Start it from Sites to open admin.");
    expect(String(warn.mock.calls[0]?.[1])).not.toContain(secret);
    expect(String(warn.mock.calls[0]?.[1])).toContain("failed samplekey_");
  });
  it("adds the admin URL, or a start hint when the host reports none", async () => {
    expect(await startImportedSite({ row: ready, name: "site", startSite: async () => ({ adminUrl: "http://site.example/admin" }), host: host() })).toMatchObject({ adminUrl: "http://site.example/admin" });
    expect((await startImportedSite({ row: ready, name: "site", startSite: async () => ({ adminUrl: null }), host: host() })).error).toBe("Site created; start it from Sites to open admin.");
  });
});

describe("storage budget and interrupted imports", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "import-steps-"));
  const registry = (rows: SiteImportRecord[] = []) => ({ directory: tmp, payloadDirectory: tmp, expirePayloads: () => undefined, countStagedPayloads: () => fs.readdirSync(tmp).filter(name => name.endsWith(".upload.zip") || name.endsWith(".stage")).length, list: () => rows, stagePath: (r: SiteImportRecord) => path.join(tmp, `${r.importId}.stage`) }) as unknown as SiteImportRegistry;

  it("refuses when free space is under three expanded-archive caps, using the host's cap and copy", () => {
    expect(() => requireFreeSpace({ dir: tmp, message: "no room", maxExpandedBytes: Number.MAX_SAFE_INTEGER })).toThrow(expect.objectContaining({ code: "INSUFFICIENT_STORAGE", message: "no room" }));
    expect(() => requireFreeSpace({ dir: tmp, message: "no room", maxExpandedBytes: 1 })).not.toThrow();
    expect(() => requireStagingBudget({ registry: registry(), host: host({ maxExpandedBytes: Number.MAX_SAFE_INTEGER }) })).toThrow(expect.objectContaining({ message: "staging space copy" }));
  });
  it("refuses a fifth staged payload", () => {
    for (const name of ["a.upload.zip", "b.upload.zip", "c.stage", "d.stage"]) fs.writeFileSync(path.join(tmp, name), "x");
    expect(() => requireStagingBudget({ registry: registry(), host: host() })).toThrow(expect.objectContaining({ code: "BUSY" }));
    for (const name of ["a.upload.zip", "b.upload.zip", "c.stage", "d.stage"]) fs.rmSync(path.join(tmp, name));
  });
  it("fails a verifying row and settles a creating row through the host's reconciliation, discarding both stages", async () => {
    const verifying = row({ importId: "v1", status: "verifying" });
    const creating = row({ importId: "c1", status: "creating", creation: { siteId: "s1", name: "site", dbPath: "/x" } as never });
    const orphan = row({ importId: "c2", status: "creating" });
    const settled = row({ importId: "n1", status: "ready" });
    for (const r of [verifying, creating, orphan]) fs.mkdirSync(path.join(tmp, `${r.importId}.stage`));
    const put: SiteImportRecord[] = [];
    const reconcileCreation = vi.fn(async () => "ready" as const);
    await reconcileInterruptedImports({ registry: registry([verifying, creating, orphan, settled]), workspace: { id: "w" }, put: (r) => put.push(r), host: { reconcileCreation }, activeRows: () => [verifying, creating, orphan, settled] });
    expect(put.map((r) => [r.importId, r.status])).toEqual([["v1", "failed"], ["c1", "ready"], ["c2", "failed"]]);
    expect(put[2]).toMatchObject({ newSiteId: null, newSiteName: null, error: "Site creation was interrupted and rolled back. Import the archive again." });
    expect(reconcileCreation).toHaveBeenCalledWith({ allocation: creating.creation, workspace: { id: "w" } });
    for (const r of [verifying, creating, orphan]) expect(fs.existsSync(path.join(tmp, `${r.importId}.stage`))).toBe(false);
  });
  it("combines the caller's signal with its own deadline", () => {
    const controller = new AbortController();
    const combined = deadlineSignal({ timeoutMs: 60_000 }, { signal: controller.signal });
    controller.abort();
    expect(combined.aborted).toBe(true);
    expect(deadlineSignal({ timeoutMs: 60_000 }).aborted).toBe(false);
  });
});
