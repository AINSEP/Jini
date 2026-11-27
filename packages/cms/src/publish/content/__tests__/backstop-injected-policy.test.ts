import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildBackstopPreview } from "../backstop-preview.js";
import { createRawFileSitePort } from "../publish-backstop-file.js";
import type { RawBackstopPolicy, RawFilePolicy } from "../backstop-refusal.js";
import type { BackstopPorts, PackedEntity, RawRowPort, RawRowSnapshot, RawFilePort } from "../../transfer/index.js";

const allowAll: RawBackstopPolicy = { checkRawTable: () => null, checkRawFilePath: () => null, checkRawValues: () => null };
const fileEntity = { entityType: "raw-file", id: "a.txt", state: { path: "a.txt", sha256: "x", size: 1, mode: 0o644 } } as unknown as PackedEntity;
const ports = { coveredTables: [], coveredRoots: [] } as unknown as BackstopPorts;

describe("backstop modules take their host policy injected", () => {
  it("preview refuses with the message the injected file policy returns", async () => {
    const policy = { ...allowAll, checkRawFilePath: () => "host says no" };
    const [preview] = await buildBackstopPreview({ entities: [fileEntity], backstop: ports, workspaceId: "ws", policy, warn: () => {} });
    expect(preview?.unavailableReason).toBe("host says no");
  });

  it("preview reports an inspection failure through the injected warn, untagged", async () => {
    const warnings: { message: string; detail: unknown }[] = [];
    const policy = { ...allowAll, checkRawFilePath: () => { throw new Error("boom"); } };
    const [preview] = await buildBackstopPreview({ entities: [fileEntity], backstop: ports, workspaceId: "ws", policy, warn: (w) => warnings.push(w) });
    expect(preview?.unavailableReason).toBe("These values could not be inspected safely. Check again before sending.");
    expect(warnings.map((w) => w.message)).toEqual(["backstop values could not be inspected; preview remains unavailable"]);
  });

  it("the raw file port enforces the injected byte cap and mode normalizer", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backstop-inj-"));
    try {
      fs.writeFileSync(path.join(dir, "a.txt"), "12345", { mode: 0o600 });
      const policy: RawFilePolicy = { checkRawFilePath: () => null, maxBytes: 4, normalizeMode: () => 0o640 };
      const port = createRawFileSitePort({ siteDir: dir, ...policy });
      await expect(port.read({ relPath: "a.txt" })).rejects.toMatchObject({ name: "BackstopRefusal" });
      const roomy = createRawFileSitePort({ siteDir: dir, ...policy, maxBytes: 10 });
      expect((await roomy.read({ relPath: "a.txt" }))?.mode).toBe(0o640);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

function rowPreviewFixture() {
  const incoming: RawRowSnapshot = { table: "notes", columns: [
    { name: "id", type: "TEXT", pk: 1, notnull: 1 },
    { name: "workspace_id", type: "TEXT", pk: 0, notnull: 1 },
    { name: "body", type: "BLOB", pk: 0, notnull: 0 },
  ], pk: { id: "n-7" }, values: {
    id: "n-7", workspace_id: "ws", body: { blobBase64: Buffer.from("incoming text").toString("base64") },
  } };
  const entity: PackedEntity = { entityType: "raw-row", id: "notes:n-7", schemaVersion: 1,
    contentHash: "incoming-hash", hashVersion: 1, requiredBlobs: [], state: { ...incoming } };
  const read = vi.fn<RawRowPort["read"]>(async () => null);
  const rows: RawRowPort = { read, columns: async () => incoming.columns, upsert: vi.fn(),
    removeCreated: vi.fn(), transaction: ({ work }) => work() };
  const backstop: BackstopPorts = { rows, coveredTables: [], coveredRoots: [] };
  const warn = vi.fn();
  return { incoming, entity, read, backstop, warn };
}

it("does not expose live values when the decoded blob fails the value policy", async () => {
  const { incoming, entity, read, backstop, warn } = rowPreviewFixture();
  read.mockResolvedValueOnce({ ...incoming, values: { ...incoming.values, body: { blobBase64: Buffer.from("private live text").toString("base64") } } });
  const checkRawValues = vi.fn<RawBackstopPolicy["checkRawValues"]>(
    ({ values }) => values.body === "private live text" ? "Private text cannot be previewed." : null,
  );
  expect(await buildBackstopPreview({ entities: [{ ...entity, entityType: "post" }, entity], backstop, warn, workspaceId: "ws",
    policy: { ...allowAll, checkRawValues },
  })).toEqual([{ entityType: "raw-row", entityId: "notes:n-7", before: null, after: incoming.values, unavailableReason: "Private text cannot be previewed." }]);
  expect(read).toHaveBeenCalledExactlyOnceWith({ table: "notes", pk: { id: "n-7" } });
  expect(checkRawValues.mock.calls).toEqual([
    [{ table: "notes", values: { id: "n-7", workspace_id: "ws", body: "incoming text" } }],
    [{ table: "notes", values: { id: "n-7", workspace_id: "ws", body: "private live text" } }],
  ]);
  expect(warn).not.toHaveBeenCalled();
});

it.each([
  { scenario: "foreign workspace", workspaceId: "foreign", coveredTables: [], reason: "This row belongs to a different workspace." },
  { scenario: "covered table", workspaceId: "ws", coveredTables: ["NOTES"], reason: "This table already publishes normally." },
])("withholds before and after values for a $scenario without reading live rows", async ({ workspaceId, coveredTables, reason }) => {
  const { entity, backstop, read, warn } = rowPreviewFixture();
  expect(await buildBackstopPreview({ entities: [entity], backstop: { ...backstop, coveredTables }, warn,
    workspaceId, policy: allowAll,
  })).toEqual([{ entityType: "raw-row", entityId: "notes:n-7", before: null, after: null, unavailableReason: reason }]);
  expect(read).not.toHaveBeenCalled();
});

it("returns checked live values for a valid row and reports when the row reader is not installed", async () => {
  const { incoming, entity, backstop, read, warn } = rowPreviewFixture();
  const live = { ...incoming, values: { id: "n-7", workspace_id: "ws", body: "published text" } };
  read.mockResolvedValueOnce(live);
  const required = { entities: [entity], workspaceId: "ws", policy: allowAll, warn };
  expect(await buildBackstopPreview({ ...required, backstop })).toEqual([
    { entityType: "raw-row", entityId: "notes:n-7", before: live.values, after: incoming.values, unavailableReason: null },
  ]);
  expect(await buildBackstopPreview({ ...required, backstop: { coveredTables: [], coveredRoots: [] } })).toEqual([
    { entityType: "raw-row", entityId: "notes:n-7", before: null, after: null, unavailableReason: "Live row values are not available." },
  ]);
});

it.each([
  { mode: 0o711, expectedMode: 0o755 },
  { mode: 0o600, expectedMode: 0o644 },
])("previews file metadata, not bytes or absolute paths, for mode $mode", async ({ mode, expectedMode }) => {
  const read = vi.fn<RawFilePort["read"]>(async () => ({ bytes: Buffer.from("old"), absPath: "/private/site/a.txt", mode }));
  const check = vi.fn<RawFilePort["check"]>(async () => null);
  const files: RawFilePort = { read, check, replace: vi.fn(), capture: vi.fn(), restore: vi.fn() };
  expect(await buildBackstopPreview({ entities: [fileEntity], backstop: { coveredTables: [], coveredRoots: [], files },
    workspaceId: "ws", policy: allowAll, warn: vi.fn(),
  })).toEqual([{
    entityType: "raw-file", entityId: "a.txt",
    before: { path: "a.txt", sha256: "cba06b5736faf67e54b07b561eae94395e774c517a7d910a54369e1263ccfbd4", size: 3, mode: expectedMode },
    after: { path: "a.txt", sha256: "x", size: 1, mode: 0o644 }, unavailableReason: null,
  }]);
  expect(check).toHaveBeenCalledExactlyOnceWith({ relPath: "a.txt" });
  expect(read).toHaveBeenCalledExactlyOnceWith({ relPath: "a.txt" });
});
