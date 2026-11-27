import { expect, it, vi } from "vitest";
import { VaultError, type VaultRecord, type VaultContext, type VaultMeta } from "@jini-ai/core/contracts/vault";
import { createVaultMetaParsers, InMemoryVaultRepo, SecretsVaultService } from "@jini-ai/platform/secrets/credential-sets";
import { AesGcmSecretSealer } from "@jini-ai/platform/secrets";
import { InMemoryKeyring } from "@jini-ai/platform/secrets/testing";
import { DestinationUnreadableError, SealedDatabaseDestinationStore } from "../destination-store.js";

it("a non-default migrated singleton is readable", async () => {
  const repo = new InMemoryVaultRepo({});
  const scope = { kind: "database-destination", ownerKey: "host", principalId: null, provider: null, binding: null } as const;
  const record: VaultRecord = { ...scope, workspaceId: "ws", id: "legacy", label: "Destination", isDefault: false,
    revision: 1, sealed: null, last4: null, tokenLength: null, meta: {}, createdAt: "stamp", updatedAt: "stamp" };
  await repo.put({ record, expectedRevision: null });
  const vault = { findOne: vi.fn(async (input: VaultContext) => {
    const found = await repo.findOne(input);
    return found ? { summary: { ...found, configured: true }, payload: { connectionString: "private" } } : null;
  }), put: vi.fn(), patchMeta: vi.fn() } satisfies ConstructorParameters<typeof SealedDatabaseDestinationStore>[0]["vault"];
  const store = new SealedDatabaseDestinationStore({ repo, vault, scope, parseMeta: () => ({}), normalizeAddress: ({ value }) => value });
  expect((await store.get("ws"))?.connectionString).toBe("private");
  expect(vault.findOne).toHaveBeenCalledWith({ ...scope, workspaceId: "ws" });
});

it("a run finishing after replacement cannot patch the replacement", async () => {
  const repo = new InMemoryVaultRepo({});
  const scope = { kind: "database-destination", ownerKey: "host", principalId: null, provider: null, binding: null } as const;
  const original: VaultRecord = { ...scope, workspaceId: "ws", id: "old", label: "Destination", isDefault: false,
    revision: 1, sealed: null, last4: null, tokenLength: null, meta: {}, createdAt: "stamp", updatedAt: "stamp" };
  await repo.put({ record: original, expectedRevision: null });
  const patchMeta = vi.fn(async () => {
    await repo.delete({ workspaceId: "ws", id: "old", expectedRevision: 1 });
    await repo.put({ record: { ...original, id: "replacement" }, expectedRevision: null });
    throw new VaultError({ code: "conflict" });
  });
  const store = new SealedDatabaseDestinationStore({ repo, scope, vault: { findOne: vi.fn(), put: vi.fn(), patchMeta },
    parseMeta: () => ({}), normalizeAddress: ({ value }) => value });
  await store.recordRun("ws", { copied: true, snapshotAt: "stamp", tableCount: 1, rowCount: 1 });
  expect(patchMeta).toHaveBeenCalledTimes(1);
  expect((await repo.findOne({ ...scope, workspaceId: "ws" }))?.id).toBe("replacement");
});

const scope = { kind: "database-destination", ownerKey: "host", principalId: null, provider: null, binding: null } as const;
const createdAt = "2026-11-01T00:00:00Z";
const initial = {
  connectionString: " postgres://fixture-a.invalid/site ", savedAt: "2026-11-02T00:00:00Z",
  description: { host: "fixture-a.invalid", port: "5432", database: "site", user: "operator" },
};
const next = {
  connectionString: "postgres://fixture-b.invalid/other", savedAt: "2026-11-03T00:00:00Z",
  description: { host: "fixture-b.invalid", port: "5440", database: "other", user: "service" },
};
const summary = { copied: false, snapshotAt: "2026-11-03T02:00:00Z", code: "DESTINATION_UNAVAILABLE", message: "Copy not started" } as const;

function sealedFixture() {
  const repo = new InMemoryVaultRepo({});
  const parsers = createVaultMetaParsers({}, { parsers: {
    // The destination host owns savedAt, which the minimal platform parser does not declare.
    "database-destination": ({ meta }) => meta as VaultMeta,
  } });
  const keyring = new InMemoryKeyring({ hkdfSalt: "db-destination-test" });
  const service = new SecretsVaultService({ repo, keyring, sealer: new AesGcmSecretSealer({ keyring }),
    metaParsers: parsers, authorize: async () => {}, now: () => createdAt, newId: () => "fixture-destination" });
  const normalizeAddress = vi.fn(({ value }: { value: string }) => value.trim());
  const make = (patchMeta: typeof service.patchMeta = service.patchMeta.bind(service)) => new SealedDatabaseDestinationStore({
    repo, scope, parseMeta: parsers["database-destination"], normalizeAddress,
    vault: { findOne: service.findOne.bind(service), put: service.put.bind(service), patchMeta },
  });
  const saved = () => repo.findOne({ ...scope, workspaceId: "ws" });
  return { repo, service, make, saved, normalizeAddress };
}

