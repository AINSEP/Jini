/** Registration binds catalog copy to handlers and refuses any catalog/risk disagreement. */
import { expect, it } from "vitest";
import type { AgentToolDefinition, ToolHandler } from "@jini-ai/core";
import { registrations } from "../../tools/registration.js";

const schema = { type: "object", properties: {} } as const;
const entry = (name: string, sideEffects: AgentToolDefinition["sideEffects"]): AgentToolDefinition =>
  ({ name, description: `${name} copy`, sideEffects, authorization: { permission: "database.read" }, inputSchema: schema });
const withoutSchema = ({ inputSchema: _schema, ...rest }: AgentToolDefinition): AgentToolDefinition => rest;
const handler: ToolHandler = async () => "handled";

it("publishes catalog copy, derives readOnly from the independent risk map and always allows at the policy layer", async () => {
  const registered = registrations({
    catalog: [entry("read_tool", "none"), entry("write_tool", "mutates-durable-state")],
    handlers: { read_tool: handler, write_tool: handler },
    risks: new Map([["read_tool", "none"], ["write_tool", "mutates-durable-state"]]),
  });
  expect(registered.map(tool => tool.descriptor)).toEqual([
    { id: "read_tool", description: "read_tool copy", inputSchema: schema, readOnly: true },
    { id: "write_tool", description: "write_tool copy", inputSchema: schema, readOnly: false },
  ]);
  // Authorization is the handlers' own inline permission check; the registration policy never refuses.
  expect(registered.map(tool => tool.policy.authorize({ principal: { id: "agent" }, run: { id: "run" }, tool: tool.descriptor, input: {} }))).toEqual(["allow", "allow"]);
  expect(await registered[0]!.handler({ executionId: "exec", principal: { id: "agent" }, run: { id: "run" }, input: {}, signal: new AbortController().signal })).toBe("handled");
});

it.each([
  { label: "a handler with no catalog entry", catalog: [] as AgentToolDefinition[], risk: "none" },
  { label: "a catalog entry without an input schema", catalog: [withoutSchema(entry("tool", "none"))], risk: "none" },
  { label: "a risk that disagrees with the catalog's declared side effects", catalog: [entry("tool", "none")], risk: "mutates-durable-state" },
])("refuses $label", ({ catalog, risk }) => {
  expect(() => registrations({ catalog, handlers: { tool: handler }, risks: new Map([["tool", risk]]) })).toThrow("database tool contract/risk mismatch: tool");
});
