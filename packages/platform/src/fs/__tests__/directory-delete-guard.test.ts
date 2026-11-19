/**
 * @file Direct tests for `project-delete-guard.ts` — the rule that decides whether a project delete
 * may recursively erase a directory.
 *
 * Real directories and real symlinks on disk throughout, never string fixtures: the guard's whole
 * job is to survive path shapes (`..`, a trailing slash, a symlinked site dir, a sibling whose name
 * merely starts with the repo root's) that a string comparison gets wrong, and only the filesystem
 * can produce them honestly.
 */
import { afterEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { canonicalNodeDirectory, isInsideDirectory, mayEraseDirectory, readDirectoryIdentity } from "../index.js";

const marker = { markerFile: ".directory-identity.json", identityField: "directoryToken" };
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempDir(): string {
  // Resolved on creation: `os.tmpdir()` is `/var/folders/...` on macOS, itself a symlink to
  // `/private/var/folders/...`. Comparing an unresolved fixture path against the guard's resolved
  // answer would fail for a reason that has nothing to do with the rule under test.
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "directory-delete-guard-")));
  roots.push(root);
  return root;
}

/** A row in `readTrackedSites`'s shape. */
function row(directory: string, origin: string): { directory: string; createdAt: string; origin: string } {
  return { directory, createdAt: "2026-01-01T00:00:00.000Z", origin };
}

/** Write `.site-meta.json` into `dir` (creating it), carrying `identity` — the identity the host
 *  stamps and the one the guard proves a `created` row still names. */
function writeSiteMeta(dir: string, identity: string): string {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, marker.markerFile), JSON.stringify({ directoryToken: identity, schemaVersion: 58 }));
  return dir;
}

/** A `created` row for a site that really is on disk, stamped with that site's own identity — the
 *  shape `trackSite` writes for a directory this app created. */
function createdRow(directory: string, identity: string): { directory: string; createdAt: string; origin: string; identity: string } {
  return { ...row(directory, "created"), identity };
}

test("resolveRealPath follows a symlink to its target", () => {
  const base = tempDir();
  const real = path.join(base, "real");
  const link = path.join(base, "link");
  fs.mkdirSync(real);
  fs.symlinkSync(real, link);
  assert.equal(canonicalNodeDirectory({ path: link }, { realpath: fs.realpathSync.native, fallbackOnAnyError: true }), real);
});

test("resolveRealPath still normalizes a path that does not exist", () => {
  const base = tempDir();
  const messy = path.join(base, "a", "..", "b") + path.sep;
  assert.equal(canonicalNodeDirectory({ path: messy }, { realpath: fs.realpathSync.native, fallbackOnAnyError: true }), path.join(base, "b"));
});

