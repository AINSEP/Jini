import assert from "node:assert/strict";
import { test } from "vitest";
import { InMemoryVendorCredentialSetRepo } from "../credential-sets/repo.memory.js";
import type { VendorCredentialSetRecord } from "../credential-sets/types.js";
function record(id: string, overrides: Partial<VendorCredentialSetRecord> = {}): VendorCredentialSetRecord {
    return { id, workspaceId: "ws-1", vendorId: "github", label: id,
        sealed: { keyId: "v1", alg: "aes-256-gcm", nonce: "fixture", ciphertext: "fixture" },
        tokenTail: "tail", isDefault: false, accountLabel: null,
        createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...overrides };
}
test("workspace and vendor scopes isolate IDs, labels, lists, and defaults", async () => {
    const repo = new InMemoryVendorCredentialSetRepo({});
    const a = record("shared", { label: "same", isDefault: true });
    const b = record("shared", { workspaceId: "ws-2", label: "same", isDefault: true });
    const c = record("other", { vendorId: "gitlab", label: "same", isDefault: true });
    for (const row of [a, b, c])
        await repo.insert(row);
    assert.deepEqual(await repo.findById({ workspaceId: "ws-2", id: "shared" }), b);
    assert.deepEqual(await repo.listByVendor({ workspaceId: "ws-1", vendorId: "github" }), [a]);
    assert.deepEqual(await repo.listByWorkspace({ workspaceId: "ws-1" }), [a, c]);
    assert.deepEqual(await repo.findDefaultByVendor({ workspaceId: "ws-2", vendorId: "github" }), b);
    assert.equal(await repo.findById({ workspaceId: "missing", id: "shared" }), null);
    assert.equal(await repo.findDefaultByVendor({ workspaceId: "missing", vendorId: "github" }), null);
});
test("duplicate labels reject insert and update without clearing another row's default", async () => {
    const repo = new InMemoryVendorCredentialSetRepo({});
    const a = record("a", { isDefault: true });
    const b = record("b");
    await repo.insert(a);
    await repo.insert(b);
    const expected = "UNIQUE constraint failed: vendor_credential_sets.workspace_id, vendor_credential_sets.vendor_id, vendor_credential_sets.label";
    await assert.rejects(() => repo.insert(record("c", { label: "a", isDefault: true })), { message: expected });
    await assert.rejects(() => repo.update({ ...b, label: "a", isDefault: true }), { message: expected });
    assert.deepEqual(await repo.listByWorkspace({ workspaceId: "ws-1" }), [a, b]);
    await repo.update({ ...b, isDefault: true });
    assert.deepEqual(await repo.findDefaultByVendor({ workspaceId: "ws-1", vendorId: "github" }), { ...b, isDefault: true });
    assert.equal((await repo.findById({ workspaceId: "ws-1", id: "a" }))?.isDefault, false);
});
test("deleting a default promotes the newest remaining row only within its vendor group", async () => {
    const repo = new InMemoryVendorCredentialSetRepo({});
    for (const row of [record("a", { isDefault: true }), record("b"),
        record("c", { updatedAt: "2026-02-01T00:00:00Z" }), record("d", { vendorId: "gitlab", isDefault: true })])
        await repo.insert(row);
    await repo.delete({ workspaceId: "ws-1", id: "a" });
    assert.equal((await repo.findDefaultByVendor({ workspaceId: "ws-1", vendorId: "github" }))?.id, "c");
    assert.equal((await repo.findDefaultByVendor({ workspaceId: "ws-1", vendorId: "gitlab" }))?.id, "d");
    await repo.delete({ workspaceId: "ws-1", id: "b" });
    await repo.delete({ workspaceId: "ws-1", id: "c" });
    await repo.delete({ workspaceId: "ws-1", id: "missing" });
    assert.equal(await repo.findDefaultByVendor({ workspaceId: "ws-1", vendorId: "github" }), null);
});
test("account-label updates touch only that field and ignore missing rows", async () => {
    const repo = new InMemoryVendorCredentialSetRepo({});
    const original = record("a", { isDefault: true });
    await repo.insert(original);
    await repo.updateAccountLabel({ workspaceId: "ws-1", id: "a", accountLabel: "octocat" });
    assert.deepEqual(await repo.findById({ workspaceId: "ws-1", id: "a" }), { ...original, accountLabel: "octocat" });
    await repo.updateAccountLabel({ workspaceId: "ws-2", id: "a", accountLabel: "wrong workspace" });
    assert.deepEqual(await repo.findById({ workspaceId: "ws-1", id: "a" }), { ...original, accountLabel: "octocat" });
});
