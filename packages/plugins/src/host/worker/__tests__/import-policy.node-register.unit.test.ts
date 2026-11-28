import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "vitest";

import { registerTier2ImportPolicy } from "../import-policy.js";

/**
 * @file registerTier2ImportPolicy() with NO injected register: the real `node:module` register()
 * installs the hook in this test process. Kept in its own file because the hook stays registered
 * for the rest of the process; it only governs modules inside this test's temporary package, so
 * nothing else this process loads is affected.
 *
 * The package sits under a `node_modules` folder because Vitest imports such files with Node's own
 * loader (it externalizes them), so their imports go through the registered resolve hook exactly as
 * a worker's real import of a plugin entry does.
 *
 * Requirement-to-test map:
 * - the default registration really enforces the policy: an SDK specifier and an in-package path
 *   import resolve; any other bare specifier and a `../` climb out of the package are refused with
 *   the hook's exact messages.
 * - code outside the registered package resolves as before.
 */

async function write(file: string, source: string): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, source);
  return pathToFileURL(file).href;
}

test("registerTier2ImportPolicy() without a register seam installs the real hook: SDK and own files resolve, anything else is refused", async () => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "jini-tier2-native-")));
  try {
    const root = path.join(base, "node_modules", "t2-plugin");
    const entry = await write(path.join(root, "server", "index.mjs"), 'import { label } from "./lib/label.mjs";\nimport path from "node:path";\nexport default `${label}:${path.posix.join("a", "b")}`;\n');
    await write(path.join(root, "server", "lib", "label.mjs"), 'export const label = "own-file";\n');
    const bare = await write(path.join(root, "server", "reads-fs.mjs"), 'import "node:fs";\nexport default 1;\n');
    const climb = await write(path.join(root, "server", "climbs.mjs"), 'import "../../neighbour/index.mjs";\nexport default 1;\n');
    const outside = await write(path.join(base, "node_modules", "neighbour", "index.mjs"), 'import { readFileSync } from "node:fs";\nexport default typeof readFileSync;\n');

    registerTier2ImportPolicy({ entryPath: entry, packageRoot: root, policy: { sdkSpecifiers: ["node:path"] } });

    assert.equal((await import(entry)).default, "own-file:a/b");
    await assert.rejects(import(bare), { message: 'This plugin may not import "node:fs": a plugin may import only the plugin SDK (node:path) and its own files.' });
    await assert.rejects(import(climb), { message: 'This plugin may not import "../../neighbour/index.mjs": it is outside its own package.' });
    assert.equal((await import(outside)).default, "function", "a module outside the registered package is not governed by the policy");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
