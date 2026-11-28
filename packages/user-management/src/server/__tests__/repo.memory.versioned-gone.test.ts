import { assertVersionedWrite, RecordVersionConflictError } from "@jini-ai/core/optimistic-concurrency";
import { describe, expect, it } from "vitest";
import { InMemoryRoleRepo, InMemoryWorkspaceRecords } from "../repo.memory.js";

// A versioned save whose basis names a row that no longer exists must be a conflict that reports the
// row as deleted (currentVersion null) and must not resurrect the row.
describe("in-memory versioned identity write — basis for a deleted row", () => {
  it("refuses with currentVersion null and leaves the workspace without the row", async () => {
    const repo = new InMemoryRoleRepo({ assertVersionedWrite });
    const role = { id: "role-gone", workspaceId: "w1", name: "Editors", isBuiltin: false, version: 3 };
    const error = await repo.save(role, { expectedVersion: 3 }).then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(RecordVersionConflictError);
    expect(error).toMatchObject({ recordKind: "role", recordId: "role-gone", expectedVersion: 3, currentVersion: null });
    expect((error as Error).message).toContain("it has since been deleted");
    expect(await repo.findById({ workspaceId: "w1", id: "role-gone" })).toBeNull();
  });
});

// The exported base class's generic upsert, used by any subclass that does not version its rows.
class NoteRows extends InMemoryWorkspaceRecords<{ workspaceId: string; id: string; text: string }> {}

describe("InMemoryWorkspaceRecords generic save", () => {
  it("replaces a row by workspace and id and leaves the same id in another workspace alone", async () => {
    const repo = new NoteRows({}, { initialRows: [{ workspaceId: "w1", id: "n", text: "old" }, { workspaceId: "w2", id: "n", text: "other" }] });
    await repo.save({ workspaceId: "w1", id: "n", text: "new" });
    await repo.save({ workspaceId: "w1", id: "m", text: "added" });
    expect(await repo.list({ workspaceId: "w1" })).toEqual([{ workspaceId: "w1", id: "n", text: "new" }, { workspaceId: "w1", id: "m", text: "added" }]);
    expect(await repo.list({ workspaceId: "w2" })).toEqual([{ workspaceId: "w2", id: "n", text: "other" }]);
  });
});
