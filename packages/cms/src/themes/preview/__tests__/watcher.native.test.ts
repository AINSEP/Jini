import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { createThemeWatcher } from "../watcher.node.js";

test("the default native watcher refreshes after a theme file changes on disk", async () => {
  const themesDir = await mkdtemp(join(tmpdir(), "jini-watch-"));
  const file = join(themesDir, "theme.json");
  let stop: (() => Promise<void>) | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await writeFile(file, '{"name":"Previous"}');
    const observed = new Promise<{ themesDir: string }>((resolve, reject) => {
      deadline = setTimeout(() => reject(new Error("Native watcher did not report the fixture change")), 2500);
      const start = createThemeWatcher({ onError: ({ error }) => reject(error) });
      const watcher = start({ themesDir, refresh: resolve }, { settleMs: 5 });
      stop = watcher.stop;
    });
    const [change] = await Promise.all([observed, writeFile(file, '{"name":"Updated"}')]);
    assert.deepEqual(change, { themesDir });
  } finally {
    clearTimeout(deadline);
    await stop?.();
    await rm(themesDir, { recursive: true, force: true });
  }
});
