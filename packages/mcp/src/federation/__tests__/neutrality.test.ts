import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "__tests__") return [];
    const name = join(directory, entry.name);
    return entry.isDirectory() ? sources(name) : name.endsWith(".ts") ? [name] : [];
  });
}

test("federation has no CMS/OAuth import and its main entry cannot load process adapters", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  for (const file of sources(root)) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /from\s+["']@jini-ai\/(?:cms|oauth)(?:[\/"'])/, file);
  }
  for (const file of sources(root).filter((file) => !file.includes("/stdio/") && !file.includes("/testing/"))) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /(?:from|export\s+\*)[^\n]*["'][^"']*stdio\//, file);
    assert.doesNotMatch(readFileSync(file, "utf8"), /from\s+["']node:(?:child_process|fs|os|path)["']/, file);
  }
});
