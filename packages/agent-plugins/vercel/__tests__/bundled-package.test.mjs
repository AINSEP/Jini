import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

// The payload this plugin ships after its move from Tovu into Jini (2026-11-02). The folder walk
// below is what the assembler copies (tests excluded); the packed archive is covered by Jini's
// standalone-agent-plugin integration test.
const root = path.resolve(import.meta.dirname, "..");
const PLUGIN_ID = "vercel";

/** Every file this plugin ships, as forward-slash paths relative to the plugin root. */
async function shippedFiles() {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join("/"))
    .filter(file => !file.split("/").includes("__tests__") && path.basename(file) !== ".DS_Store").sort();
}

const readJson = async file => JSON.parse(await readFile(path.join(root, file), "utf8"));

test("Vercel ships exactly its payload, and every module its host contribution files name is in it", async () => {
  const files = await shippedFiles();
  assert.deepEqual(files, ["NOTES.md", "mcp.json", "object-stores/vercel-blob.mjs", "plugin.json", "skills/vercel/SKILL.md", "targets/vercel.mjs", "tovu-consent.json", "tovu-deploy-targets.json", "tovu-object-stores.json"]);
  for (const file of files.filter(name => /^tovu-.*\.json$/.test(name))) {
    const contribution = await readJson(file);
    for (const entry of [...(contribution.targets ?? []), ...(contribution.providers ?? [])]) {
      assert.ok(files.includes(entry.module), `${file} names ${entry.module}`);
    }
  }
});

test("Vercel keeps its publisher id and deploy-target capability (no id rewrite on the move)", async () => {
  const manifest = await readJson("plugin.json");
  assert.equal(manifest.name, PLUGIN_ID);
  assert.equal(manifest.extensions.jini.id, `tovu/${PLUGIN_ID}`);
  assert.ok(manifest.extensions.jini.provides.includes(`deploy-target:${PLUGIN_ID}`));
});

test("Vercel's shipped prose is host-neutral; quoted identifiers and messages stay as they are", async () => {
  const manifest = await readJson("plugin.json");
  assert.doesNotMatch(manifest.description, /\bTovu\b/);
  for (const file of (await shippedFiles()).filter(name => name.endsWith(".md"))) {
    const prose = (await readFile(path.join(root, file), "utf8")).replace(/`[^`\n]*`/g, "");
    assert.doesNotMatch(prose, /\bTovu\b/, file);
  }
});
