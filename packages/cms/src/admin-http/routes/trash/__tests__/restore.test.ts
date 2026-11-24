import { describe, expect, it } from "vitest";
import { trashRestoreRoute, type TrashRestoreRouteDeps } from "../restore.js";
import { MAX_TRASH_SELECTION } from "../shared.js";
import { ENTRY_FORBIDDEN, NOW, PRINCIPAL, raw, recordingGate, refusalOf, signal, unexpected, WORKSPACE_ID } from "./helpers.js";

const INVALID = { status: 400, body: { error: `expected { items: [{ entityType, entityId }] } with 1..${MAX_TRASH_SELECTION} entries`, code: "INVALID_INPUT" } };
const valid = { entityType: "post", entityId: "i" };

function deps(overrides: Partial<TrashRestoreRouteDeps> = {}): TrashRestoreRouteDeps {
  return { workspaceId: WORKSPACE_ID, authorizeEntry: recordingGate().authorizeEntry, clock: { nowIso: () => NOW }, trash: { restore: unexpected }, mayActOn: unexpected, ...overrides };
}
const run = (body: unknown, d: TrashRestoreRouteDeps, context: { id: string } | null = PRINCIPAL) =>
  trashRestoreRoute.handle({ input: { body }, deps: d, context: context ?? undefined }, { signal });

describe("trashRestoreRoute", () => {
  it("keeps the method, path, default status and no body cap", () => {
    expect(trashRestoreRoute.method).toBe("post");
    expect(trashRestoreRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/trash/restore");
    expect(trashRestoreRoute.successStatus).toBeUndefined();
    expect(trashRestoreRoute.maxBodyBytes).toBeUndefined();
    expect(trashRestoreRoute.parse(raw({}, { items: [] }))).toEqual({ ok: true, value: { body: { items: [] } } });
  });

  it("asks the entry gate before reading the selection, and a denial stops everything", async () => {
    const gate = recordingGate({ allowed: false, reason: "no_grant" });
    expect(await refusalOf(() => run(null, deps({ authorizeEntry: gate.authorizeEntry })))).toEqual(ENTRY_FORBIDDEN);
    expect(gate.calls).toEqual([{ principalId: PRINCIPAL.id }]);
  });

  it("refuses every malformed selection before restoring any row", async () => {
    for (const body of [null, 1, {}, { items: "x" }, { items: [] }, { items: Array(MAX_TRASH_SELECTION + 1).fill(valid) },
      { items: [valid, null] }, { items: [valid, { entityType: 1, entityId: "i" }] }, { items: [{ entityType: "", entityId: "i" }] },
      { items: [{ entityType: "post" }] }, { items: [{ entityType: "post", entityId: "" }] }]) {
      expect(await refusalOf(() => run(body, deps()))).toEqual(INVALID);
    }
  });

  it("restores per item: a forbidden row does not abort the rest, and only restored rows count", async () => {
    const restores: unknown[] = [];
    const checks: unknown[] = [];
    const d = deps({
      mayActOn: async (input) => { checks.push(input); return { allowed: input.entityType !== "comment" }; },
      trash: { restore: async (required, optional) => { restores.push({ required, optional }); return required.entityId === "gone" ? "not-found" : "restored"; } },
    });
    const items = [{ entityType: " post ", entityId: "p-1" }, { entityType: "comment", entityId: "c-1" }, { entityType: "post", entityId: "gone" }];
    expect(await run({ items }, d)).toEqual({ ok: true, value: { restored: 1, results: [
      { entityType: " post ", entityId: "p-1", outcome: "restored" },
      { entityType: "comment", entityId: "c-1", outcome: "forbidden" },
      { entityType: "post", entityId: "gone", outcome: "not-found" },
    ] } });
    expect(checks).toEqual(items.map((item) => ({ principalId: PRINCIPAL.id, ...item })));
    expect(restores).toEqual([
      { required: { workspaceId: WORKSPACE_ID, entityType: " post ", entityId: "p-1", at: NOW }, optional: { actor: { principalId: PRINCIPAL.id } } },
      { required: { workspaceId: WORKSPACE_ID, entityType: "post", entityId: "gone", at: NOW }, optional: { actor: { principalId: PRINCIPAL.id } } },
    ]);
  });

  it("fails closed without a principal and rethrows unexpected failures", async () => {
    await expect(run(null, deps(), null)).rejects.toThrow(/no authenticated principal/);
    await expect(run({ items: [valid] }, deps({ mayActOn: async () => { throw new Error("private"); } }))).rejects.toThrow("private");
  });
});