test("resolveRealPath returns the normalized path when even the filesystem root cannot resolve", (t) => {
  const base = tempDir();
  t.onTestFinished(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.parse(base).root;
  let rootAttempts = 0;
  vi.spyOn(fs.realpathSync, "native").mockImplementation( (candidate) => {
    // Bound a broken traversal: a repeated root resolves elsewhere, so it fails by value instead
    // of hanging the test process. The fallback must return after the root's first failure.
    if (candidate === root && rootAttempts++ > 0) return path.join(root, "unexpected-retry");
    throw new Error("realpath unavailable");
  });

  assert.equal(canonicalNodeDirectory({ path: path.join(base, "a", "..", "missing") + path.sep }, { realpath: fs.realpathSync.native, fallbackOnAnyError: true }), path.join(base, "missing"));
});

test("isInsideDirectory is true for the container itself and for anything under it", () => {
  const repoRoot = tempDir();
  const nested = path.join(repoRoot, "sites", "example");
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(isInsideDirectory({ target: repoRoot, container: repoRoot }), true);
  assert.equal(isInsideDirectory({ target: nested, container: repoRoot }), true);
  assert.equal(isInsideDirectory({ target: `${nested}${path.sep}`, container: repoRoot }), true);
});

test("isInsideDirectory is false for a sibling whose name merely starts with the container's", () => {
  // The exact false positive a `startsWith` prefix test produces, which would refuse a legitimate
  // delete of a folder that has nothing to do with the checkout.
  const base = tempDir();
  const repoRoot = path.join(base, "Workspace");
  const sibling = path.join(base, "Workspace-backup");
  fs.mkdirSync(repoRoot);
  fs.mkdirSync(sibling);
  assert.equal(isInsideDirectory({ target: sibling, container: repoRoot }), false);
});

test("isInsideDirectory is not defeated by a `..` segment that climbs back into the container", () => {
  const repoRoot = tempDir();
  const nested = path.join(repoRoot, "sites", "example");
  fs.mkdirSync(nested, { recursive: true });
  const roundabout = path.join(repoRoot, "sites", "elsewhere", "..", "example");
  assert.equal(isInsideDirectory({ target: roundabout, container: repoRoot }), true);
});

test("isInsideDirectory is not defeated by a symlink pointing into the container", () => {
  const base = tempDir();
  const repoRoot = path.join(base, "repo");
  const inside = path.join(repoRoot, "sites", "example");
  fs.mkdirSync(inside, { recursive: true });
  const decoy = path.join(base, "innocent-looking-site");
  fs.symlinkSync(inside, decoy);
  assert.equal(isInsideDirectory({ target: decoy, container: repoRoot }), true);
});

test("isInsideDirectory is not defeated by a symlinked container", () => {
  const base = tempDir();
  const realRepo = path.join(base, "repo");
  const inside = path.join(realRepo, "sites", "example");
  fs.mkdirSync(inside, { recursive: true });
  const repoLink = path.join(base, "repo-link");
  fs.symlinkSync(realRepo, repoLink);
  assert.equal(isInsideDirectory({ target: inside, container: repoLink }), true);
});

test("mayEraseDirectory allows only a created row that lives outside the repo root", () => {
  const base = tempDir();
  const repoRoot = path.join(base, "repo");
  const outside = path.join(base, "my-site");
  fs.mkdirSync(repoRoot);
  writeSiteMeta(outside, "site-a");
  assert.equal(mayEraseDirectory({ row: createdRow(outside, "site-a"), protectedRoot: repoRoot, createdOrigin: "created", ...marker }), true);
});

test("mayEraseDirectory refuses a created row whose path now holds a DIFFERENT site", () => {
  // SEC-01/D-04, the whole finding: the operator moved their site elsewhere and something else took
  // its path. The row still says `created` and still points outside the repo, so provenance and
  // containment both pass — and the directory about to be erased was never made by this app.
  const base = tempDir();
  const repoRoot = path.join(base, "repo");
  const sitePath = path.join(base, "my-site");
  fs.mkdirSync(repoRoot);
  writeSiteMeta(sitePath, "site-a");
  const stale = createdRow(sitePath, "site-a");
  assert.equal(mayEraseDirectory({ row: stale, protectedRoot: repoRoot, createdOrigin: "created", ...marker }), true, "baseline: the site it names is still there");

  writeSiteMeta(sitePath, "site-b-someone-elses");
  assert.equal(mayEraseDirectory({ row: stale, protectedRoot: repoRoot, createdOrigin: "created", ...marker }), false);
});

test("mayEraseDirectory refuses a created row that recorded no site identity", () => {
  // A row written before identity was stamped. Nothing proves the directory at that path is still
  // the one this app created, so it is refused — the module's own fail-closed rule.
  const base = tempDir();
  const repoRoot = path.join(base, "repo");
  const outside = path.join(base, "legacy-created-site");
  fs.mkdirSync(repoRoot);
  writeSiteMeta(outside, "site-a");
  assert.equal(mayEraseDirectory({ row: row(outside, "created"), protectedRoot: repoRoot, createdOrigin: "created", ...marker }), false);
  for (const identity of ["", null, 42, {}]) {
    assert.equal(mayEraseDirectory({ row: { ...row(outside, "created"), identity }, protectedRoot: repoRoot, createdOrigin: "created", ...marker }), false, `identity ${JSON.stringify(identity)} must refuse`);
  }
});

test("mayEraseDirectory refuses a created row whose directory can no longer prove its identity", () => {
  const base = tempDir();
  const repoRoot = path.join(base, "repo");
  fs.mkdirSync(repoRoot);

  const gone = path.join(base, "deleted-by-hand");
  assert.equal(mayEraseDirectory({ row: createdRow(gone, "site-a"), protectedRoot: repoRoot, createdOrigin: "created", ...marker }), false, "absent directory");

  const markerless = path.join(base, "markers-removed");
  fs.mkdirSync(markerless);
  assert.equal(mayEraseDirectory({ row: createdRow(markerless, "site-a"), protectedRoot: repoRoot, createdOrigin: "created", ...marker }), false, "no .site-meta.json");

  const corrupt = path.join(base, "corrupt-meta");
  fs.mkdirSync(corrupt);
  fs.writeFileSync(path.join(corrupt, marker.markerFile), "{ this is not json");
  assert.equal(mayEraseDirectory({ row: createdRow(corrupt, "site-a"), protectedRoot: repoRoot, createdOrigin: "created", ...marker }), false, "unparseable .site-meta.json");
});

test("mayEraseDirectory refuses a null recorded identity when the live metadata has no usable identity", (t) => {
  const base = tempDir();
  t.onTestFinished(() => fs.rmSync(base, { recursive: true, force: true }));
  const repoRoot = path.join(base, "repo");
  fs.mkdirSync(repoRoot);
  const outside = writeSiteMeta(path.join(base, "unidentified-site"), "");

  assert.equal(mayEraseDirectory({ row: { ...row(outside, "created"), identity: null }, protectedRoot: repoRoot, createdOrigin: "created", ...marker }), false);
});

test("readDirectoryIdentity returns a site's own stamped id, and null for anything it cannot read", () => {
  const base = tempDir();
  assert.equal(readDirectoryIdentity({ directory: writeSiteMeta(path.join(base, "real"), "site-a"), ...marker }), "site-a");
  assert.equal(readDirectoryIdentity({ directory: path.join(base, "absent"), ...marker }), null);

  const noId = path.join(base, "no-id");
  fs.mkdirSync(noId);
  fs.writeFileSync(path.join(noId, marker.markerFile), JSON.stringify({ schemaVersion: 58 }));
  assert.equal(readDirectoryIdentity({ directory: noId, ...marker }), null);
});

test("mayEraseDirectory refuses an adopted row even when it lives outside the repo root", () => {
  const base = tempDir();
  const repoRoot = path.join(base, "repo");
  const outside = path.join(base, "someone-elses-site");
  fs.mkdirSync(repoRoot);
  fs.mkdirSync(outside);
  assert.equal(mayEraseDirectory({ row: row(outside, "adopted"), protectedRoot: repoRoot, createdOrigin: "created", ...marker }), false);
});

test("mayEraseDirectory refuses a repo-root directory whatever the row claims", () => {
  // The backstop: this is the arm that saves `<repo>/sites/example` from a row whose provenance is
  // wrong — a hand-edited projects file, or a future seeding path that forgets to say `adopted`.
  const repoRoot = tempDir();
  const inside = path.join(repoRoot, "sites", "example");
  fs.mkdirSync(inside, { recursive: true });
  assert.equal(mayEraseDirectory({ row: row(inside, "created"), protectedRoot: repoRoot, createdOrigin: "created", ...marker }), false);
  assert.equal(mayEraseDirectory({ row: row(repoRoot, "created"), protectedRoot: repoRoot, createdOrigin: "created", ...marker }), false);
});

test("mayEraseDirectory refuses everything when it cannot be told where the repo root is", () => {
  const base = tempDir();
  const outside = path.join(base, "my-site");
  writeSiteMeta(outside, "site-a");
  const tracked = createdRow(outside, "site-a");
  const repoRoot = path.join(base, "repo");
  fs.mkdirSync(repoRoot);
  assert.equal(mayEraseDirectory({ row: tracked, protectedRoot: repoRoot, createdOrigin: "created", ...marker }), true, "valid root is the only missing guard input");
  for (const options of [undefined, {}, { repoRoot: "" }, { repoRoot: null }, { repoRoot: 42 }] as ({ repoRoot?: unknown } | undefined)[]) {
    assert.equal(mayEraseDirectory({ row: tracked, protectedRoot: options?.repoRoot, createdOrigin: "created", ...marker }), false, `${JSON.stringify(options)} must refuse`);
  }
});

test("mayEraseDirectory refuses a row with no origin at all", () => {
  const base = tempDir();
  const repoRoot = path.join(base, "repo");
  const outside = path.join(base, "legacy-site");
  fs.mkdirSync(repoRoot);
  fs.mkdirSync(outside);
  assert.equal(mayEraseDirectory({ row: { directory: outside }, protectedRoot: repoRoot, createdOrigin: "created", ...marker }), false);
  assert.equal(mayEraseDirectory({ row: undefined, protectedRoot: repoRoot, createdOrigin: "created", ...marker }), false);
});

test("isInsideDirectory still catches a directory that no longer exists under a symlinked repo root", () => {
  // The dangerous asymmetry this guards: one side of the comparison follows the symlink and the
  // other does not, so a moved-or-deleted site dir reads as OUTSIDE the repo it plainly sits in.
  const base = tempDir();
  const realRepo = path.join(base, "real-repo");
  fs.mkdirSync(realRepo);
  const repoLink = path.join(base, "repo");
  fs.symlinkSync(realRepo, repoLink);

  const goneButInside = path.join(repoLink, "sites", "example");
  assert.equal(fs.existsSync(goneButInside), false);
  assert.equal(isInsideDirectory({ target: goneButInside, container: realRepo }), true);
});

function layout(t: { onTestFinished: (fn: () => void) => void }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'directory-delete-guard-'));
  t.onTestFinished(() => fs.rmSync(base, { recursive: true, force: true }));
  const repoRoot = path.join(base, 'repo');
  const directory = path.join(base, 'site');
  fs.mkdirSync(repoRoot);
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, marker.markerFile), JSON.stringify({ directoryToken: 'site-a' }));
  return { base, repoRoot, directory, row: { origin: 'created', directory, identity: 'site-a' } };
}

