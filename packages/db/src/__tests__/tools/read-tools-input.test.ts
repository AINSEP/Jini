/** Input-shape rules of the read/restore-point tools: absent input is an empty object, anything else non-object is refused. */
import { expect, it } from "vitest";
import { ToolInputError, type ToolExecutionContext } from "@jini-ai/core";
import { createDatabaseReadTools, type DatabaseReadToolPorts } from "../../tools/index.js";

const ctx = (input: unknown): ToolExecutionContext => ({ input, principal: { id: "owner" }, run: { id: "run" }, executionId: "exec", signal: new AbortController().signal });

function harness() {
  const permissions: string[] = [];
  const filters: unknown[] = [];
  const saved: Record<string, unknown>[] = [];
  const ports: DatabaseReadToolPorts = {
    workspaceId: "ws", requirePermission: async request => { permissions.push(request.permission); },
    readers: {
      inputRecord: input => input as Record<string, unknown>, string: (input, key) => String(input[key]), noInput: () => {},
      isRecord: (input): input is Record<string, unknown> => input !== null && typeof input === "object" && !Array.isArray(input),
      optionalString: (input, key) => input[key] as string | undefined, optionalNumber: (input, key) => input[key] as number | undefined,
      optionalBoolean: (input, key) => input[key] as boolean | undefined,
    },
    introspection: { getHealth: async () => ({}), getSchemaState: async () => ({}), listPendingMigrations: async () => [] },
    ledger: { query: async filter => { filters.push(filter); return { items: [], nextCursor: null }; } },
    restorePoints: { list: async () => [], save: async row => { saved.push(row); } },
    dbOps: { getCapabilities: async () => ({ restorePoint: { costClass: "expensive", kind: "logical-dump" } }), captureRestorePoint: async () => ({ artifactRef: "dump", watermarkAtCapture: 3 }) },
    clock: { nowMs: () => 0 }, idGen: { newId: () => "key" },
  };
  const tools = new Map(createDatabaseReadTools(ports).map(tool => [tool.descriptor.id, tool]));
  return { tools, permissions, filters, saved };
}

it.each(["database_query_timeline", "backup_create_restore_point"])("%s refuses non-object input before asking for permission", async id => {
  const h = harness();
  for (const input of ["text", 7, ["kind"], null]) {
    await expect(h.tools.get(id)!.handler(ctx(input))).rejects.toThrow(new ToolInputError({ message: "input must be an object" }));
  }
  expect(h.permissions).toEqual([]);
});

it("database_query_timeline treats absent input as no filter with the default page size", async () => {
  const h = harness();
  expect(await h.tools.get("database_query_timeline")!.handler(ctx(undefined))).toEqual({ items: [], nextCursor: null });
  expect(h.filters).toEqual([{ kind: undefined, outcome: undefined, fromDate: undefined, toDate: undefined, cursor: undefined, limit: 50 }]);
});

it("backup_create_restore_point treats absent input as no cost acknowledgment, so an expensive capture is refused", async () => {
  const h = harness();
  await expect(h.tools.get("backup_create_restore_point")!.handler(ctx(undefined))).rejects.toThrow("an 'expensive' restore point requires an explicit costAck");
  expect(h.permissions).toEqual(["backup.create"]);
  expect(h.saved).toEqual([]);
});
