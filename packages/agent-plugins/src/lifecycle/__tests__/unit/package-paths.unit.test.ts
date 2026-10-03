import assert from "node:assert/strict";
import { normalizePackageEntryPath } from "../test-support.js";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "../legacy-test.js";

import { assertContainedOnDisk } from "../test-support.js";
import { PackagePathViolation } from "../../package-paths.js";

/**
 * @file Path-safety primitive shared by extraction (`install.ts`) and any future preview read.
 *
 * The Agent Plugins spec's own MUST is a filesystem-RESOLVED containment check, not a lexical one:
 * "the filesystem-resolved path MUST remain within the filesystem-resolved plugin root... clients
 * MUST reject package paths that resolve outside it" (agent-plugins.org spec v1.0.0). These tests
 * cover both the cheap lexical rejection (no filesystem call needed) and the realpath-based rejection
 * (a lexically clean path that is, or passes through, a symlink planted by a hostile archive).
 */

test("normalizePackageEntryPath: rejects a lexical '..' segment", () => {
  assert.throws(() => normalizePackageEntryPath("../outside"), PackagePathViolation);
});

test("normalizePackageEntryPath: rejects an absolute POSIX path", () => {
  assert.throws(() => normalizePackageEntryPath("/etc/passwd"), PackagePathViolation);
});

test("normalizePackageEntryPath: rejects a Windows drive-absolute path", () => {
  assert.throws(() => normalizePackageEntryPath("C:\\Windows\\System32"), PackagePathViolation);
});

test("normalizePackageEntryPath: rejects a NUL byte", () => {
  assert.throws(() => normalizePackageEntryPath("skills/a\0/SKILL.md"), PackagePathViolation);
});

test("normalizePackageEntryPath: accepts a normal relative path unchanged", () => {
  assert.equal(normalizePackageEntryPath("skills/a/SKILL.md"), "skills/a/SKILL.md");
});

test("normalizePackageEntryPath: normalizes backslashes to forward slashes", () => {
  assert.equal(normalizePackageEntryPath("skills\\a\\SKILL.md"), "skills/a/SKILL.md");
});

test("assertContainedOnDisk: accepts a path that resolves inside the root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "host-package-paths-test-"));
  try {
    await mkdir(path.join(root, "skills", "a"), { recursive: true });
    const resolved = await assertContainedOnDisk(root, "skills/a/SKILL.md");
    // Compared against the REALPATH'd root, not the raw tmpdir() string: on macOS `/var` is itself
    // a symlink to `/private/var`, and this function's whole job is to resolve through symlinks —
    // asserting against the un-resolved root would fail for a reason unrelated to what's under test.
    const realRoot = await realpath(root);
    assert.equal(resolved, path.join(realRoot, "skills", "a", "SKILL.md"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("assertContainedOnDisk: rejects a path whose PARENT is a symlink escaping the root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "host-package-paths-test-"));
  const outside = await mkdtemp(path.join(tmpdir(), "host-package-paths-outside-"));
  try {
    // A hostile archive plants a symlinked directory inside the root that resolves elsewhere on
    // disk; a later, lexically-innocent-looking entry underneath it must still be rejected because
    // the REAL, resolved path escapes root — this is exactly the two-step zip-slip vector (a
    // symlink entry, then a second entry that walks through it) the spec's MUST clause exists for.
    await symlink(outside, path.join(root, "escape"));
    await assert.rejects(
      () => assertContainedOnDisk(root, "escape/planted.txt"),
      PackagePathViolation,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("assertContainedOnDisk: rejects when the target ITSELF is a symlink escaping the root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "host-package-paths-test-"));
  const outsideFile = await mkdtemp(path.join(tmpdir(), "host-package-paths-outside-"));
  const outsideTarget = path.join(outsideFile, "secret.txt");
  await writeFile(outsideTarget, "secret");
  try {
    await symlink(outsideTarget, path.join(root, "leak.txt"));
    await assert.rejects(
      () => assertContainedOnDisk(root, "leak.txt"),
      PackagePathViolation,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outsideFile, { recursive: true, force: true });
  }
});

test("assertContainedOnDisk: re-resolves the root fresh on every call (no cached-root TOCTOU)", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "host-package-paths-test-"));
  try {
    await mkdir(path.join(root, "skills"), { recursive: true });
    // A plain, real subdirectory resolves fine even though `root` itself is re-realpath'd each call.
    const resolved = await assertContainedOnDisk(root, "skills");
    const realRoot = await realpath(root);
    assert.equal(resolved, path.join(realRoot, "skills"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
