import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

// Moved from Tovu (content/agent-plugins/railway), where the package pins packed through Tovu's
// lifecycle wrapper; those, the credential-card, deploy-ops registry and installed-plugin cases
// need the host and stay with Tovu's overlay tests. These pin the portable payload itself.
const root = path.resolve(import.meta.dirname, "..");

/** Every file this plugin ships, as forward-slash paths relative to the plugin root. */
async function shippedFiles() {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join("/"))
    .filter((file) => !file.split("/").includes("__tests__")).sort();
}

const readJson = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));

test("railway ships exactly its portable payload and none of the host's files", async () => {
  assert.deepEqual(await shippedFiles(), [
    "deploy-configs/railway.mjs", "deploy-ops/railway.mjs", "mcp.json", "plugin.json", "skills/railway/SKILL.md",
    "tovu-deploy-configs.json", "tovu-deploy-ops.json",
  ]);
});

test("railway keeps its publisher id, contributions and frozen contribution file names", async () => {
  const manifest = await readJson("plugin.json");
  assert.equal(manifest.name, "railway");
  assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.extensions.tovu.id, "tovu/railway");
  assert.deepEqual(manifest.extensions.tovu.provides, ["deploy-config:railway", "deploy-ops:railway"]);
  const configs = await readJson("tovu-deploy-configs.json");
  const ops = await readJson("tovu-deploy-ops.json");
  const files = await shippedFiles();
  for (const entry of [...configs.generators, ...ops.platforms]) assert.ok(files.includes(entry.module), entry.module);
});

test("railway's skill and shared files name no host: host text arrives through the host's overlay", async () => {
  for (const file of (await shippedFiles()).filter((name) => /\.(md|toml|yml|mjs)$/.test(name))) {
    const text = await readFile(path.join(root, file), "utf8");
    assert.doesNotMatch(text, /Tovu|TOVU_|tovu deploy|Chromium/, file);
  }
});
