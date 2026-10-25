import { afterEach, expect, test } from "vitest";
import { VaultError } from "@jini-ai/platform/secrets/credential-sets/contracts";
import { OWNER_WORKSPACE_ID, ownerContext } from "../service.js";
import { fixture, input, target } from "./fixture.js";

/** Deny-path tests for the owner vault's `authorize` guard (L2 §2/§8.1): each case breaks exactly
 *  ONE clause of `workspaceId !== owner || principalId !== null || !isCopyableKind[kind]`. */
const fixtures: ReturnType<typeof fixture>[] = [];
afterEach(async () => { for (const item of fixtures.splice(0)) await item.cleanup(); });
async function open() { const item = fixture(); fixtures.push(item); return item.open(); }

const expectContextError = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(VaultError);
  expect(error).toMatchObject({ code: "context" });
};

test("the owner context itself is authorized (allow case)", async () => {
  const store = await open();
  const entry = await store.put(input);
  expect(ownerContext(entry)).toEqual({ kind: "vendor", ownerKey: "plugin", binding: null, workspaceId: OWNER_WORKSPACE_ID, principalId: null });
  await expect(store.vault.list(ownerContext(entry))).resolves.toEqual([entry]);
});

test.each([
  ["another workspace", { workspaceId: "site-a" }],
  ["a workspace differing only by case", { workspaceId: "Owner" }],
  ["a non-null principal", { principalId: "user-1" }],
  ["an empty-string principal", { principalId: "" }],
])("vault access with %s is refused with VaultError{context}", async (_label, patch) => {
  const store = await open();
  const entry = await store.put(input);
  await expectContextError(store.vault.list({ ...ownerContext(entry), ...patch }));
  await expectContextError(store.vault.get({ ...ownerContext(entry), ...patch, id: entry.id }));
});

test.each(["personal-execution", "custom", "mcp-env", "mcp-auth", "api-connection"] as const)("non-copyable kind %s is refused even in the owner scope", async (kind) => {
  const store = await open();
  await expectContextError(store.vault.list(ownerContext({ kind, ownerKey: "plugin", binding: null })));
});

test("grant refuses an empty consumerId before touching the ledger", async () => {
  const store = await open();
  const entry = await store.put(input);
  await expectContextError(store.grant({ entryId: entry.id, consumerId: "" }));
  expect(await store.grants({})).toEqual([]);
});

test("revoke deletes the copy with the revoked id, not another copied entry of the same scope", async () => {
  const store = await open();
  const first = await store.put(input);
  const second = await store.put({ ...input, label: "Second key" });
  const site = target("one");
  for (const entry of [first, second]) await store.grant({ entryId: entry.id, consumerId: site.consumerId });
  await store.syncTo({ target: site });
  await store.revoke({ entryId: second.id, target: site });
  const scope = { ...ownerContext(first), workspaceId: site.workspaceId };
  expect((await site.vault.list(scope)).map(summary => summary.id)).toEqual([first.id]);
  await store.revoke({ entryId: first.id, target: site });
  expect(await site.vault.list(scope)).toEqual([]);
});
