import { test } from "vitest";
import assert from "node:assert/strict";
import { mergeMacManifests } from "../entry.js";

/** A manifest shaped like electron-builder 26's `latest-mac.yml` for one arch. */
function manifest(arch: "arm64" | "x64", overrides: Record<string, unknown> = {}) {
  return {
    version: "0.2.0",
    files: [
      { url: `Example-mac-${arch}.zip`, sha512: `zip-${arch}`, size: 100, blockMapSize: 10 },
      { url: `Example-mac-${arch}.dmg`, sha512: `dmg-${arch}`, size: 120 },
    ],
    path: `Example-mac-${arch}.zip`,
    sha512: `zip-${arch}`,
    releaseDate: arch === "arm64" ? "2026-09-23T10:00:00.000Z" : "2026-09-23T11:00:00.000Z",
    ...overrides,
  };
}

test("both arches' zips are listed (the re-stapled dmgs are not), and the legacy top-level path names the Intel zip", () => {
  const merged = mergeMacManifests({ inputs: [
    { label: "x64", manifest: manifest("x64") },
    { label: "arm", manifest: manifest("arm64") },
  ] });
  assert.equal(merged.version, "0.2.0");
  assert.deepEqual(merged.files.map((entry) => entry.url), ["Example-mac-x64.zip", "Example-mac-arm64.zip"]);
  assert.equal(merged.path, "Example-mac-x64.zip");
  assert.equal(merged.sha512, "zip-x64");
  assert.equal(merged.releaseDate, "2026-09-23T11:00:00.000Z");
  assert.equal(merged.files[0]!.blockMapSize, 10, "blockmap sizes must survive for differential downloads");
  assert.deepEqual(merged.files, [manifest("x64").files[0], manifest("arm64").files[0]]);
});

test("when no input carries a releaseDate the merged manifest omits the key rather than inventing one", () => {
  const undated = (arch: "arm64" | "x64") => {
    const { releaseDate: _dropped, ...rest } = manifest(arch);
    return rest;
  };
  const merged = mergeMacManifests({ inputs: [{ label: "arm", manifest: undated("arm64") }, { label: "x64", manifest: undated("x64") }] });
  assert.equal("releaseDate" in merged, false);
  assert.equal(merged.path, "Example-mac-x64.zip");
});

test("a merge of one arch alone is refused: the other arch would find no zip or the wrong one", () => {
  assert.throws(
    () => mergeMacManifests({ inputs: [{ label: "arm", manifest: manifest("arm64") }] }),
    { message: "expected one arm64 zip and one x64 zip, got [Example-mac-arm64.zip]" },
  );
  assert.throws(
    () => mergeMacManifests({ inputs: [{ label: "a", manifest: manifest("x64") }, { label: "b", manifest: manifest("x64", { files: [{ url: "Other-x64.zip", sha512: "o" }] }) }] }),
    { message: "expected one arm64 zip and one x64 zip, got [Example-mac-x64.zip, Other-x64.zip]" },
  );
});

test("duplicate architectures with distinct URLs are refused", () => {
  for (const arch of ["arm64", "x64"] as const) {
    assert.throws(() => mergeMacManifests({ inputs: [
      { label: "arm", manifest: manifest("arm64") },
      { label: "x64", manifest: manifest("x64") },
      { label: "extra", manifest: manifest(arch, { files: [{ url: `Other-${arch}.zip`, sha512: "extra" }] }) },
    ] }), /expected one arm64 zip and one x64 zip/);
  }
});

test("inputs from two different versions are refused", () => {
  assert.throws(
    () => mergeMacManifests({ inputs: [{ label: "arm", manifest: manifest("arm64") }, { label: "x64", manifest: manifest("x64", { version: "0.1.9" }) }] }),
    { message: "version mismatch: 0.2.0 vs 0.1.9" },
  );
});

test("one file name with two checksums is refused; an identical duplicate is kept once", () => {
  const clash = manifest("x64", { files: [...manifest("x64").files, { url: "Example-mac-arm64.zip", sha512: "different" }] });
  assert.throws(
    () => mergeMacManifests({ inputs: [{ label: "arm", manifest: manifest("arm64") }, { label: "x64", manifest: clash }] }),
    { message: "Example-mac-arm64.zip listed with two different checksums" },
  );
  const merged = mergeMacManifests({ inputs: [{ label: "a", manifest: manifest("arm64") }, { label: "b", manifest: manifest("arm64") }, { label: "c", manifest: manifest("x64") }] });
  assert.equal(merged.files.length, 2);
});

test("malformed input and no input are refused with the input's label", () => {
  assert.throws(() => mergeMacManifests({ inputs: [] }), { message: "no manifests to merge" });
  assert.throws(() => mergeMacManifests({ inputs: [{ label: "a.yml", manifest: null }] }), { message: "a.yml: not an update manifest (needs version and files)" });
  assert.throws(
    () => mergeMacManifests({ inputs: [{ label: "a.yml", manifest: { version: "1", files: [{ url: "x.zip" }] } }] }),
    { message: "a.yml: every files entry needs url and sha512" },
  );
});


test('validates version, files array and individual entries independently', () => {
  const good = manifest("x64");
  for (const invalid of [{ ...good, version: 2 }, { ...good, files: { zip: good.files[0] } }]) {
    assert.throws(() => mergeMacManifests({ inputs: [{ label: "intel.yml", manifest: invalid }] }),
      { message: "intel.yml: not an update manifest (needs version and files)" });
  }
  for (const invalid of [null, { url: 50, sha512: "known" }, { url: "last.zip", sha512: false }]) {
    assert.throws(() => mergeMacManifests({ inputs: [{ label: "intel.yml", manifest: { ...good, files: [...good.files, invalid] } }] }),
      { message: "intel.yml: every files entry needs url and sha512" });
  }
});
