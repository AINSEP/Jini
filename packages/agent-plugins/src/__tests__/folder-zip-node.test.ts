import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { zipFolderFiles } from "../folder-zip.js";
import { zipLocalFolder } from "../folder-zip-node.js";

test("local folder bytes equal the browser folder upload encoder, including binary and UTF-8 paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "folder-zip-"));
  try {
    await mkdir(path.join(root, "images"));
    const binary = new Uint8Array([0x89, 0, 0xff, 0x80]);
    await writeFile(path.join(root, "plugin.json"), "{}");
    await writeFile(path.join(root, "images", "é.png"), binary);
    const files = [new File([binary], "é.png"), new File(["{}"], "plugin.json")];
    Object.defineProperty(files[0], "webkitRelativePath", { value: "picked/images/é.png" });
    Object.defineProperty(files[1], "webkitRelativePath", { value: "picked/plugin.json" });
    const expected = new Uint8Array(await (await zipFolderFiles({ files, maxBytes: 1024 })).arrayBuffer());
    assert.deepEqual(await zipLocalFolder({ path: root, maxBytes: 1024 }), expected);
    assert.deepEqual(await zipLocalFolder({ path: root, maxBytes: 1024 }), expected);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("local folders refuse empty, missing, raw-size and ZIP-overhead limit violations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "folder-zip-limits-"));
  try {
    await assert.rejects(() => zipLocalFolder({ path: root, maxBytes: 1024 }), { reason: "empty", message: "That folder is empty." });
    await assert.rejects(() => zipLocalFolder({ path: path.join(root, "missing"), maxBytes: 1024 }), { reason: "unreadable", message: "Could not read that folder. Try again." });
    await writeFile(path.join(root, "a"), "1234567890");
    await assert.rejects(() => zipLocalFolder({ path: root, maxBytes: 9 }), { reason: "too-large", message: "Folder is over the upload limit." });
    await assert.rejects(() => zipLocalFolder({ path: root, maxBytes: 10 }), { reason: "too-large", message: "Folder is over the upload limit." });
    await writeFile(path.join(root, "b"), "1234567890");
    await assert.rejects(() => zipLocalFolder({ path: root, maxBytes: 19 }), { reason: "too-large", message: "Folder is over the upload limit." });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("local folder collection bounds directory entries as well as files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "folder-zip-count-"));
  try {
    for (let i = 0; i < 4097; i++) await mkdir(path.join(root, String(i)));
    await assert.rejects(() => zipLocalFolder({ path: root, maxBytes: 1024 }), { reason: "too-many", message: "More than 4096 entries." });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("local folder collection refuses file and directory symlinks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "folder-zip-links-"));
  try {
    const folder = path.join(root, "picked");
    await mkdir(folder);
    await writeFile(path.join(root, "outside.txt"), "outside");
    await symlink(path.join(root, "outside.txt"), path.join(folder, "link"));
    await assert.rejects(() => zipLocalFolder({ path: folder, maxBytes: 1024 }), { reason: "unreadable", message: "Could not read that folder. Try again." });
    await rm(path.join(folder, "link"));
    await symlink(root, path.join(folder, "link"));
    await assert.rejects(() => zipLocalFolder({ path: folder, maxBytes: 1024 }), { reason: "unreadable", message: "Could not read that folder. Try again." });
  } finally { await rm(root, { recursive: true, force: true }); }
});
