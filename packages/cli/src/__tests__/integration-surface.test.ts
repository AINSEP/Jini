import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import * as barrel from "../index.js";
import { introspectProgram, toMcpTools } from "../introspection.js";

test("the library exposes introspection without exporting the binary entrypoint", () => {
  expect(barrel.introspectProgram).toBe(introspectProgram);
  expect(barrel.toMcpTools).toBe(toMcpTools);
  expect("main" in barrel).toBe(false);
});

test("every published entry declares its runtime and introspection export targets", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  expect(manifest.jini.entries).toEqual({ ".": "node", "./introspection": "universal" });
  expect(Object.keys(manifest.exports).sort()).toEqual(Object.keys(manifest.jini.entries).sort());
  expect(manifest.exports["./introspection"]).toEqual({ types: "./dist/introspection.d.ts", import: "./dist/introspection.js", default: "./dist/introspection.js" });
});

test("injected file, warning, output and exit ports receive required objects", async () => {
  const readFile = vi.fn(async ({ path }: { path: string }) => `contents:${path}`);
  expect(await barrel.readPromptFromFlags({ flags: { "prompt-file": "/host/prompt.md" } }, { readFile })).toBe("contents:/host/prompt.md");
  expect(readFile).toHaveBeenCalledWith({ path: "/host/prompt.md" });
  const warn = vi.fn();
  await barrel.resolveDaemonUrl({}, { flagUrl: "http://remote.example", warn });
  expect(warn).toHaveBeenCalledWith({ message: expect.stringContaining("remote.example") });
  const write = vi.fn();
  const exit = vi.fn(({ code }: { code: number }): never => { throw new Error(`exited:${code}`); });
  expect(() => barrel.exitWithStructuredError({ code: "invalid-flag", message: "bad input" }, { write, exit })).toThrow("exited:2");
  expect(write).toHaveBeenCalledWith({ text: '{"error":{"code":"invalid-flag","message":"bad input","data":{}}}\n' });
  expect(exit).toHaveBeenCalledWith({ code: 2 });
});
