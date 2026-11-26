import { expect, it, vi } from "vitest";
import type { ApiConnectionDisconnectDeps, ApiConnectionRecord } from "@jini-ai/integrations/api-connections";
import type { KeyAttachments } from "@jini-ai/core/contracts/site/project-key-attachments";
import { disconnectSharedOAuth, inspectSharedOAuthDisconnect } from "../shared-oauth-disconnect.js";

it("refuses changed grants after review before CAS, grant removal or provider access", async () => {
  const record: ApiConnectionRecord = { key: "key", workspaceId: "project", pluginId: "mail", connectionId: "account", status: "connected", revision: 1,
    generation: 1, account: null, grantedScopes: [], staged: null, revocationFailure: null, updatedAt: "2026-01-01" };
  const descriptor: ApiConnectionDisconnectDeps["descriptor"] = { pluginId: "mail", connectionId: "account", label: "Mail", authorizationEndpoint: "https://auth.example/authorize",
    tokenEndpoint: "https://auth.example/token", authorizationParams: { public: {}, confidential: {} }, forceConsentParams: {}, startParams: [], callbackFields: [] };
  let sites = [{ siteId: "a", siteName: "A" }];
  const compareAndSet = vi.fn(async () => true);
  const removeKey = vi.fn(async () => {});
  const tokensFor = vi.fn(() => ({ loadForRevocation: async () => null, delete: async () => {} }));
  const disconnectApiConnection = vi.fn(async () => ({ status: "disconnected" as const, remoteRevocation: "not-needed" as const }));
  const required = {
    storage: { readContext: async () => ({ identity: { pluginId: "mail", connectionId: "account" }, descriptor }),
      records: { read: async () => record, compareAndSet, putAttempt: async () => {}, takeAttempt: async () => null }, tokensFor },
    attachments: { usersOf: async () => sites, removeKey } as Pick<KeyAttachments, "usersOf" | "removeKey">,
    credentialId: "key", ownerWorkspaceId: "project", changed: () => new Error("changed"),
    disconnectApiConnection, clock: { nowMs: () => 0 }, transaction: async <T>({ run }: { run: () => Promise<T> }) => run(),
  };
  const { report } = await inspectSharedOAuthDisconnect(required);
  sites = [...sites, { siteId: "b", siteName: "B" }];
  await expect(disconnectSharedOAuth({ ...required, expectedRevision: report.revision, expectedDigest: report.sourceDigest })).rejects.toThrow("changed");
  expect(compareAndSet).not.toHaveBeenCalled();
  expect(removeKey).not.toHaveBeenCalled();
  expect(tokensFor).not.toHaveBeenCalled();
  expect(disconnectApiConnection).not.toHaveBeenCalled();
});
