/** Plugin authoring helper: prints (and with `write`, stores into the manifest) the integrity map of a plugin folder. */
import path from "node:path";
import { readFile, readdir, writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { computePluginIntegrity } from './install.js';
import { PLUGIN_MANIFEST_FILENAME, PLUGIN_MANIFEST_FILENAMES } from '../plugin-format.js';

/** Authoring helper: hashes bytes only; never imports the package's entry point. */
export async function runPluginIntegrityCommand(required: { dir: string; write?: boolean }, optional: { output?: (message: string) => void } = {}): Promise<void> {
  const integrity = await computePluginIntegrity({ sourceDir: required.dir });
  if (required.write) {
    const names = await readdir(required.dir);
    const sourceName = PLUGIN_MANIFEST_FILENAMES.find((name) => names.includes(name)) ?? PLUGIN_MANIFEST_FILENAME; // legacy alias
    const manifest = JSON.parse(await readFile(path.join(required.dir, sourceName), "utf8"));
    const manifestPath = path.join(required.dir, PLUGIN_MANIFEST_FILENAME);
    const staged = manifestPath + ".tmp-" + randomUUID();
    try {
      await writeFile(staged, JSON.stringify({ ...manifest, integrity }, null, 2) + "\n", { flag: "wx" });
      await rename(staged, manifestPath);
    } finally { await rm(staged, { force: true }); }
  }
  (optional.output ?? ((message: string) => process.stdout.write(message)))(JSON.stringify(integrity, null, 2) + "\n");
}
