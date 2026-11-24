import { readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { captureSqliteBackupBytes } from "../sqlite-backup.js";

const PREFIX = "jini-sqlite-backup-test-";
const leftovers = async () => (await readdir(tmpdir())).filter((name) => name.startsWith(PREFIX));

describe("captureSqliteBackupBytes", () => {
  it("backs up into a fresh dir under the injected prefix, returns the bytes and removes the copy", async () => {
    const paths: string[] = [];
    const bytes = await captureSqliteBackupBytes({ tempDirPrefix: PREFIX, source: { backupTo: async (destPath) => { paths.push(destPath); await writeFile(destPath, "snapshot"); } } });
    expect(bytes.toString("utf8")).toBe("snapshot");
    expect(paths.length).toBe(1);
    expect(basename(paths[0]!)).toBe("chat.db");
    expect(basename(dirname(paths[0]!)).startsWith(PREFIX)).toBe(true);
    expect(await leftovers()).toEqual([]);
  });

  it("removes the temp dir even when the backup fails, and rethrows", async () => {
    await expect(captureSqliteBackupBytes({ tempDirPrefix: PREFIX, source: { backupTo: async (destPath) => { await writeFile(destPath, "partial"); throw new Error("busy"); } } })).rejects.toThrow("busy");
    expect(await leftovers()).toEqual([]);
  });
});
