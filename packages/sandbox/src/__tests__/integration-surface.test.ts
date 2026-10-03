import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("driver-neutral core and both adapters declare matching runtime entries", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  expect(manifest.jini.entries).toEqual({ "./core": "universal", "./e2b": "node", "./node-worker": "node" });
  expect(Object.keys(manifest.exports).sort()).toEqual(Object.keys(manifest.jini.entries).sort());
  expect(manifest.exports["./node-worker"]).toEqual({
    import: { types: "./dist/node-worker.d.ts", default: "./dist/node-worker.js" },
    require: { types: "./dist/cjs/node-worker.d.ts", default: "./dist/cjs/node-worker.js" },
  });
  expect(manifest.typesVersions["*"]["node-worker"]).toEqual(["./dist/node-worker.d.ts"]);
});
