import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { writeFileAtomic, createNodeAtomicFilesystem } from "../atomic-write.js";

function mkFixtureDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atomic-write-"));
}

function isRoot(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

// PARITY: retained behavior against the canonical shared implementation.

test("writeFileAtomic: a brand-new destination lands at 0600, not the loose fs.writeFileSync default", () => {
  const dir = mkFixtureDir();
  try {
    const target = path.join(dir, "fresh.env");
    writeFileAtomic({ filePath: target, content:  "APP_SITE=my-site\n", fs: createNodeAtomicFilesystem({}) }, { tempName: () => "fixture-temp" });
    assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// PARITY: retained behavior against the canonical shared implementation.

test("writeFileAtomic: overwriting an existing 0600 file (e.g. .env) preserves its mode", () => {
  const dir = mkFixtureDir();
  try {
    const target = path.join(dir, ".env");
    fs.writeFileSync(target, "APP_ADMIN_PASSWORD=secret\n");
    fs.chmodSync(target, 0o600);
    writeFileAtomic({ filePath: target, content:  "APP_ADMIN_PASSWORD=secret\nAPP_SITE=new-site\n", fs: createNodeAtomicFilesystem({}) }, { tempName: () => "fixture-temp" });
    assert.equal(fs.statSync(target).mode & 0o777, 0o600, "activating a site must not widen .env's permissions");
    assert.equal(fs.readFileSync(target, "utf8"), "APP_ADMIN_PASSWORD=secret\nAPP_SITE=new-site\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// PARITY: retained behavior against the canonical shared implementation.

test("writeFileAtomic: overwriting an existing 0644 file preserves 0644 (preserve, not force-tighten)", () => {
  const dir = mkFixtureDir();
  try {
    const target = path.join(dir, ".site-meta.json");
    fs.writeFileSync(target, "{}");
    fs.chmodSync(target, 0o644);
    writeFileAtomic({ filePath: target, content:  '{"schemaVersion":2}', fs: createNodeAtomicFilesystem({}) }, { tempName: () => "fixture-temp" });
    assert.equal(fs.statSync(target).mode & 0o777, 0o644, "an unrelated already-0644 file must not be forced to 0600");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// PARITY: retained behavior against the canonical shared implementation.

test.skipIf(isRoot())("writeFileAtomic: a blocked write throws before any rename and leaves the destination untouched", () => {
  const dir = mkFixtureDir();
  try {
    const target = path.join(dir, ".env");
    fs.writeFileSync(target, "ORIGINAL\n");
    fs.chmodSync(dir, 0o500); // read + execute, no write: blocks creating the temp file
    assert.throws(() => writeFileAtomic({ filePath: target, content:  "REPLACED\n", fs: createNodeAtomicFilesystem({}) }, { tempName: () => "fixture-temp" }));
    fs.chmodSync(dir, 0o700); // restore before reading/cleanup
    assert.equal(fs.readFileSync(target, "utf8"), "ORIGINAL\n", "a blocked temp-file write must never reach the rename");
  } finally {
    fs.chmodSync(dir, 0o700);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
