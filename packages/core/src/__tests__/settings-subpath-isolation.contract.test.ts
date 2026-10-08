import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("isolates settings and its optional Express adapter from the kernel root", async () => {
  const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
  // Use the same source-closure guard as pnpm guard; importing the tooling by runtime path
  // keeps repository scripts outside this package's compiler root.
  const guardPath = fileURLToPath(new URL("../../../../scripts/check-subpath-isolation.ts", import.meta.url));
  const { auditSubpathIsolation } = await import(guardPath);
  const audit = auditSubpathIsolation({ repoRoot }, {});
  const violations = audit.findings.filter(
    (finding: { package: string; kind: string }) => finding.package === "@jini-ai/core"
      && ["a", "b", "resolution"].includes(finding.kind),
  );
  expect(violations).toEqual([]);

  type Closure = { package: string; subpath: string; files: string[]; dependencies: string[] };
  const closures: Closure[] = audit.closures.filter((closure: Closure) => closure.package === "@jini-ai/core");
  const root = closures.find(closure => closure.subpath === ".")!;
  const settings = closures.find(closure => closure.subpath === "./settings")!;
  const express = closures.find(closure => closure.subpath === "./settings/express")!;
  expect(root).toBeDefined();
  expect(settings).toBeDefined();
  expect(express).toBeDefined();
  expect(root.files.filter(file => file.startsWith("packages/core/src/settings/"))).toEqual([]);
  expect(root.dependencies).not.toContain("express");
  expect(settings.files).toContain("packages/core/src/settings/ensure-definitions.ts");
  expect(settings.files.filter(file => file.startsWith("packages/core/src/settings/express/"))).toEqual([]);
  expect(express.files).toContain("packages/core/src/settings/express/http.ts");
  for (const closure of [settings, express]) {
    expect(closure.files.filter(file => file.startsWith("packages/cms/"))).toEqual([]);
    expect(closure.dependencies).not.toContain("@jini-ai/cms");
  }

  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  expect(Object.keys(manifest.exports).sort()).toEqual(Object.keys(manifest.jini.entries).sort());
  expect(manifest.jini.entries["./settings"]).toBe("universal");
  expect(manifest.jini.entries["./settings/express"]).toBe("node");
  expect(manifest.peerDependencies.express).toBe("^4.21.0");
  expect(manifest.peerDependenciesMeta.express.optional).toBe(true);
  expect(manifest.dependencies?.express).toBeUndefined();
  expect(manifest.optionalDependencies?.express).toBeUndefined();
});
