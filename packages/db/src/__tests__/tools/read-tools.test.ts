import { expect, it } from "vitest";
import { createDatabaseReadTools, defaultDbMessages, type DatabaseReadToolPorts } from "../../tools/index.js";
import { ToolInputError, type ToolExecutionContext } from "@jini-ai/core";
const ctx = (input: unknown = {}): ToolExecutionContext => ({ input, principal: { id: "owner" }, run: { id: "run" }, executionId: "exec", signal: new AbortController().signal });
it("authorizes before every portable DB effect, preserves read flags and keeps host migration handlers separate", async () => {
  let reads = 0;
  const registrations = createDatabaseReadTools({
    readers: {
      inputRecord: input => input as Record<string, unknown>, string: (input, key) => String(input[key]),
      noInput: () => {}, isRecord: (input): input is Record<string, unknown> => input !== null && typeof input === "object" && !Array.isArray(input),
      optionalString: (input, key) => input[key] as string | undefined,
      optionalNumber: (input, key) => input[key] as number | undefined,
      optionalBoolean: (input, key) => input[key] as boolean | undefined,
    },
    workspaceId: "ws", requirePermission: async () => { throw new Error("denied"); },
    introspection: { getHealth: async () => { reads++; return {}; }, getSchemaState: async () => { reads++; return {}; }, listPendingMigrations: async () => { reads++; return []; } },
    ledger: { query: async () => { reads++; return { items: [], nextCursor: null }; } },
    restorePoints: { list: async () => { reads++; return []; }, save: async () => { reads++; } },
    dbOps: { getCapabilities: async () => { reads++; return { restorePoint: { costClass: "cheap", kind: "file-snapshot" } }; }, captureRestorePoint: async () => { reads++; return { artifactRef: "snapshot", watermarkAtCapture: 4 }; } },
    clock: { nowMs: () => Date.parse("2026-10-02T00:00:00.000Z") }, idGen: { newId: () => "key" },
  });
  expect(registrations.map(tool => tool.descriptor.id)).toEqual(["database_query_timeline", "database_list_restore_points", "database_get_health", "database_get_schema_state", "database_list_pending_migrations", "backup_create_restore_point"]);
  for (const tool of registrations) {
    expect(tool.descriptor.readOnly).toBe(tool.descriptor.id !== "backup_create_restore_point");
    await expect(tool.handler(ctx())).rejects.toThrow("denied");
  }
  expect(reads).toBe(0);
});

