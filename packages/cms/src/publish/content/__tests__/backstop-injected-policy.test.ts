import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildBackstopPreview } from "../backstop-preview.js";
import { createRawFileSitePort } from "../publish-backstop-file.js";
import type { RawBackstopPolicy, RawFilePolicy } from "../backstop-refusal.js";
import type { BackstopPorts, PackedEntity } from "../../transfer/index.js";

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
