import { describe, expect, test } from "vitest";

import { BUILTIN_PERMISSION_MIGRATIONS } from "../../core/builtin-permissions.js";
import type { PolicyPermissionRecord } from "../../core/types.js";
import {
  createPermissionMigrationRegistry,
  migrateDeprecatedPermissionGrants,
  type MigrateDeprecatedPermissionGrantsDeps,
  type PermissionMigration,
} from "../permission-migrations.js";
import { buildTraceHarness, WORKSPACE, type TraceHarness } from "./identity-call-trace.fixture.js";

/**
 * @file Characterization pins for `permission-migrations.ts` (L118b), written against the
 * pre-refactor code. The fan-out rewrites grants (SEC), so each branch of the nested loop is pinned
 * by exact row sets and exact write counts, plus the transaction boundary.
 */

const A_TO_BC: PermissionMigration = { from: "a", to: ["b", "c"], reason: "split a" };
const X_TO_Y: PermissionMigration = { from: "x", to: ["y"], reason: "rename x" };

function depsOf(h: TraceHarness, migrations: readonly PermissionMigration[]): MigrateDeprecatedPermissionGrantsDeps {
  return {
    transactions: h.repos.transactions,
    migrations,
    policyPermissions: h.repos.policyPermissions,
    policies: h.repos.policies,
    idGen: h.idGen,
    workspaceId: WORKSPACE,
  };
}

async function addPolicy(h: TraceHarness, id: string, grants: Array<string | Omit<PolicyPermissionRecord, "id" | "workspaceId" | "policyId">>): Promise<void> {
  await h.repos.policies.save({ id, workspaceId: WORKSPACE, name: id, description: id, isBuiltin: false, isFrozen: false });
  let n = 0;
  for (const grant of grants) {
    const shape = typeof grant === "string" ? { permission: grant, resourceType: null, constraintJson: null } : grant;
    await h.repos.policyPermissions.save({ id: `${id}-g${++n}`, workspaceId: WORKSPACE, policyId: id, ...shape });
  }
}

async function permsOf(h: TraceHarness, policyId: string): Promise<string[]> {
  return (await h.repos.policyPermissions.listByPolicyId({ workspaceId: WORKSPACE, policyId })).map((row) => row.permission).sort();
}