// REGRESSION: fails if read-tool registration or restore-point dispatch drops the host messages.
it("forwards host copy through read-tool descriptors and restore-point refusals", async () => {
  let captures = 0;
  let saves = 0;
  const ports: DatabaseReadToolPorts = {
    workspaceId: "workspace", requirePermission: async () => {},
    readers: {
      inputRecord: () => ({}), string: () => "", noInput: () => {},
      isRecord: (input): input is Record<string, unknown> => input !== null && typeof input === "object" && !Array.isArray(input),
      optionalString: () => undefined, optionalNumber: () => undefined, optionalBoolean: () => undefined,
    },
    introspection: { getHealth: async () => ({}), getSchemaState: async () => ({}), listPendingMigrations: async () => [] },
    ledger: { query: async () => ({ items: [], nextCursor: null }) },
    restorePoints: { list: async () => [], save: async () => { saves++; } },
    dbOps: { getCapabilities: async () => ({ restorePoint: { costClass: "unavailable", kind: "none" } }), captureRestorePoint: async () => { captures++; return { artifactRef: "unused", watermarkAtCapture: 0 }; } },
    clock: { nowMs: () => Date.parse("2026-10-02T00:00:00.000Z") }, idGen: { newId: () => "key" },
  };
  const messages = { ...defaultDbMessages, databaseHealth: "host health descriptor", restorePointUnavailable: "host cannot capture" };
  const tools = new Map(createDatabaseReadTools(ports, { messages }).map(tool => [tool.descriptor.id, tool]));
  expect(tools.get("database_get_health")!.descriptor.description).toBe("host health descriptor");
  await expect(tools.get("backup_create_restore_point")!.handler(ctx())).rejects.toThrow("host cannot capture");
  expect([captures, saves]).toEqual([0, 0]);
});
it("forwards reads and persists manual restore-point provenance using host clock, id and capture ports", async () => {
  const saved: Record<string, unknown>[] = [];
  const permissions: string[] = [];
  const captures: string[] = [];
  const tools = new Map(createDatabaseReadTools({
    workspaceId: "workspace", requirePermission: async request => { permissions.push(request.permission); },
    readers: {
      inputRecord: input => input as Record<string, unknown>, string: (input, key) => String(input[key]), noInput: () => {},
      isRecord: (input): input is Record<string, unknown> => input !== null && typeof input === "object" && !Array.isArray(input),
      optionalString: (input, key) => input[key] as string | undefined, optionalNumber: (input, key) => input[key] as number | undefined, optionalBoolean: (input, key) => input[key] as boolean | undefined,
    },
    introspection: { getHealth: async () => ({ healthy: true }), getSchemaState: async () => ({ applied: 3 }), listPendingMigrations: async () => ["pending"] },
    ledger: { query: async filter => { expect(filter.kind).toBe("migration"); return { items: [], nextCursor: null }; } },
    restorePoints: { list: async () => [], save: async row => { saved.push(row); } },
    dbOps: { getCapabilities: async () => ({ restorePoint: { costClass: "cheap", kind: "file-snapshot" } }), captureRestorePoint: async input => { captures.push(input.scopeId); return { artifactRef: "host-snapshot", watermarkAtCapture: 17 }; } },
    clock: { nowMs: () => Date.parse("2026-10-02T00:00:00.000Z") }, idGen: { newId: () => "host-key" },
  }).map(tool => [tool.descriptor.id, tool]));
  expect(await tools.get("database_get_health")!.handler(ctx())).toEqual({ healthy: true });
  expect(await tools.get("database_get_schema_state")!.handler(ctx())).toEqual({ applied: 3 });
  expect(await tools.get("database_list_pending_migrations")!.handler(ctx())).toEqual(["pending"]);
  expect(await tools.get("database_query_timeline")!.handler(ctx({ kind: "migration" }))).toEqual({ items: [], nextCursor: null });
  expect(await tools.get("database_list_restore_points")!.handler(ctx())).toEqual({ items: [] });
  const result = await tools.get("backup_create_restore_point")!.handler(ctx({ trigger: "pre-migration" })) as { restorePoint: { id: string } };
  expect(captures).toEqual(["workspace"]);
  expect(saved).toEqual([{ restorePointId: result.restorePoint.id, idempotencyKey: "host-key", trigger: "manual", createdAt: "2026-10-02T00:00:00.000Z", createdBy: "owner", costClass: "cheap", kind: "file-snapshot", watermarkAtCapture: 17, artifactRef: "host-snapshot" }]);
  expect(permissions).toEqual(["database.read", "database.read", "database.read", "database.read", "database.read", "backup.create"]);
});

// REGRESSION (fix-plan C6a): the timeline tool passed `limit` straight through, so 0 queried an empty
// page and 300 reached getTimeline's cap as a plain Error the transport redacted to INTERNAL.
it("database_query_timeline caps an over-max limit and refuses a non-positive one before reading", async () => {
  const limits: number[] = [];
  const tools = new Map(createDatabaseReadTools({
    workspaceId: "workspace", requirePermission: async () => {},
    readers: {
      inputRecord: input => input as Record<string, unknown>, string: (input, key) => String(input[key]), noInput: () => {},
      isRecord: (input): input is Record<string, unknown> => input !== null && typeof input === "object" && !Array.isArray(input),
      optionalString: (input, key) => input[key] as string | undefined, optionalNumber: (input, key) => input[key] as number | undefined, optionalBoolean: (input, key) => input[key] as boolean | undefined,
    },
    introspection: { getHealth: async () => ({}), getSchemaState: async () => ({}), listPendingMigrations: async () => [] },
    ledger: { query: async filter => { limits.push(filter.limit); return { items: [], nextCursor: null }; } },
    restorePoints: { list: async () => [], save: async () => {} },
    dbOps: { getCapabilities: async () => ({ restorePoint: { costClass: "cheap", kind: "file-snapshot" } }), captureRestorePoint: async () => ({ artifactRef: "unused", watermarkAtCapture: 0 }) },
    clock: { nowMs: () => 0 }, idGen: { newId: () => "key" },
  }).map(tool => [tool.descriptor.id, tool]));
  const timeline = tools.get("database_query_timeline")!;
  await timeline.handler(ctx({ limit: 300 }));
  await timeline.handler(ctx(undefined));
  await expect(timeline.handler(ctx({ limit: 0 }))).rejects.toThrow(new ToolInputError({ message: "'limit' must be an integer between 1 and 200" }));
  await expect(timeline.handler(ctx({ limit: 0 }))).rejects.toBeInstanceOf(ToolInputError);
  expect(limits).toEqual([200, 50]);
});
