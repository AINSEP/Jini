import { expect, it } from "vitest";
import { chatPackageKind, partitionChatPackages } from "../chat-package-kind.js";
import { zipFolderFiles } from "@jini-ai/agent-plugins/folder-zip";

/** The host injects its legacy manifest alias names; any name proves the alias path. */
const legacyManifestNames = ["legacy.plugin.json"] as const;

async function archive(paths: string[]) {
  const files = paths.map(path => {
    const file = new File(["manifest"], path.split("/").at(-1)!);
    Object.defineProperty(file, "webkitRelativePath", { value: `chosen/${path}` });
    return file;
  });
  return zipFolderFiles({ files, maxBytes: 1024 * 1024 });
}

it.each([[["SKILL.md"], "skill"], [["wrapped/SKILL.md"], "skill"], [["one/two/SKILL.md"], "attachment"],
  [["plugin.json", "SKILL.md"], "agent-plugin"], [["legacy.plugin.json", "SKILL.md"], "site-plugin"],
  [["wrapped/plugin.json"], "agent-plugin"], [["wrapped/legacy.plugin.json"], "site-plugin"], [["README.md"], "attachment"],
  [["jini.plugin.json", "SKILL.md"], "site-plugin"], [["wrapped/jini.plugin.json"], "site-plugin"],
  [["jini.plugin.json", "legacy.plugin.json", "plugin.json", "SKILL.md"], "site-plugin"], // legacy alias
  [["one/two/jini.plugin.json"], "attachment"], [["__MACOSX/jini.plugin.json"], "attachment"],
] as const)("classifies %j from central-directory names as %s", async (paths, kind) => {
  expect(await chatPackageKind({ file: await archive([...paths]), legacyManifestNames })).toBe(kind);
});

it.each(["jini.plugin.json", "legacy.plugin.json"])("keeps %s folders and bundled skills together as attachments", async (filename) => { // legacy alias
  const files = [filename, "SKILL.md", "skills/help/SKILL.md"].map(relative =>
    Object.assign(new File(["content"], relative.split("/").at(-1)!), { relativePath: `plugin/${relative}` }));
  expect(await partitionChatPackages({ files, legacyManifestNames })).toEqual({ skills: [], attachments: files });
});

it("routes truncated central directories to chat", async () => {
  const file = await archive(["SKILL.md"]);
  expect(await chatPackageKind({ file: new File([file.slice(0, file.size - 1)], "broken.zip"), legacyManifestNames })).toBe("attachment");
});

it.each(["notes.txt", "archive.zip", "tiny.zip"])("keeps an ordinary or unreadable archive-shaped attachment (%s)", async name => {
  expect(await chatPackageKind({ file: new File(["ordinary content"], name), legacyManifestNames })).toBe("attachment");
});

it("keeps an attachment when reading its ZIP fails", async () => {
  class UnreadableZip extends File {
    override slice(): Blob { throw new Error("File is no longer readable"); }
  }
  expect(await chatPackageKind({ file: new UnreadableZip(["zip"], "lost.zip"), legacyManifestNames })).toBe("attachment");
});

it.each([
  ["multi-disk archive", (view: DataView, end: number) => view.setUint16(end + 4, 1, true)],
  ["directory on another disk", (view: DataView, end: number) => view.setUint16(end + 6, 1, true)],
  ["too many entries", (view: DataView, end: number) => view.setUint16(end + 10, 4097, true)],
  ["inconsistent entry counts", (view: DataView, end: number) => view.setUint16(end + 8, 0, true)],
  ["oversized directory", (view: DataView, end: number) => view.setUint32(end + 12, 1024 * 1024 + 1, true)],
  ["inconsistent directory offset", (view: DataView, end: number) => view.setUint32(end + 16, 0, true)],
  ["invalid central signature", (view: DataView, end: number) => view.setUint32(view.getUint32(end + 16, true), 0, true)],
  ["truncated central header", (view: DataView, end: number) => { view.setUint16(end + 8, 2, true); view.setUint16(end + 10, 2, true); }],
  ["name extending beyond the directory", (view: DataView, end: number) => view.setUint16(view.getUint32(end + 16, true) + 28, 65535, true)],
  ["extra uncounted central data", (view: DataView, end: number) => { view.setUint16(end + 8, 0, true); view.setUint16(end + 10, 0, true); }],
] as const)("routes %s to attachments even when a skill marker is present", async (_name, corrupt) => {
  const bytes = new Uint8Array(await (await archive(["SKILL.md"])).arrayBuffer());
  corrupt(new DataView(bytes.buffer), bytes.length - 22);
  expect(await chatPackageKind({ file: new File([bytes], "broken.zip"), legacyManifestNames })).toBe("attachment");
});

it("rejects a false end record whose comment length does not reach the end of the file", async () => {
  const file = await archive(["SKILL.md"]);
  expect(await chatPackageKind({ file: new File([await file.arrayBuffer(), "trailing"], "trailing.zip"), legacyManifestNames })).toBe("attachment");
});

it("recognizes skill names with Windows separators and a leading relative marker", async () => {
  const bytes = new Uint8Array(await (await archive(["./SKILL.md"])).arrayBuffer());
  const directory = new DataView(bytes.buffer).getUint32(bytes.length - 22 + 16, true);
  // The shared packer normalizes slashes; external ZIPs can retain Windows separators.
  bytes.set(new TextEncoder().encode(".\\SKILL.md"), directory + 46);
  expect(await chatPackageKind({ file: new File([bytes], "windows.zip"), legacyManifestNames })).toBe("skill");
});

it("groups companion files under browser and expanded skill folders while keeping loose attachments separate", async () => {
  const browserSkill = new File(["skill"], "SKILL.md");
  Object.defineProperty(browserSkill, "webkitRelativePath", { value: "browser/SKILL.md" });
  const browserCompanion = new File(["companion"], "guide.txt");
  Object.defineProperty(browserCompanion, "webkitRelativePath", { value: "browser/guide.txt" });
  const expanded = Object.assign(new File(["skill"], "SKILL.md"), { relativePath: "expanded\\SKILL.md" });
  const companion = Object.assign(new File(["companion"], "run.txt"), { relativePath: "expanded\\run.txt" });
  const loose = new File(["notes"], "notes.txt");
  const standalone = new File(["skill"], "SKILL.md");
  expect(await partitionChatPackages({ files: [browserSkill, browserCompanion, expanded, companion, loose, standalone], legacyManifestNames })).toEqual({
    skills: [browserSkill, browserCompanion, expanded, companion, standalone], attachments: [loose],
  });
});

it("keeps agent-plugin browser folders together even when they bundle skills", async () => {
  const files = ["plugin.json", "SKILL.md", "helper.txt"].map(name => {
    const file = new File(["content"], name);
    Object.defineProperty(file, "webkitRelativePath", { value: `agent/${name}` });
    return file;
  });
  expect(await partitionChatPackages({ files, legacyManifestNames })).toEqual({ skills: [], attachments: files });
});
