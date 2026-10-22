import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("all production modules in the package reject host names, aliases, and paths", () => {
  const forbidden = ["apps/" + "website", "#" + "src/", String.fromCharCode(116, 111, 118, 117)];
  const violations: string[] = [];
  let count = 0;
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "__tests__") visit(file); }
      else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !entry.name.includes(".test.")) {
        count++;
        const source = readFileSync(file, "utf8").toLowerCase();
        if (forbidden.some(value => source.includes(value))) violations.push(file);
      }
    }
  }
  visit(fileURLToPath(new URL("../", import.meta.url)));
  expect(count).toBeGreaterThan(0);
  expect(violations).toEqual([]);
});