test('the fully valid created row outside the repo may be erased (the allow case every refusal below breaks once)', t => {
  const { row, repoRoot } = layout(t);
  assert.equal(mayEraseDirectory({ row: row, protectedRoot: repoRoot, createdOrigin: "created", ...marker }), true);
});

test('provenance: only origin "created" — adopted, unknown, missing, or no row at all is refused', t => {
  const { row, repoRoot } = layout(t);
  for (const origin of ['adopted', 'Created', '', undefined, 1]) assert.equal(mayEraseDirectory({ row: { ...row, origin }, protectedRoot: repoRoot, createdOrigin: "created", ...marker }), false, String(origin));
  assert.equal(mayEraseDirectory({ row: undefined, protectedRoot: repoRoot, createdOrigin: "created", ...marker }), false);
});

test('repo root: missing, empty or non-string options refuse', t => {
  const { row } = layout(t);
  for (const options of [undefined, {}, { repoRoot: '' }, { repoRoot: 5 }, { repoRoot: null }] as ({ repoRoot?: unknown } | undefined)[]) assert.equal(mayEraseDirectory({ row: row, protectedRoot: options?.repoRoot, createdOrigin: "created", ...marker }), false, JSON.stringify(options));
});

test('identity: the row must record a non-empty string id that equals the on-disk site id', t => {
  const { row, repoRoot, directory } = layout(t);
  for (const identity of ['', 5, undefined, 'site-b']) assert.equal(mayEraseDirectory({ row: { ...row, identity }, protectedRoot: repoRoot, createdOrigin: "created", ...marker }), false, String(identity));
  for (const meta of ['{"directoryToken":""}', '{"directoryToken":5}', '{}', 'null', 'not json', '{"directoryToken":"site-b"}']) {
    fs.writeFileSync(path.join(directory, marker.markerFile), meta);
    assert.equal(mayEraseDirectory({ row: row, protectedRoot: repoRoot, createdOrigin: "created", ...marker }), false, meta);
  }
  fs.rmSync(path.join(directory, marker.markerFile));
  assert.equal(mayEraseDirectory({ row: row, protectedRoot: repoRoot, createdOrigin: "created", ...marker }), false, 'no meta file');
});

