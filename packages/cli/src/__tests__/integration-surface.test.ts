import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

function productionSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : productionSourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

test("every declared @jini-ai dependency is imported by production source, and nothing else is declared", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const imported = new Set<string>();
  for (const file of productionSourceFiles(fileURLToPath(new URL("..", import.meta.url)))) {
    for (const match of readFileSync(file, "utf8").matchAll(/from\s+["'](@jini-ai\/[a-z-]+)(?:\/[^"']*)?["']/g)) {
      const [, name] = match;
      if (name !== undefined) imported.add(name);
    }
  }
  const declared = (field: string): string[] => Object.keys(manifest[field] ?? {}).filter((name) => name.startsWith("@jini-ai/")).sort();
  expect(declared("dependencies")).toEqual([...imported].sort());
  expect(declared("devDependencies")).toEqual([...imported].sort());
});

test("injected file, warning, output and exit ports receive required objects", async () => {
  const readFile = vi.fn(async ({ path }: { path: string }) => `contents:${path}`);
  expect(await barrel.readPromptFromFlags({ flags: { "prompt-file": "/host/prompt.md" } }, { readFile })).toBe("contents:/host/prompt.md");
  expect(readFile).toHaveBeenCalledWith({ path: "/host/prompt.md" });
  const warn = vi.fn();
  await barrel.resolveDaemonUrl({ env: {} }, { flagUrl: "http://remote.example", warn });
  expect(warn).toHaveBeenCalledWith({ message: expect.stringContaining("remote.example") });
  const write = vi.fn();
  const exit = vi.fn(({ code }: { code: number }): never => { throw new Error(`exited:${code}`); });
  expect(() => barrel.exitWithStructuredError({ code: "invalid-flag", message: "bad input" }, { write, exit })).toThrow("exited:2");
  expect(write).toHaveBeenCalledWith({ text: '{"error":{"code":"invalid-flag","message":"bad input","data":{}}}\n' });
  expect(exit).toHaveBeenCalledWith({ code: 2 });
});
