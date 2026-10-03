import fs from "node:fs";
import * as asyncFs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { createNodeAtomicFilesystem, writeFileAtomic, writeFileAtomicAsync, writeJsonFileAtomicAsync } from "../atomic-write.js";
const roots: string[] = [];
function target(): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-async-")); roots.push(root); return path.join(root, "state"); }
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
// REGRESSION: fails if the optional tempName pid.UUID factory is removed or replaced by a constant.
test("sync writer supplies a default temp token and still creates 0600", () => {
  const filePath = target();
  const native = createNodeAtomicFilesystem({}); let temporary = "";
  const filesystem = { ...native, open: (input: Parameters<typeof native.open>[0]) => { if (input.flags === "wx") temporary = input.path; return native.open(input); } };
  writeFileAtomic({ filePath, content: "value", fs: filesystem });
  expect(path.basename(temporary)).toMatch(/^\.state\.\d+\.[0-9a-f-]{36}\.tmp$/);
  expect(path.basename(temporary).startsWith(`.state.${process.pid}.`)).toBe(true);
  expect(fs.readFileSync(filePath, "utf8")).toBe("value");
  if (process.platform !== "win32") expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  expect(fs.readdirSync(path.dirname(filePath))).toEqual(["state"]);
});
// REGRESSION: fails if the async writer does not sync file before rename and directory after rename.
test("async replacement syncs both descriptors in order and preserves existing mode", async () => {
  const filePath = target(); fs.writeFileSync(filePath, "old", { mode: 0o640 });
  const events: string[] = [];
  const realOpen = asyncFs.open, realRename = asyncFs.rename;
  const filesystem = {
    ...asyncFs,
    open: async (target: Parameters<typeof asyncFs.open>[0], flags: Parameters<typeof asyncFs.open>[1], mode?: Parameters<typeof asyncFs.open>[2]) => {
      const handle = await realOpen(target, flags, mode), realSync = handle.sync.bind(handle);
      vi.spyOn(handle, "sync").mockImplementation(async () => { events.push(flags === "wx" ? "file" : "directory"); await realSync(); });
      return handle;
    },
    rename: async (from: Parameters<typeof asyncFs.rename>[0], to: Parameters<typeof asyncFs.rename>[1]) => { events.push("rename"); await realRename(from, to); },
  };
  await writeFileAtomicAsync({ filePath, content: "new" }, { fs: filesystem });
  expect(events).toEqual(["file", "rename", "directory"]);
  expect(fs.readFileSync(filePath, "utf8")).toBe("new");
  if (process.platform !== "win32") expect(fs.statSync(filePath).mode & 0o777).toBe(0o640);
});
// PARITY: a secret store may force 0600 while a sidecar may retain its newline and parent creation.
test("async JSON supports sidecar bytes and explicit owner-only secret mode", async () => {
  const filePath = path.join(target(), "nested", "state.json");
  await writeJsonFileAtomicAsync({ filePath, data: { v: 1 } }, { createParent: true, trailingNewline: true, mode: 0o600, verifyOwnerOnly: true });
  expect(fs.readFileSync(filePath, "utf8")).toBe('{\n  "v": 1\n}\n');
  if (process.platform !== "win32") expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
});
// REGRESSION: fails if refuseSymlink stops checking the destination before replacement.
test("sync and async refusal leave a symlink and its referent untouched", async () => {
  const filePath = target(), link = `${filePath}.link`; fs.writeFileSync(filePath, "original"); fs.symlinkSync(filePath, link);
  expect(() => writeFileAtomic({ filePath: link, content: "changed", fs: createNodeAtomicFilesystem({}) }, { refuseSymlink: true })).toThrow(/symbolic-link/);
  await expect(writeFileAtomicAsync({ filePath: link, content: "changed" }, { refuseSymlink: true })).rejects.toThrow(/symbolic-link/);
  expect(fs.lstatSync(link).isSymbolicLink()).toBe(true); expect(fs.readFileSync(filePath, "utf8")).toBe("original");
});
// REGRESSION: fails if a successful async wx open followed by a partial write is not cleaned.
test("async partial write failure cleans the owned temp and preserves the destination", async () => {
  const filePath = target(); fs.writeFileSync(filePath, "old");
  const filesystem = { ...asyncFs, open: async (target: Parameters<typeof asyncFs.open>[0], flags: Parameters<typeof asyncFs.open>[1], mode?: Parameters<typeof asyncFs.open>[2]) => {
    const handle = await asyncFs.open(target, flags, mode);
    if (flags === "wx") vi.spyOn(handle, "writeFile").mockRejectedValue(new Error("write failed"));
    return handle;
  } };
  await expect(writeFileAtomicAsync({ filePath, content: "new" }, { fs: filesystem })).rejects.toThrow("write failed");
  expect(fs.readdirSync(path.dirname(filePath))).toEqual(["state"]); expect(fs.readFileSync(filePath, "utf8")).toBe("old");
});
// PARITY: EEXIST does not authorize deleting a temp created by somebody else.
test("async exclusive collision preserves the other writer's bytes", async () => {
  const filePath = target(), temp = path.join(path.dirname(filePath), ".state.fixed.tmp"); fs.writeFileSync(temp, "other");
  await expect(writeFileAtomicAsync({ filePath, content: "ours" }, { tempName: () => "fixed" })).rejects.toMatchObject({ code: "EEXIST" });
  expect(fs.readFileSync(temp, "utf8")).toBe("other");
});
// PARITY: secret-mode verification fails closed before rename on POSIX.
test("sync secret verification refuses unexpectedly broad temp permissions", () => {
  const filePath = target(), native = createNodeAtomicFilesystem({});
  const filesystem = { ...native, chmod: () => {}, stat: ({ path }: { path: string }) => path.endsWith(".tmp") ? { mode: 0o644 } : native.stat({ path }) };
  expect(() => writeFileAtomic({ filePath, content: "secret", fs: filesystem }, { mode: 0o600, verifyOwnerOnly: true, platform: "linux" })).toThrow(/owner-only/);
  expect(fs.readdirSync(path.dirname(filePath))).toEqual([]);
});
