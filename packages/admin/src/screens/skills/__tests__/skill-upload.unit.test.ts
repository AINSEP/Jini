import { File as NativeFile } from "node:buffer";
import { expect, it } from "vitest";
import { prepareSkillUpload } from "../skill-upload.js";

it("retains folder paths and binary bytes across the base64 chunk boundary", async () => {
  const bytes = Uint8Array.from({ length: 8193 }, (_, i) => i % 256);
  const md = new NativeFile(["rules"], "SKILL.md");
  const asset = new NativeFile([bytes], "asset.bin");
  const payload = await prepareSkillUpload({ files: [md, asset] as unknown as File[] }, {
    paths: ["package/SKILL.md", "package/assets/asset.bin"],
  });
  expect(payload).toEqual({ files: [
    { path: "package/SKILL.md", contentBase64: "cnVsZXM=" },
    { path: "package/assets/asset.bin", contentBase64: Buffer.from(bytes).toString("base64") },
  ] });
  expect(await prepareSkillUpload({ files: [new NativeFile([bytes], "skill.zip")] as unknown as File[] }))
    .toEqual({ archiveBase64: Buffer.from(bytes).toString("base64") });
});

it("reports the fixed read error for a rejected folder or ZIP read", async () => {
  for (const name of ["SKILL.md", "skill.zip"]) {
    const unreadable = Object.assign(new NativeFile(["x"], name), {
      arrayBuffer: async () => { throw new Error("read failed"); },
    });
    // Node's File omits browser-only path metadata, as with the readable fixtures above.
    await expect(prepareSkillUpload({ files: [unreadable] as unknown as File[] })).rejects.toMatchObject({ message: "Could not read skill files." });
  }
});

it("uses explicit paths before chat paths, then browser paths, then the file name", async () => {
  const md = Object.assign(new NativeFile(["rules"], "SKILL.md"), { relativePath: "chat/SKILL.md", webkitRelativePath: "browser/SKILL.md" });
  const chat = Object.assign(new NativeFile(["chat"], "chat.txt"), { relativePath: "chat/chat.txt", webkitRelativePath: "browser/chat.txt" });
  const browser = Object.assign(new NativeFile(["browser"], "browser.txt"), { relativePath: "", webkitRelativePath: "browser/browser.txt" });
  const plain = new NativeFile([], "empty.txt");
  expect(await prepareSkillUpload({ files: [md, chat, browser, plain] as unknown as File[] }, { paths: ["explicit/SKILL.md"] }))
    .toEqual({ files: [
      { path: "explicit/SKILL.md", contentBase64: "cnVsZXM=" },
      { path: "chat/chat.txt", contentBase64: "Y2hhdA==" },
      { path: "browser/browser.txt", contentBase64: "YnJvd3Nlcg==" },
      { path: "empty.txt", contentBase64: "" },
    ] });
});

it("rejects an empty selection", async () => {
  await expect(prepareSkillUpload({ files: [] })).rejects.toThrow("Choose up to 256 files, 8 MiB total.");
});

it("accepts 256 files and rejects a selection of 257", async () => {
  const files = [new NativeFile([], "SKILL.md"), ...Array.from({ length: 255 }, (_, i) => new NativeFile([], `${i}.txt`))];
  const payload = await prepareSkillUpload({ files: files as unknown as File[] });
  expect(payload).toEqual({ files: [
    { path: "SKILL.md", contentBase64: "" },
    ...Array.from({ length: 255 }, (_, i) => ({ path: `${i}.txt`, contentBase64: "" })),
  ] });
  await expect(prepareSkillUpload({ files: [...files, new NativeFile([], "extra.txt")] as unknown as File[] }))
    .rejects.toThrow("Choose up to 256 files, 8 MiB total.");
});

it("rejects a folder whose combined size exceeds 8 MiB", async () => {
  const files = [new NativeFile([new Uint8Array(8 * 1024 * 1024)], "SKILL.md"), new NativeFile(["x"], "extra.txt")];
  await expect(prepareSkillUpload({ files: files as unknown as File[] }))
    .rejects.toThrow("Choose up to 256 files, 8 MiB total.");
});

it("requires SKILL.md for a folder and does not treat a ZIP beside another file as an archive", async () => {
  const files = [new NativeFile(["zip"], "skill.zip"), new NativeFile(["text"], "notes.txt")];
  await expect(prepareSkillUpload({ files: files as unknown as File[] }))
    .rejects.toThrow("Choose a skill folder, ZIP, or SKILL.md.");
});

it("rejects a sparse selection before attempting to read a missing first file", async () => {
  const selection = new Array<File>(1);
  await expect(prepareSkillUpload({ files: selection })).rejects.toThrow("Skill upload has no first file.");
});