it("address saves normalize plaintext, preserve a blank re-save, and reset last-run status on replacement", async () => {
  const { make, saved, normalizeAddress } = sealedFixture();
  const store = make();
  expect(await store.get("ws")).toBeNull();
  expect(await store.lastRun("ws")).toBeNull();
  await store.recordRun("ws", summary);
  expect(await saved()).toBeNull();

  await store.save("ws", initial);
  expect(await store.get("ws")).toEqual({ ...initial, connectionString: "postgres://fixture-a.invalid/site" });
  expect(await store.lastRun("ws")).toBeNull();
  await store.recordRun("ws", summary);
  expect(await store.lastRun("ws")).toEqual(summary);
  const before = await saved();
  expect(before).toMatchObject({
    id: "fixture-destination", label: "Database destination", last4: null, tokenLength: null,
    meta: { description: initial.description, savedAt: initial.savedAt, lastRun: summary },
  });
  expect(JSON.stringify(before)).not.toContain("postgres://fixture-a.invalid/site");
  await store.save("ws", { ...next, connectionString: "" });
  expect(await saved()).toEqual(before);
  expect(await store.lastRun("ws")).toEqual(summary);

  await store.save("ws", next);
  expect(await store.get("ws")).toEqual(next);
  expect(await store.lastRun("ws")).toBeNull();
  expect((await saved())?.id).toBe("fixture-destination");
  expect(normalizeAddress.mock.calls).toEqual([[{ value: initial.connectionString }], [{ value: next.connectionString }]]);
  expect(await store.get("another-workspace")).toBeNull();
});

it("a blank first save has no saved address to keep, so address validation refuses it and nothing is stored", async () => {
  const { make, saved, normalizeAddress } = sealedFixture();
  normalizeAddress.mockImplementationOnce(({ value }) => {
    if (value.trim() === "") throw new Error("database address is required");
    return value;
  });
  const store = make();
  await expect(store.save("ws", { ...initial, connectionString: "" })).rejects.toThrow("database address is required");
  expect(normalizeAddress.mock.calls).toEqual([[{ value: "" }]]);
  expect(await saved()).toBeNull();
});

it.each([null, 42])("redacts an invalid sealed connection string (%j) without blocking status metadata", async invalid => {
  const { make, service } = sealedFixture();
  const store = make();
  await service.put({ ...scope, workspaceId: "ws", label: "legacy", expectedRevision: null,
    meta: { description: initial.description, lastRun: summary }, payload: { connectionString: invalid } });
  const rejected = store.get("ws");
  await expect(rejected).rejects.toBeInstanceOf(DestinationUnreadableError);
  await expect(rejected).rejects.toThrow("the saved destination database could not be unlocked (the site's key may have changed); save it again with database_transfer_set_destination");
  expect(await store.lastRun("ws")).toEqual(summary);
});

it("a CAS conflict retries a metadata patch against the same sealed destination and preserves the concurrent edit", async () => {
  const { make, service, saved, repo } = sealedFixture();
  const store = make();
  await store.save("ws", initial);
  const patch = vi.fn<typeof service.patchMeta>(async (input) => {
    if (input.expectedRevision === 1) {
      await repo.patchMeta({ workspaceId: "ws", id: "fixture-destination", expectedRevision: 1, patch: { retained: "changed" }, updatedAt: createdAt });
    }
    return service.patchMeta(input);
  });
  const before = await saved();
  await make(patch).recordRun("ws", summary);
  const request = { ...scope, workspaceId: "ws", id: "fixture-destination", patch: { lastRun: summary } };
  expect(patch.mock.calls).toEqual([[{ ...request, expectedRevision: 1 }], [{ ...request, expectedRevision: 2 }]]);
  expect(await store.lastRun("ws")).toEqual(summary);
  expect(await saved()).toMatchObject({ sealed: before?.sealed, revision: 3, meta: { retained: "changed" } });
});

it("a completion cannot overwrite a replacement with the same vault id and a new envelope", async () => {
  const { make, service } = sealedFixture();
  const store = make();
  await store.save("ws", initial);
  const patch = vi.fn<typeof service.patchMeta>(async (input) => {
    await store.save("ws", next);
    return service.patchMeta(input);
  });
  await make(patch).recordRun("ws", summary);
  expect(patch.mock.calls).toEqual([[{ ...scope, workspaceId: "ws", id: "fixture-destination",
    expectedRevision: 1, patch: { lastRun: summary } }]]);
  expect(await store.get("ws")).toEqual(next);
  expect(await store.lastRun("ws")).toBeNull();
});

it.each([{ code: "conflict", attempts: 3 }, { code: "invalid-record", attempts: 1 }] as const)(
  "propagates $code after $attempts permitted run-status write attempts", async ({ code, attempts }) => {
    const { make, service } = sealedFixture();
    const store = make();
    await store.save("ws", initial);
    const error = new VaultError({ code });
    const patch = vi.fn<typeof service.patchMeta>(async () => { throw error; });
    await expect(make(patch).recordRun("ws", summary)).rejects.toBe(error);
    expect(patch.mock.calls).toEqual(Array.from({ length: attempts }, () => [
      { ...scope, workspaceId: "ws", id: "fixture-destination", expectedRevision: 1, patch: { lastRun: summary } },
    ]));
    expect(await store.lastRun("ws")).toBeNull();
    expect(await store.get("ws")).toEqual({ ...initial, connectionString: "postgres://fixture-a.invalid/site" });
  },
);
