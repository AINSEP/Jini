import { expect, test } from "vitest";
import { deploymentsAgentToolCatalog } from "../agent-tools.js";

test("catalog permissions, side effects and arguments match the deployment contract", () => {
  const manifest = deploymentsAgentToolCatalog.map(tool => {
    const schema = tool.inputSchema as {
      type: string; required: string[]; additionalProperties: boolean;
      properties: Record<string, { type: string }>;
    };
    return {
      name: tool.name, permission: tool.authorization, sideEffects: tool.sideEffects,
      shape: schema.type, acceptsExtras: schema.additionalProperties, required: schema.required,
      fields: Object.fromEntries(Object.entries(schema.properties).map(([name, field]) => [name, field.type])),
    };
  });
  const read = { permission: { permission: "system.read" }, sideEffects: "none", shape: "object", acceptsExtras: false, required: [], fields: {} };
  expect(manifest).toEqual([
    { name: "deployment_trigger_export", permission: { permission: "system.export" }, sideEffects: "mutates-durable-state", shape: "object", acceptsExtras: false, required: [], fields: { basePath: "string", clean: "boolean" } },
    { ...read, name: "deployment_diagnose_static_export" },
    { ...read, name: "deployment_get_export_status" },
    { ...read, name: "deployment_get_dockerfile" },
    { name: "deployment_set_dockerfile", permission: { permission: "system.write" }, sideEffects: "mutates-durable-state", shape: "object", acceptsExtras: false, required: ["contents", "ifMatch"], fields: { contents: "string", ifMatch: "string" } },
  ]);
});

test("the export status catalog tells callers that failed assets make the copy incomplete", () => {
  const status = deploymentsAgentToolCatalog.find(tool => tool.name === "deployment_get_export_status");
  expect(status?.description).toMatch(/ok is true only when every route and asset exported successfully/i);
});
