import { expect, it } from "vitest";
import { SITE_EVIDENCE_TOOL_ID, siteEvidenceAgentToolCatalog } from "../agent-tools.js";

it("publishes one read-only, site-scoped evidence tool with bounded inputs", () => {
  expect(SITE_EVIDENCE_TOOL_ID).toBe("site_collect_page_evidence");
  expect(siteEvidenceAgentToolCatalog.map(({ name }) => name)).toEqual(["site_collect_page_evidence"]);
  const [tool] = siteEvidenceAgentToolCatalog;
  expect(tool).toMatchObject({ sideEffects: "none", authorization: { permission: "content.read" } });
  const { type, additionalProperties, required, properties } = tool!.inputSchema!;
  expect({ type, additionalProperties, required }).toEqual({ type: "object", additionalProperties: false, required: ["paths"] });
  expect(Object.keys(properties ?? {}).sort()).toEqual(["collectAccessibility", "collectPerformance", "consentAcceptSelector", "paths"]);
  expect(properties).toMatchObject({
    paths: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } },
    consentAcceptSelector: { type: "string" },
    collectPerformance: { type: "boolean" },
    collectAccessibility: { type: "boolean" },
  });
  expect(tool!.description).toContain("EVIDENCE, NOT VERDICTS");
  expect(tool!.description).toContain("site-relative paths, never URLs");
  expect(tool!.description).toContain("never submits a form or any non-GET request");
});
