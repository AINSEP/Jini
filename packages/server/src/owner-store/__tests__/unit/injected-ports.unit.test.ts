import { expect, test } from "vitest";
import { countLegacyOwnerStore, readLegacyOwnerStore, type LegacyOwnerStorePorts } from "../../index.js";
import type { SqliteOpener } from "@jini-ai/core/contracts/storage";
import type { VaultRepoPort } from "@jini-ai/core/contracts/vault";

/** Owner K5: the owner-store wiring gets every implementation from the host. These fakes prove it
 * uses exactly what it is handed: the opener (read-only), the row reads, the vault repo and decoder.
 */
type FakeKernel = { name: string; closed: boolean; close(): Promise<void> };
const open: SqliteOpener = () => { throw new Error("the injected kernel opener must be used, not the native one"); };

function fakes() {
  const calls: string[] = [];
  const kernel: FakeKernel = { name: "fake-kernel", closed: false, close: async () => { kernel.closed = true; } };
  const repo = { name: "fake-repo" } as unknown as VaultRepoPort;
  const vault = { name: "fake-vault" };
  const row = { id: "e1", kind: "vendor" as const, ownerKey: "plugin", binding: null };
  const ports: LegacyOwnerStorePorts<FakeKernel, typeof vault, { decoded: string }, { metaParsers?: string }> = {
    openKernel: (file, options) => { calls.push(`open ${file.filePath} ${JSON.stringify(options)}`); return kernel; },
    countOwnerStoreRows: async args => { calls.push(`count ${args.kernel.name}`); return { entries: 3, grants: 2 }; },
    listOwnerEntryRows: async args => { calls.push(`rows ${args.kernel.name} ${args.workspaceId}`); return [row]; },
    listOwnerDestinations: async args => { calls.push(`dest ${args.table}`); return [{ entryId: "e1", consumerId: `/${args.table}` }]; },
    createVaultRepo: args => { calls.push(`repo ${args.kernel.name}`); return repo; },
    ownerWorkspaceId: "fake-owner",
    openLegacyOwnerVault: (args, options) => {
      calls.push(`vault ${args.repo === repo} ${args.keyFilePath} ${options.metaParsers}`); return vault;
    },
    readLegacyOwnerEntry: async args => { calls.push(`entry ${args.vault === vault} ${args.row.id}`); return { decoded: args.row.id }; },
  };
  return { calls, kernel, ports };
}

test("count opens the file through the injected kernel opener, read-only, and closes it", async () => {
  const { calls, kernel, ports } = fakes();
  expect(await countLegacyOwnerStore({ filePath: "/x/owner.db", open, ports })).toEqual({ entries: 3, grants: 2 });
  expect(calls).toEqual(['open /x/owner.db {"readOnly":true}', "count fake-kernel"]);
  expect(kernel.closed).toBe(true);
});

test("read builds the vault from the injected repo and decoder, on the same read-only connection", async () => {
  const { calls, kernel, ports } = fakes();
  const snapshot = await readLegacyOwnerStore({ filePath: "/x/owner.db", keyFilePath: "/x/owner.key", open, ports }, { metaParsers: "host-policy" });
  expect(snapshot).toEqual({ entries: [{ decoded: "e1" }], grants: [{ entryId: "e1", consumerId: "/owner_grants" }],
    revocations: [{ entryId: "e1", consumerId: "/owner_revocations" }] });
  expect(calls).toEqual(['open /x/owner.db {"readOnly":true}', "repo fake-kernel", "vault true /x/owner.key host-policy",
    "rows fake-kernel fake-owner", "entry true e1", "dest owner_grants", "dest owner_revocations"]);
  expect(kernel.closed).toBe(true);
});

test("the kernel is closed even when an injected read throws", async () => {
  const { kernel, ports } = fakes();
  ports.listOwnerEntryRows = async () => { throw new Error("locked"); };
  await expect(readLegacyOwnerStore({ filePath: "/x/owner.db", keyFilePath: "/x/owner.key", open, ports })).rejects.toThrow("locked");
  expect(kernel.closed).toBe(true);
});
