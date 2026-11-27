import { describe, expect, it, vi } from "vitest";

import { createDatabaseApi, type DatabaseApiDeps } from "../api/database-api.js";

function setup() {
  const wire = vi.fn<(required: { path: string }, optional?: { init?: RequestInit }) => Promise<unknown>>();
  const request: DatabaseApiDeps["request"] = <T,>(...args: Parameters<DatabaseApiDeps["request"]>) =>
    wire(...args) as Promise<T>;
  return { api: createDatabaseApi({ request }), wire };
}

const timelinePage = {
  items: [{ id: "evt-7", kind: "plugin.ddl", createdAt: "2026-08-04T12:30:00Z", restorePointId: null, outcome: "ok" }],
  nextCursor: "second/page+17=",
};

const schemaState = {
  status: "behind",
  siteMeta: { version: 4, tag: "site-4" },
  runtime: { version: 5, tag: "runtime-5" },
};

describe("createDatabaseApi", () => {
  it("omits the timeline query entirely when filters and cursor are absent or empty", async () => {
    const { api, wire } = setup();
    wire.mockResolvedValue(timelinePage);

    await expect(api.getDatabaseTimeline()).resolves.toStrictEqual(timelinePage);
    await expect(api.getDatabaseTimeline({ kind: "", outcome: "", fromDate: "", toDate: "", cursor: "" }))
      .resolves.toStrictEqual(timelinePage);
    expect(wire.mock.calls).toStrictEqual([
      [{ path: "/database/timeline" }],
      [{ path: "/database/timeline" }],
    ]);
  });

  it("encodes every timeline filter, the opaque cursor and the page limit without conflating fields", async () => {
    const { api, wire } = setup();
    wire.mockResolvedValue(timelinePage);

    await expect(api.getDatabaseTimeline({
      kind: "plugin.ddl", outcome: "ok & verified/✓", fromDate: "2026-08-01", toDate: "2026-08-04",
      cursor: "first/page+3=", limit: 17,
    })).resolves.toStrictEqual(timelinePage);
    const call = wire.mock.calls[0];
    expect(wire).toHaveBeenCalledTimes(1);
    const url = new URL(call![0].path, "https://site.example");
    expect(url.pathname).toBe("/database/timeline");
    expect([...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b))).toStrictEqual([
      ["cursor", "first/page+3="], ["fromDate", "2026-08-01"], ["kind", "plugin.ddl"],
      ["limit", "17"], ["outcome", "ok & verified/✓"], ["toDate", "2026-08-04"],
    ]);
    expect(call).toHaveLength(1);
  });

  it("reads schema drift without a write and lets a rejected check reach its caller", async () => {
    const { api, wire } = setup();
    const offline = new Error("schema host disconnected");
    wire.mockResolvedValueOnce(schemaState).mockRejectedValueOnce(offline);

    await expect(api.getDatabaseSchemaState()).resolves.toStrictEqual(schemaState);
    await expect(api.getDatabaseSchemaState()).rejects.toBe(offline);
    expect(wire.mock.calls).toStrictEqual([
      [{ path: "/database/schema-state" }],
      [{ path: "/database/schema-state" }],
    ]);
  });

  it("POSTs a bodyless plan, both plan credentials for confirmation, and only the one-time token for execution", async () => {
    const { api, wire } = setup();
    const plan = { planId: "plan-17", planHash: "hash-41", details: { migration: "0042" } };
    const confirmed = { confirmationToken: "one-time-89" };
    wire.mockResolvedValueOnce(plan).mockResolvedValueOnce(confirmed).mockResolvedValueOnce({ migrated: true });

    await expect(api.planMigrateForward()).resolves.toStrictEqual(plan);
    await expect(api.confirmMigrateForward({ planId: "plan-17", planHash: "hash-41" })).resolves.toStrictEqual(confirmed);
    await expect(api.executeMigrateForward({ confirmationToken: "one-time-89" })).resolves.toStrictEqual({ migrated: true });
    expect(wire.mock.calls).toStrictEqual([
      [{ path: "/database/migrate-forward/plan" }, { init: { method: "POST" } }],
      [{ path: "/database/migrate-forward/confirm" }, { init: { method: "POST", body: '{"planId":"plan-17","planHash":"hash-41"}' } }],
      [{ path: "/database/migrate-forward/execute" }, { init: { method: "POST", body: '{"confirmationToken":"one-time-89"}' } }],
    ]);
  });

  it("preserves explicit cost acknowledgment and the trigger on Recovery's shared restore-point route", async () => {
    const { api, wire } = setup();
    const captured = { restorePoint: { id: "rp-19", costClass: "expensive", kind: "snapshot" } };
    wire.mockResolvedValue(captured);

    await expect(api.createRecoveryRestorePoint({ trigger: "operator", costAck: false })).resolves.toStrictEqual(captured);
    await expect(api.createRecoveryRestorePoint({ trigger: "operator", costAck: true })).resolves.toStrictEqual(captured);
    await expect(api.createRecoveryRestorePoint()).resolves.toStrictEqual(captured);
    expect(wire.mock.calls).toStrictEqual([
      [{ path: "/database/restore-points" }, { init: { method: "POST", body: '{"trigger":"operator","costAck":false}' } }],
      [{ path: "/database/restore-points" }, { init: { method: "POST", body: '{"trigger":"operator","costAck":true}' } }],
      [{ path: "/database/restore-points" }, { init: { method: "POST", body: '{}' } }],
    ]);
  });
});
