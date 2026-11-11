import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readLiveDaemonRegistryRecord, removeDaemonRegistryRecordIfCurrent, writeDaemonRegistryRecord } from "../daemon-registry.js";

let dir: string;
let registryPath: string;
const valid = { url: "http://127.0.0.1:4000", host: "127.0.0.1", port: 4000, pid: process.pid, startedAt: "2026-10-25T00:00:00.000Z" };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jini-registry-validation-"));
  registryPath = join(dir, "daemon.json");
});
afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe("readLiveDaemonRegistryRecord refuses a record broken in exactly one field", () => {
  it("accepts the valid live record", async () => {
    await writeFile(registryPath, JSON.stringify(valid));
    await expect(readLiveDaemonRegistryRecord({ registryPath })).resolves.toEqual(valid);
  });

  it.each([
    ["url empty", { url: "" }],
    ["url non-string", { url: 5 }],
    ["host empty", { host: "" }],
    ["host non-string", { host: ["127.0.0.1"] }],
    ["port zero", { port: 0 }],
    ["port negative", { port: -1 }],
    ["port fractional", { port: 1.5 }],
    ["port numeric string", { port: "4000" }],
    ["pid string", { pid: String(process.pid) }],
    ["startedAt empty", { startedAt: "" }],
    ["startedAt non-string", { startedAt: 1 }],
  ])("%s → null", async (_label, patch) => {
    await writeFile(registryPath, JSON.stringify({ ...valid, ...patch }));
    await expect(readLiveDaemonRegistryRecord({ registryPath })).resolves.toBeNull();
  });

  it.each([["null", "null"], ["string", "\"x\""], ["number", "4"], ["array", "[]"]])("non-object json (%s) → null", async (_label, text) => {
    await writeFile(registryPath, text);
    await expect(readLiveDaemonRegistryRecord({ registryPath })).resolves.toBeNull();
  });
});

describe("removeDaemonRegistryRecordIfCurrent ownership guard", () => {
  it("never removes a record owned by another pid", async () => {
    await writeDaemonRegistryRecord({ registryPath, record: { ...valid, pid: process.pid + 1 } });
    await removeDaemonRegistryRecordIfCurrent({ registryPath, pid: process.pid });
    expect(JSON.parse(await readFile(registryPath, "utf8")).pid).toBe(process.pid + 1);
  });

  it("restores a foreign record that replaced ours between read and detach", async () => {
    await writeDaemonRegistryRecord({ registryPath, record: valid });
    const foreign = { ...valid, pid: process.pid + 7 };
    const files = {
      rename: async (from: string, to: string) => {
        await writeFile(from, JSON.stringify(foreign)); // newer writer wins the race
        await rename(from, to);
      },
      link: async (from: string, to: string) => {
        const { link } = await import("node:fs/promises");
        await link(from, to);
      },
    };
    await removeDaemonRegistryRecordIfCurrent({ registryPath, pid: process.pid }, { files });
    expect(JSON.parse(await readFile(registryPath, "utf8"))).toEqual(foreign);
  });
});
