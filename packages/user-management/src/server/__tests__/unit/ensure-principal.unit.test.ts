import { describe, expect, test } from "vitest";
import { IdentityValidationError, type PrincipalRecord, type PrincipalRepoPort } from "../../../core/index.js";
import { ensurePrincipal, InMemoryPrincipalRepo } from "../../index.js";

const clock = { nowMs: () => Date.parse("2026-10-28T12:00:00.000Z") };

describe("ensurePrincipal", () => {
  test("creates only an active user principal without credentials or grants", async () => {
    const principalRepo = new InMemoryPrincipalRepo({});
    const principal = await ensurePrincipal({ principalRepo, externalId: "owner-1", displayName: "Owner" }, { clock });

    expect(principal).toEqual({
      id: "owner-1", workspaceId: "local", kind: "user", displayName: "Owner",
      status: "active", createdAt: "2026-10-28T12:00:00.000Z",
    });
    expect(await principalRepo.list({ workspaceId: "local" })).toEqual([principal]);
  });

  test("resolves an existing external ID without overwriting its identity or disabled status", async () => {
    const existing: PrincipalRecord = {
      id: "owner-1", workspaceId: "local", kind: "user", displayName: "Original owner",
      status: "disabled", disabledAt: "2026-10-27T00:00:00.000Z", createdAt: "2026-10-01T00:00:00.000Z",
    };
    const principalRepo = new InMemoryPrincipalRepo({}, { initialRows: [existing] });

    expect(await ensurePrincipal({ principalRepo, externalId: "owner-1", displayName: "New name" }, { clock })).toEqual(existing);
    expect(await principalRepo.list({ workspaceId: "local" })).toEqual([existing]);
  });

  test("repeated calls remain idempotent after reopening persisted principal rows", async () => {
    const principalRepo = new InMemoryPrincipalRepo({});
    const input = { principalRepo, externalId: "owner-1", displayName: "Owner" };
    const first = await ensurePrincipal(input, { clock });
    expect(await ensurePrincipal(input, { clock })).toEqual(first);
    const rows = await principalRepo.list({ workspaceId: "local" });
    expect(rows).toEqual([first]);

    const reopened = new InMemoryPrincipalRepo({}, { initialRows: structuredClone(rows) });
    expect(await ensurePrincipal({ ...input, principalRepo: reopened }, { clock })).toEqual(first);
    expect(await reopened.list({ workspaceId: "local" })).toEqual([first]);
  });

  test("different external IDs with the same display name remain separate principals", async () => {
    const principalRepo = new InMemoryPrincipalRepo({});
    const first = await ensurePrincipal({ principalRepo, externalId: "owner-1", displayName: "Owner" }, { clock });
    const second = await ensurePrincipal({ principalRepo, externalId: "owner-2", displayName: "Owner" }, { clock });
    expect(second).toEqual({ ...first, id: "owner-2" });
    expect(await principalRepo.list({ workspaceId: "local" })).toEqual([first, second]);
  });

  test("a concurrent pair returns the same winning row and stores exactly one row", async () => {
    const principalRepo = new InMemoryPrincipalRepo({});
    const [first, second] = await Promise.all([
      ensurePrincipal({ principalRepo, externalId: "owner-1", displayName: "First" }, { clock }),
      ensurePrincipal({ principalRepo, externalId: "owner-1", displayName: "Second" }, { clock }),
    ]);

    expect(first.displayName).toBe("First");
    expect(second).toEqual(first);
    expect(await principalRepo.list({ workspaceId: "local" })).toEqual([first]);
  });

  test("trims accepted input before storage and lookup", async () => {
    const principalRepo = new InMemoryPrincipalRepo({});
    const first = await ensurePrincipal({ principalRepo, externalId: " owner-1 ", displayName: " Owner " }, { clock });
    expect(first.id).toBe("owner-1");
    expect(first.displayName).toBe("Owner");
    expect(await ensurePrincipal({ principalRepo, externalId: "owner-1", displayName: "Renamed" }, { clock })).toEqual(first);
    expect(await principalRepo.list({ workspaceId: "local" })).toEqual([first]);
  });

  test("the same external ID in another workspace stays a separate identity", async () => {
    const principalRepo = new InMemoryPrincipalRepo({});
    const input = { principalRepo, externalId: "owner-1", displayName: "Owner" };
    const local = await ensurePrincipal(input, { clock });
    const other = await ensurePrincipal(input, { clock, workspaceId: " other " });
    expect(other).toEqual({ ...local, workspaceId: "other" });
    expect(await principalRepo.list({ workspaceId: "local" })).toEqual([local]);
    expect(await principalRepo.list({ workspaceId: "other" })).toEqual([other]);
  });

  test.each(["externalId", "displayName", "workspaceId"] as const)("rejects invalid %s before writing", async (field) => {
    const invalidValues: unknown[] = ["", " \t\n ", "x".repeat(256), null, 123];
    if (field !== "workspaceId") invalidValues.push(undefined);
    for (const invalid of invalidValues) {
      const principalRepo = new InMemoryPrincipalRepo({});
      const input = { principalRepo, externalId: "owner-1", displayName: "Owner" };
      const options = { clock, workspaceId: "local" };
      if (field === "workspaceId") options.workspaceId = invalid as string;
      else input[field] = invalid as string;
      await expect(ensurePrincipal(input, options)).rejects.toBeInstanceOf(IdentityValidationError);
      expect(principalRepo.snapshotRows({})).toEqual([]);
    }
  });

  test("accepts the 255-character boundary for both caller strings", async () => {
    const principalRepo = new InMemoryPrincipalRepo({});
    const value = "x".repeat(255);
    const principal = await ensurePrincipal({ principalRepo, externalId: value, displayName: value }, { clock });
    expect(principal.id).toBe(value);
    expect(principal.displayName).toBe(value);
    expect(await principalRepo.list({ workspaceId: "local" })).toEqual([principal]);
  });

  test("fails closed when a repository cannot guarantee atomic insertion", async () => {
    const memory = new InMemoryPrincipalRepo({});
    const principalRepo: PrincipalRepoPort = {
      findById: (input) => memory.findById(input), list: (input) => memory.list(input), save: (record) => memory.save(record),
    };
    const result = ensurePrincipal({ principalRepo, externalId: "owner-1", displayName: "Owner" }, { clock });
    await expect(result).rejects.toBeInstanceOf(IdentityValidationError);
    await expect(result).rejects.toThrow("insertIfAbsent");
    expect(await memory.list({ workspaceId: "local" })).toEqual([]);
  });
});
