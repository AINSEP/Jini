/** @file Vertical-slice proof: the generic OAuth refresher running on the vault-backed store over
 * a real in-memory vault. Pins rotation persisted before lease release, and invalid_grant →
 * reconnect-required. The refresh grant itself is a typed fake; no network is used. */
import { describe, expect, it } from "vitest";
import { OAuthError, createTokenRefresher, type OAuthTokenSet } from "@jini-ai/oauth";
import { createVaultOAuthTokenStore, type OAuthTokenVaultPort } from "../index.js";
import { KEY, OWNER, SCOPE, START_MS, createFixture, seed, tokenSet } from "./fixtures.js";

describe("refresher on the vault-backed store", () => {
  it("rotates a due token, persists the rotation, then releases the lease", async () => {
    const f = createFixture();
    const calls: string[] = [];
    // Records the order of vault writes; every call still reaches the real vault.
    const recordingVault: OAuthTokenVaultPort = {
      get: input => f.vault.get(input),
      put: input => { calls.push(`put:${String(input.meta && (input.meta as { status?: unknown }).status)}`); return f.vault.put(input); },
      patchMeta: input => { calls.push(input.patch.leaseHolder === null ? "release" : "acquire"); return f.vault.patchMeta(input); },
      delete: input => f.vault.delete(input),
    };
    const store = createVaultOAuthTokenStore({ vault: recordingVault, vaultScope: SCOPE, owner: OWNER, clock: f.clock,
      readGeneration: async () => f.state.generation });
    const due = tokenSet({ label: "old" }, { expiresAt: new Date(START_MS + 60_000).toISOString() });
    await seed({ store, tokens: due });
    calls.length = 0;
    const rotated: OAuthTokenSet = tokenSet({ label: "rotated" });
    const refreshed: string[] = [];
    const refresher = createTokenRefresher({ clock: f.clock, sleep: async () => {},
      port: { ...store, refresh: async ({ refreshToken }) => { refreshed.push(refreshToken); return rotated; } } });

    expect(await refresher.getAccessToken({ key: KEY })).toBe(rotated.accessToken);
    expect(refreshed).toEqual([due.refreshToken]);
    expect(calls).toEqual(["acquire", "put:active", "release"]);
    expect(await f.store().load({ key: KEY })).toEqual(rotated);
    const row = await f.repo.find({ workspaceId: SCOPE.workspaceId, id: KEY });
    expect(row?.meta.leaseHolder).toBeNull();
  });

  it("marks the connection reconnect-required when the refresh grant is rejected (invalid_grant)", async () => {
    const f = createFixture();
    const store = f.store();
    await seed({ store, tokens: tokenSet({ label: "old" }, { expiresAt: new Date(START_MS + 60_000).toISOString() }) });
    const refresher = createTokenRefresher({ clock: f.clock, sleep: async () => {}, port: { ...store, refresh: async () => {
      throw new OAuthError({ code: "OAUTH_INVALID_GRANT", message: "rejected", operatorAction: "Reconnect." });
    } } });

    await expect(refresher.getAccessToken({ key: KEY })).rejects.toMatchObject({ code: "OAUTH_INVALID_GRANT" });
    const row = await f.repo.find({ workspaceId: SCOPE.workspaceId, id: KEY });
    expect(row?.meta).toEqual({ credentialFormat: "oauth-token-set", status: "reconnect-required", leaseHolder: null, leaseExpiresAtMs: null });
    expect(await f.store().load({ key: KEY })).toBeNull();
  });
});
