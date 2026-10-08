import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("keeps every CMS subpath isolated at runtime and installation", async () => {
  const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
  // Resolve the source guard at runtime so the CMS compiler never includes repository tooling
  // outside its src root. The test invokes the SAME guard used by guard and guard:drift.
  const guardPath = fileURLToPath(new URL("../../../../scripts/check-subpath-isolation.ts", import.meta.url));
  const { auditSubpathIsolation } = await import(guardPath);
  const violations = auditSubpathIsolation({ repoRoot }, {}).findings.filter(
    (finding: { package: string; kind: string }) => finding.package === "@jini-ai/cms"
      && ["a", "b", "resolution"].includes(finding.kind),
  );
  expect(violations).toEqual([]);
});
