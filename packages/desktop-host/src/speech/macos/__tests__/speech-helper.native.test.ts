import { test, onTestFinished } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

test.skipIf(process.platform !== "darwin")("native helper emits the availability JSON contract without prompting", (context) => {
  const toolchain = spawnSync("swiftc", ["--version"], { encoding: "utf8", timeout: 10000 });
  // This probes the host toolchain, before our source or helper runs. A missing or unresponsive
  // compiler cannot validate the native contract; compilation/helper failures below still fail.
  if (toolchain.error && "code" in toolchain.error &&
    (toolchain.error.code === "ENOENT" || toolchain.error.code === "ETIMEDOUT")) { context.skip(); return; }
  assert.ifError(toolchain.error);
  assert.equal(toolchain.status, 0, toolchain.stderr);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "speech-contract-"));
  onTestFinished(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = fileURLToPath(new URL("../speech-helper.swift", import.meta.url));
  const binary = path.join(directory, "helper");
  const compiled = spawnSync("swiftc", ["-module-cache-path", path.join(directory, "cache"), source, "-o", binary], { encoding: "utf8", timeout: 30000 });
  assert.equal(compiled.status, 0, compiled.stderr);
  const checked = spawnSync(binary, ["check", "en-US"], { encoding: "utf8", timeout: 20000 });
  assert.equal(checked.status, 0, checked.stderr);
  const payload = JSON.parse(checked.stdout);
  assert.deepEqual(Object.keys(payload).sort(), ["available", "reason"]);
  assert.equal(typeof payload.available, "boolean");
  if (payload.available) assert.equal(payload.reason, null);
  else assert.equal(typeof payload.reason, "string");
}, 60000);
