import { describe, expect, it } from "vitest";
import { getDatabaseAgentToolCatalog } from "../../tools/database-catalog.js";

/** L2 §8 / TEST-ANTIPATTERNS AP5: an inline contract per tool — permission, side effects, actor rule
 *  and input schema — so dropping any authorization or schema field fails here, not in production. */
const NO_INPUT = { type: "object", additionalProperties: false, required: [], properties: {} };

describe("database agent tool catalog contract", () => {
  const catalog = getDatabaseAgentToolCatalog();
  const byName = Object.fromEntries(catalog.map(tool => [tool.name, tool]));

  it("declares exactly these nine tools, in order", () => {
    expect(catalog.map(tool => tool.name)).toEqual([
      "database_get_health", "database_get_schema_state", "database_list_pending_migrations", "database_query_timeline",
      "database_list_restore_points", "database_plan_migrate_forward", "database_execute_migrate_forward",
      "backup_create_restore_point", "database_get_restore_guidance",
    ]);
  });

  it.each([
    ["database_get_health", "database.read", "none", NO_INPUT],
    ["database_get_schema_state", "database.read", "none", NO_INPUT],
    ["database_list_pending_migrations", "database.read", "none", NO_INPUT],
    ["database_list_restore_points", "database.read", "none", NO_INPUT],
    ["database_plan_migrate_forward", "database.read", "none", NO_INPUT],
    ["database_execute_migrate_forward", "database.migrate", "mutates-durable-state", NO_INPUT],
  ])("%s requires %s, side effects %s, no-input schema", (name, permission, sideEffects, schema) => {
    const tool = byName[name]!;
    expect(tool.authorization).toEqual({ permission });
    expect(tool.sideEffects).toBe(sideEffects);
    expect(tool.inputSchema).toEqual(schema);
  });

  it("migrate-forward execution is human-confirmed by its own delegator; no other tool carries an actor rule", () => {
    expect(byName.database_execute_migrate_forward!.actorClassRule).toBe("confirmer-must-equal-own-delegatedBy");
    for (const tool of catalog.filter(t => t.name !== "database_execute_migrate_forward")) expect(tool.actorClassRule).toBeUndefined();
  });

  it("timeline query schema is closed, all-optional, and caps limit at 1..200", () => {
    const tool = byName.database_query_timeline!;
    expect(tool.authorization).toEqual({ permission: "database.read" });
    expect(tool.sideEffects).toBe("none");
    const schema = tool.inputSchema as { additionalProperties: boolean; required: string[]; properties: Record<string, { type: string; minimum?: number; maximum?: number }> };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual([]);
    expect(Object.keys(schema.properties)).toEqual(["kind", "outcome", "fromDate", "toDate", "cursor", "limit"]);
    expect(schema.properties.limit).toMatchObject({ type: "integer", minimum: 1, maximum: 200 });
    for (const key of ["kind", "outcome", "fromDate", "toDate", "cursor"]) expect(schema.properties[key]!.type).toBe("string");
  });

  it("restore-point creation needs backup.create and exposes only costAck (never a model-settable trigger)", () => {
    const tool = byName.backup_create_restore_point!;
    expect(tool.authorization).toEqual({ permission: "backup.create" });
    expect(tool.sideEffects).toBe("mutates-durable-state");
    const schema = tool.inputSchema as { type: string; additionalProperties: boolean; required: string[]; properties: Record<string, { type: string }> };
    expect(schema).toMatchObject({ type: "object", additionalProperties: false, required: [] });
    expect(Object.keys(schema.properties)).toEqual(["costAck"]);
    expect(schema.properties.costAck!.type).toBe("boolean");
  });

  it("restore guidance is a read with no input schema (unwired hand-off)", () => {
    const tool = byName.database_get_restore_guidance!;
    expect(tool.authorization).toEqual({ permission: "database.read" });
    expect(tool.sideEffects).toBe("none");
    expect(tool.inputSchema).toBeUndefined();
  });

  it("host messages replace descriptions without touching contracts", () => {
    const custom = getDatabaseAgentToolCatalog({}, { messages: new Proxy({}, { get: (_t, key) => `msg:${String(key)}` }) as never });
    expect(custom.find(t => t.name === "database_get_health")!.description).toBe("msg:databaseHealth");
    expect(custom.map(t => t.authorization)).toEqual(catalog.map(t => t.authorization));
  });
});