test('readDirectoryIdentity returns the id only for a non-empty string', t => {
  const { directory } = layout(t);
  assert.equal(readDirectoryIdentity({ directory: directory, ...marker }), 'site-a');
  for (const [meta, expected] of [['{"directoryToken":""}', null], ['{"directoryToken":7}', null], ['null', null], ['[]', null], ['{"directoryToken":"x"}', 'x']] as const) {
    fs.writeFileSync(path.join(directory, marker.markerFile), meta);
    assert.equal(readDirectoryIdentity({ directory: directory, ...marker }), expected, meta);
  }
});

test('containment: the repo root itself, or anything inside it, is never erased even as a valid created site', t => {
  const { repoRoot } = layout(t);
  fs.writeFileSync(path.join(repoRoot, marker.markerFile), JSON.stringify({ directoryToken: 'root' }));
  assert.equal(mayEraseDirectory({ row: { origin: 'created', directory: repoRoot, identity: 'root' }, protectedRoot: repoRoot, createdOrigin: "created", ...marker }), false);
  const inner = path.join(repoRoot, 'sites', 'inner');
  fs.mkdirSync(inner, { recursive: true });
  fs.writeFileSync(path.join(inner, marker.markerFile), JSON.stringify({ directoryToken: 'inner' }));
  assert.equal(mayEraseDirectory({ row: { origin: 'created', directory: inner, identity: 'inner' }, protectedRoot: repoRoot, createdOrigin: "created", ...marker }), false);
});


test("the identity reader uses the injected text port and configured marker and field", () => {
  const reads: string[] = [];
  const readText = (file: string) => {
    reads.push(file);
    return JSON.stringify({ directoryToken: "right", siteId: "wrong" });
  };
  assert.equal(readDirectoryIdentity({ directory: "/workspace", ...marker }, { readText }), "right");
  assert.deepEqual(reads, [path.join("/workspace", marker.markerFile)]);
  assert.equal(readDirectoryIdentity({ directory: "/workspace", ...marker }, { readText: () => { throw new Error("denied"); } }), null);
});
