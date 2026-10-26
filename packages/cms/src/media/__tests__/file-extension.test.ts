import assert from "node:assert/strict";
import { test } from "vitest";
import { mediaFileExtension } from "../file-extension.js";
import { buildImportFilename } from "../import/fetch-image.js";

test("original filenames use server-validated MIME extensions rather than a claimed filename", () => {
  for (const [contentType, extension] of [
    ["image/svg+xml", "svg"], ["video/mp4", "mp4"], ["application/pdf", "pdf"],
    ["image/jpeg", "jpg"], ["audio/mpeg", "mp3"], ["video/webm", "webm"],
    ["audio/wav", "wav"], ["audio/flac", "flac"], ["audio/mp4", "m4a"], ["audio/ogg", "ogg"],
  ]) {
    assert.equal(mediaFileExtension({ contentType }), extension);
    assert.equal(buildImportFilename({ url: new URL("https://example.test/fake.exe"), contentType }), `fake.${extension}`);
  }
  for (const contentType of ["unknown/../../svg", "__proto__", "constructor", "text/html", ""]) {
    assert.equal(mediaFileExtension({ contentType }), "bin");
  }
});
