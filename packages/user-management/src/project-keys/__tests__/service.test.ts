import { expect, test, vi } from "vitest";
import type { KeyAttachments } from "@jini-ai/core/contracts/site/project-key-attachments";
import type { VaultRepoPort } from "@jini-ai/core/contracts/vault";
import { createProjectKeys } from "../service.js";

test("site-only save does not attach the shared sibling", async () => {
  const vault: VaultRepoPort = { find: vi.fn().mockResolvedValue({ id: "key" }), list: vi.fn(), put: vi.fn(), patchMeta: vi.fn(), delete: vi.fn() };
  const attachments: KeyAttachments = { keysFor: vi.fn().mockResolvedValue([]), isAttached: vi.fn(), attach: vi.fn(), detach: vi.fn(), usersOf: vi.fn(), removeKey: vi.fn(), renameSite: vi.fn() };
  const keys = createProjectKeys({ vault, attachments, siteId: "site", siteName: "Site", owner: { workspaceId: "owner-space", ownerKey: "host" },
    attachedPolicy: { readonlyMessage: "read only", report: vi.fn() }, permissionForRow: () => "write", providerUsage: vi.fn(), reapply: vi.fn(), transaction: async ({ run }) => run(),
    copy: { missingSite: "site", missingProjectKey: "key", missingSiteKey: "site key", oauthBindingRequired: "oauth", revoked: "revoked" },
  });
  const result = { saved: true, credential: { id: "key", scope: "site" } };
  expect(await keys.savedResult({ result })).toBe(result);
  expect(attachments.attach).not.toHaveBeenCalled();
  expect(vault.find).toHaveBeenCalledWith({ workspaceId: "owner-space", id: "key" });
});

test("listGranted never reads the owner vault", async () => {
  const vault: VaultRepoPort = { find: vi.fn(), list: vi.fn().mockResolvedValue([{ id: "ungranted" }]), put: vi.fn(), patchMeta: vi.fn(), delete: vi.fn() };
  const attachments: KeyAttachments = { keysFor: vi.fn().mockResolvedValue([]), isAttached: vi.fn(), attach: vi.fn(), detach: vi.fn(), usersOf: vi.fn(), removeKey: vi.fn(), renameSite: vi.fn() };
  const keys = createProjectKeys({ vault, attachments, siteId: "site", siteName: "Site", owner: { workspaceId: "owner-space", ownerKey: "host" },
    attachedPolicy: { readonlyMessage: "read only", report: vi.fn() }, permissionForRow: () => "write", providerUsage: vi.fn(), reapply: vi.fn(), transaction: async ({ run }) => run(),
    copy: { missingSite: "site", missingProjectKey: "key", missingSiteKey: "site key", oauthBindingRequired: "oauth", revoked: "revoked" },
  });
  expect(await keys.listGranted({})).toEqual([]);
  expect(vault.list).not.toHaveBeenCalled();
  expect(vault.find).not.toHaveBeenCalled();
});