describe("migrateDeprecatedPermissionGrants", () => {
  test("no migrations: returns 0 without opening a transaction or reading policies", async () => {
    const h = buildTraceHarness();
    expect(await migrateDeprecatedPermissionGrants(depsOf(h, []))).toEqual({ migratedGrantCount: 0 });
    expect(h.calls).toEqual([]);
  });

  test("missing transaction port fails closed before any read", async () => {
    const h = buildTraceHarness();
    // Malformed-input fixture: a JS host that forgot to wire the port. The type forbids it.
    const deps = { ...depsOf(h, [A_TO_BC]), transactions: undefined } as unknown as MigrateDeprecatedPermissionGrantsDeps;
    await expect(migrateDeprecatedPermissionGrants(deps)).rejects.toThrow("identity mutation requires a transaction port");
    expect(h.calls).toEqual([]);
  });

  test("adds only missing targets, skips non-holders, counts each new row once, never removes `from`", async () => {
    const h = buildTraceHarness();
    await addPolicy(h, "holder", ["a", "c"]);
    await addPolicy(h, "nonholder", ["b"]);
    await addPolicy(h, "both", ["a", "x"]);
    h.calls.length = 0;

    const result = await migrateDeprecatedPermissionGrants(depsOf(h, [A_TO_BC, X_TO_Y]));
    const trace = [...h.calls];

    expect(result).toEqual({ migratedGrantCount: 4 });
    expect(await permsOf(h, "holder")).toEqual(["a", "b", "c"]);
    expect(await permsOf(h, "nonholder")).toEqual(["b"]);
    expect(await permsOf(h, "both")).toEqual(["a", "b", "c", "x", "y"]);
    expect(trace).toEqual([
      "transactions.run",
      "policies.list",
      "policyPermissions.listByPolicyId",
      "policyPermissions.save",
      "policyPermissions.listByPolicyId",
      "policyPermissions.listByPolicyId",
      "policyPermissions.save",
      "policyPermissions.save",
      "policyPermissions.save",
    ]);
  });

  test("written rows are unscoped and unconstrained, with fresh ids", async () => {
    const h = buildTraceHarness();
    await addPolicy(h, "p", ["x"]);
    await migrateDeprecatedPermissionGrants(depsOf(h, [X_TO_Y]));
    const rows = await h.repos.policyPermissions.listByPolicyId({ workspaceId: WORKSPACE, policyId: "p" });
    expect(rows.find((row) => row.permission === "y")).toEqual({ id: "id-1", workspaceId: WORKSPACE, policyId: "p", permission: "y", resourceType: null, constraintJson: null });
  });

  test("a target granted by an earlier pair in the same run is not written twice", async () => {
    const h = buildTraceHarness();
    await addPolicy(h, "p", ["a", "x"]);
    const result = await migrateDeprecatedPermissionGrants(depsOf(h, [A_TO_BC, { from: "x", to: ["b"], reason: "dup" }]));
    expect(result).toEqual({ migratedGrantCount: 2 });
    expect(await permsOf(h, "p")).toEqual(["a", "b", "c", "x"]);
  });

  test("a target granted in this run chains: it is NOT re-scanned as a `from` (single pass in pair order)", async () => {
    const h = buildTraceHarness();
    await addPolicy(h, "p", ["x"]);
    const result = await migrateDeprecatedPermissionGrants(depsOf(h, [{ from: "y", to: ["z"], reason: "later" }, X_TO_Y]));
    expect(result).toEqual({ migratedGrantCount: 1 });
    expect(await permsOf(h, "p")).toEqual(["x", "y"]);
  });

  test("a pair whose `to` list is empty writes nothing", async () => {
    const h = buildTraceHarness();
    await addPolicy(h, "p", ["a"]);
    expect(await migrateDeprecatedPermissionGrants(depsOf(h, [{ from: "a", to: [], reason: "none" }]))).toEqual({ migratedGrantCount: 0 });
  });

  test("rerun is idempotent: second pass writes nothing", async () => {
    const h = buildTraceHarness();
    await addPolicy(h, "p", ["a"]);
    await migrateDeprecatedPermissionGrants(depsOf(h, [A_TO_BC]));
    expect(await migrateDeprecatedPermissionGrants(depsOf(h, [A_TO_BC]))).toEqual({ migratedGrantCount: 0 });
  });

  test("a workspace with no policies migrates nothing", async () => {
    const h = buildTraceHarness();
    expect(await migrateDeprecatedPermissionGrants(depsOf(h, [A_TO_BC]))).toEqual({ migratedGrantCount: 0 });
  });

  test("a failing write rolls the whole fan-out back", async () => {
    const h = buildTraceHarness();
    await addPolicy(h, "p", ["a"]);
    let saves = 0;
    const deps = depsOf(h, [A_TO_BC]);
    const failing: MigrateDeprecatedPermissionGrantsDeps = {
      ...deps,
      policyPermissions: {
        listByPolicyId: (args) => deps.policyPermissions.listByPolicyId(args),
        save: async (record) => {
          if (++saves === 2) throw new Error("disk full");
          return deps.policyPermissions.save(record);
        },
        deleteByPolicyId: (args) => deps.policyPermissions.deleteByPolicyId(args),
        delete: (args) => deps.policyPermissions.delete(args),
      },
    };
    await expect(migrateDeprecatedPermissionGrants(failing)).rejects.toThrow("disk full");
    expect(await permsOf(h, "p")).toEqual(["a"]);
  });

  test("a SCOPED `from` grant fans out to an UNSCOPED `to` grant (reported, not fixed)", async () => {
    // Security weakness pinned as-is: `held` is built from every row regardless of
    // resourceType/constraintJson, so a policy holding `a` only for resourceType "post" gains an
    // unconstrained `b`/`c` — a widening. Conversely a scoped `b` suppresses the unscoped grant.
    const h = buildTraceHarness();
    await addPolicy(h, "p", [{ permission: "a", resourceType: "post", constraintJson: null }, { permission: "b", resourceType: "post", constraintJson: null }]);
    expect(await migrateDeprecatedPermissionGrants(depsOf(h, [A_TO_BC]))).toEqual({ migratedGrantCount: 1 });
    const rows = await h.repos.policyPermissions.listByPolicyId({ workspaceId: WORKSPACE, policyId: "p" });
    expect(rows.find((row) => row.permission === "c")).toMatchObject({ resourceType: null, constraintJson: null });
    expect(rows.filter((row) => row.permission === "b")).toHaveLength(1);
  });
});

describe("createPermissionMigrationRegistry", () => {
  test("lists built-ins in order when given nothing", () => {
    expect(createPermissionMigrationRegistry().list({})).toEqual([...BUILTIN_PERMISSION_MIGRATIONS]);
  });

  test("host pairs follow built-ins; a host pair with a built-in's `from` overwrites it in place", () => {
    const first = BUILTIN_PERMISSION_MIGRATIONS[0]!;
    const override: PermissionMigration = { from: first.from, to: ["override"], reason: "host" };
    const list = createPermissionMigrationRegistry({}, { migrations: [X_TO_Y, override] }).list({});
    expect(list[0]).toBe(override);
    expect(list.at(-1)).toBe(X_TO_Y);
    expect(list).toHaveLength(BUILTIN_PERMISSION_MIGRATIONS.length + 1);
  });

  test("register after creation appends; re-register overwrites without duplicating", () => {
    const registry = createPermissionMigrationRegistry();
    registry.register(X_TO_Y);
    const replacement: PermissionMigration = { from: "x", to: ["z"], reason: "again" };
    registry.register(replacement);
    const list = registry.list({});
    expect(list.filter((m) => m.from === "x")).toEqual([replacement]);
  });

  test("list returns a copy", () => {
    const registry = createPermissionMigrationRegistry();
    registry.list({}).push(X_TO_Y);
    expect(registry.list({})).toHaveLength(BUILTIN_PERMISSION_MIGRATIONS.length);
  });
});
