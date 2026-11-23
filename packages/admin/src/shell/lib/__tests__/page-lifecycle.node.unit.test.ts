import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// Author Checklist / F7.2: run in an explicit non-browser host; the browser event
// branches are asserted via API output in api-request-page-unload.unit.test.ts.
it("can be imported outside a browser and reports a live document", () => {
  // Mutation: remove the typeof window guard; import fails in this real Node environment.
  // A real subprocess avoids the admin runner's browser-only global setup.
  const modulePath = resolve(process.cwd(), "src/shell/lib/page-lifecycle.ts");
  const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval",
    "const { isPageUnloading } = await import(process.argv[1]); console.log(JSON.stringify([typeof window, isPageUnloading(), isPageUnloading()]));",
    modulePath,
  ], { encoding: "utf8", timeout: 10_000 });
  expect(JSON.parse(output)).toEqual(["undefined", false, false]);
});
