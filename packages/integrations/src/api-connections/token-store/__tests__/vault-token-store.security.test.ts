/** @file Security pins for the vault-backed OAuth token store: sealed storage, owner binding,
 * durable lease + CAS, generation and holder fencing, reconnect-required, delete, and
 * secret-free errors/status. */
import { describe, expect, it } from "vitest";
import { VaultError } from "@jini-ai/platform/secrets/credential-sets";
import { OAuthTokenStoreError, parseOAuthTokenVaultMeta, type OAuthTokenStoreErrorCode } from "../index.js";
import { buildRecordMeta, buildTokenPayload } from "../record.js";
import { createVaultOAuthTokenStore, type OAuthTokenVaultPort } from "../vault-token-store.js";
import { KEY, OWNER, SCOPE, createFixture, seed, tokenSet } from "./fixtures.js";

async function refusal(promise: Promise<unknown>): Promise<OAuthTokenStoreError> {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(OAuthTokenStoreError);
  return error as OAuthTokenStoreError;
}

describe("token storage", () => {
  it("seals tokens in the vault payload and keeps them out of row metadata", async () => {
    const f = createFixture();
    const tokens = tokenSet({ label: "one" });
    await seed({ store: f.store(), tokens });
    const row = await f.repo.find({ workspaceId: SCOPE.workspaceId, id: KEY });
    const plaintextParts = JSON.stringify({ ...row, sealed: null });
    expect(row?.sealed?.ciphertext.includes(tokens.accessToken)).toBe(false);
    expect(plaintextParts.includes(tokens.accessToken)).toBe(false);
    expect(plaintextParts.includes(tokens.refreshToken!)).toBe(false);
    expect(row?.meta).toEqual({ credentialFormat: "oauth-token-set", status: "active", leaseHolder: null, leaseExpiresAtMs: null });
    expect(await f.store().load({ key: KEY })).toEqual(tokens);
  });

  it("refuses metadata keys outside the OAuth record shape", () => {
    expect(() => parseOAuthTokenVaultMeta({ meta: { credentialFormat: "oauth-token-set", status: "active",
      leaseHolder: null, leaseExpiresAtMs: null, accessToken: "smuggled" } })).toThrow(expect.objectContaining({ code: "invalid-record" }));
    expect(() => parseOAuthTokenVaultMeta({ meta: { credentialFormat: "other", status: "active", leaseHolder: null, leaseExpiresAtMs: null } }))
      .toThrow(expect.objectContaining({ code: "invalid-record" }));
  });
});

describe("owner binding on read", () => {
  it("refuses a row sealed for another client of the same connection", async () => {
    const f = createFixture();
    await seed({ store: f.store(), tokens: tokenSet({ label: "one" }) });
    const error = await refusal(f.store({ owner: { ...OWNER, clientId: "client-2" } }).load({ key: KEY }));
    expect(error.code).toBe("owner-mismatch");
  });

  it("refuses a row sealed for another connection id", async () => {
    const f = createFixture();
    await seed({ store: f.store(), tokens: tokenSet({ label: "one" }) });
    const error = await refusal(f.store({ owner: { ...OWNER, connectionId: "conn-2" } }).load({ key: KEY }));
    expect(error.code).toBe("owner-mismatch");
  });

  it("refuses a payload sealed for a different connection key", async () => {
    const f = createFixture();
    await f.vault.put({ ...SCOPE, id: KEY, expectedRevision: null, provider: null, label: "conn-1",
      meta: buildRecordMeta({ meta: { status: "active", leaseHolder: null, leaseExpiresAtMs: null } }),
      payload: buildTokenPayload({ key: "connection-key-2", owner: OWNER, generation: 1, tokens: tokenSet({ label: "one" }) }) });
    const error = await refusal(f.store().load({ key: KEY }));
    expect(error.code).toBe("owner-mismatch");
  });

  it("refuses construction when the vault scope names another workspace", () => {
    const f = createFixture();
    expect(() => createVaultOAuthTokenStore({ vault: f.vault, vaultScope: { ...SCOPE, workspaceId: "ws-2" }, owner: OWNER,
      clock: f.clock, readGeneration: async () => 1 })).toThrow(expect.objectContaining({ code: "configuration" }));
  });
});

describe("rows a host can no longer open (changed OAuth client, malformed payload)", () => {
  it("install replaces a row sealed for another client id of the same connection", async () => {
    const f = createFixture();
    await seed({ store: f.store(), tokens: tokenSet({ label: "old-client" }) });
    const moved = f.store({ owner: { ...OWNER, clientId: "client-2" } });
    await moved.install({ key: KEY, tokens: tokenSet({ label: "new-client" }), generation: 1 });
    expect(await moved.load({ key: KEY })).toEqual(tokenSet({ label: "new-client" }));
  });
  it("install still refuses a row sealed for another connection and leaves it untouched", async () => {
    const f = createFixture();
    await seed({ store: f.store(), tokens: tokenSet({ label: "one" }) });
    const other = f.store({ owner: { ...OWNER, connectionId: "conn-2" } });
    const error = await refusal(other.install({ key: KEY, tokens: tokenSet({ label: "two" }), generation: 1 }));
    expect([error.code, await f.store().load({ key: KEY })]).toEqual(["owner-mismatch", tokenSet({ label: "one" })]);
  });
  it("install still refuses a row whose payload is sealed for another connection key", async () => {
    const f = createFixture();
    await f.vault.put({ ...SCOPE, id: KEY, expectedRevision: null, provider: null, label: KEY,
      meta: buildRecordMeta({ meta: { status: "active", leaseHolder: null, leaseExpiresAtMs: null } }),
      payload: buildTokenPayload({ key: "connection-key-2", owner: OWNER, generation: 1, tokens: tokenSet({ label: "one" }) }) });
    const error = await refusal(f.store().install({ key: KEY, tokens: tokenSet({ label: "two" }), generation: 1 }));
    expect(error.code).toBe("owner-mismatch");
  });
  it("install replaces a malformed row", async () => {
    const f = createFixture();
    await f.vault.put({ ...SCOPE, id: KEY, expectedRevision: null, provider: null, label: KEY,
      meta: buildRecordMeta({ meta: { status: "active", leaseHolder: null, leaseExpiresAtMs: null } }),
      payload: { format: "oauth-token-set", version: 99 } }); // malformed on purpose
    await f.store().install({ key: KEY, tokens: tokenSet({ label: "fresh" }), generation: 1 });
    expect(await f.store().load({ key: KEY })).toEqual(tokenSet({ label: "fresh" }));
  });
  it("delete removes a row sealed for another client id", async () => {
    const f = createFixture();
    await seed({ store: f.store(), tokens: tokenSet({ label: "old-client" }) });
    await f.store({ owner: { ...OWNER, clientId: "client-2" } }).delete({ key: KEY });
    expect(await f.repo.find({ workspaceId: SCOPE.workspaceId, id: KEY })).toBeNull();
  });
  it("load and loadForRevocation still refuse a row sealed for another client id", async () => {
    const f = createFixture();
    await seed({ store: f.store(), tokens: tokenSet({ label: "old-client" }) });
    const moved = f.store({ owner: { ...OWNER, clientId: "client-2" } });
    const codes = [(await refusal(moved.load({ key: KEY }))).code, (await refusal(moved.loadForRevocation({ key: KEY }))).code];
    expect(codes).toEqual(["owner-mismatch", "owner-mismatch"]);
  });
});

describe("durable refresh lease (CAS)", () => {
  it("lets only one of two processes hold the lease until it is released", async () => {
    const f = createFixture();
    const [first, second] = [f.store(), f.store()];
    await seed({ store: first, tokens: tokenSet({ label: "one" }) });
    expect(await first.tryAcquireRefreshLease({ key: KEY })).toBe(true);
    expect(await second.tryAcquireRefreshLease({ key: KEY })).toBe(false);
    await first.releaseRefreshLease({ key: KEY });
    expect(await second.tryAcquireRefreshLease({ key: KEY })).toBe(true);
  });

  it("refuses writes from a store that does not hold the lease", async () => {
    const f = createFixture();
    const error = await refusal(f.store().persist({ key: KEY, tokens: tokenSet({ label: "one" }) }));
    expect(error.code).toBe("lease-not-held");
  });
});

describe("fencing", () => {
  it("discards a refresh that completes after a newer attempt took the expired lease", async () => {
    const f = createFixture();
    const [slow, newer] = [f.store(), f.store()];
    await seed({ store: slow, tokens: tokenSet({ label: "one" }) });
    expect(await slow.tryAcquireRefreshLease({ key: KEY })).toBe(true);
    f.state.nowMs += 30_001;
    expect(await newer.tryAcquireRefreshLease({ key: KEY })).toBe(true);
    await newer.persist({ key: KEY, tokens: tokenSet({ label: "newer" }) });
    const error = await refusal(slow.persist({ key: KEY, tokens: tokenSet({ label: "late" }) }));
    expect(error.code).toBe("lease-lost");
    expect(await newer.load({ key: KEY })).toEqual(tokenSet({ label: "newer" }));
  });

  it("discards a refresh that completes after the connection generation moved (disconnect/switch)", async () => {
    const f = createFixture();
    const store = f.store();
    await seed({ store, tokens: tokenSet({ label: "one" }) });
    expect(await store.tryAcquireRefreshLease({ key: KEY })).toBe(true);
    f.state.generation = 2;
    const error = await refusal(store.persist({ key: KEY, tokens: tokenSet({ label: "late" }) }));
    expect(error.code).toBe("stale-generation");
  });

  it("never serves tokens sealed under an older generation", async () => {
    const f = createFixture();
    await seed({ store: f.store(), tokens: tokenSet({ label: "one" }) });
    f.state.generation = 2;
    expect(await f.store().load({ key: KEY })).toBeNull();
  });

  it("refuses the lease when the generation moved between a load and the lease attempt", async () => {
    const f = createFixture();
    const [refresher, connectFlow] = [f.store(), f.store()];
    await seed({ store: connectFlow, tokens: tokenSet({ label: "one" }) });
    expect(await refresher.load({ key: KEY })).toEqual(tokenSet({ label: "one" }));
    f.state.generation = 2;
    await seed({ store: connectFlow, tokens: tokenSet({ label: "switched" }) });
    expect(await refresher.tryAcquireRefreshLease({ key: KEY })).toBe(false);
    expect(await connectFlow.load({ key: KEY })).toEqual(tokenSet({ label: "switched" }));
  });
});

describe("credential install (sign-in write, no refresh lease)", () => {
  it("writes freshly issued tokens for the live generation without a lease", async () => {
    const f = createFixture();
    await f.store().install({ key: KEY, tokens: tokenSet({ label: "signed-in" }), generation: 1 });
    expect(await f.store().load({ key: KEY })).toEqual(tokenSet({ label: "signed-in" }));
  });

  it("keeps rows of two connections that share a connection id apart in one vault scope", async () => {
    const f = createFixture();
    const other = { ...OWNER, pluginId: "other-plugin" };
    await f.store().install({ key: KEY, tokens: tokenSet({ label: "mine" }), generation: 1 });
    await f.store({ owner: other }).install({ key: "connection-key-2", tokens: tokenSet({ label: "theirs" }), generation: 1 });
    expect([await f.store().load({ key: KEY }), await f.store({ owner: other }).load({ key: "connection-key-2" })])
      .toEqual([tokenSet({ label: "mine" }), tokenSet({ label: "theirs" })]);
  });

  it("refuses an install whose generation was superseded (disconnect, switch or newer attempt) and writes nothing", async () => {
    const f = createFixture();
    f.state.generation = 2;
    const error = await refusal(f.store().install({ key: KEY, tokens: tokenSet({ label: "stale" }), generation: 1 }));
    expect([error.code, await f.repo.find({ workspaceId: SCOPE.workspaceId, id: KEY })]).toEqual(["stale-generation", null]);
  });

  it("never overwrites tokens a newer generation installed after the older install checked the generation", async () => {
    const f = createFixture();
    let interleave: (() => Promise<void>) | null = async () => {
      f.state.generation = 2;
      await f.store().install({ key: KEY, tokens: tokenSet({ label: "newer" }), generation: 2 });
    };
    // The older install reads generation 1, then the newer one runs to completion before it opens the row.
    const older = createVaultOAuthTokenStore({ vault: f.vault, vaultScope: SCOPE, owner: OWNER, clock: f.clock,
      readGeneration: async () => {
        const generation = f.state.generation;
        const run = interleave;
        interleave = null;
        await run?.();
        return generation;
      } });
    const error = await refusal(older.install({ key: KEY, tokens: tokenSet({ label: "older" }), generation: 1 }));
    expect([error.code, await f.store().load({ key: KEY })]).toEqual(["stale-generation", tokenSet({ label: "newer" })]);
  });

  it("lets the newest install win when an older one writes between its read and its write", async () => {
    const f = createFixture();
    f.state.generation = 2;
    let interleave: (() => Promise<void>) | null = async () => {
      await f.vault.put({ ...SCOPE, id: KEY, expectedRevision: null, provider: null, label: "conn-1",
        meta: buildRecordMeta({ meta: { status: "active", leaseHolder: null, leaseExpiresAtMs: null } }),
        payload: buildTokenPayload({ key: KEY, owner: OWNER, generation: 1, tokens: tokenSet({ label: "older" }) }) });
    };
    // The older install's write lands after the newest one opened the row, so its first write conflicts.
    const racedVault: OAuthTokenVaultPort = {
      get: input => f.vault.get(input), patchMeta: input => f.vault.patchMeta(input), delete: input => f.vault.delete(input),
      put: async input => { const run = interleave; interleave = null; await run?.(); return f.vault.put(input); },
    };
    const newest = createVaultOAuthTokenStore({ vault: racedVault, vaultScope: SCOPE, owner: OWNER, clock: f.clock,
      readGeneration: async () => f.state.generation });
    await newest.install({ key: KEY, tokens: tokenSet({ label: "newest" }), generation: 2 });
    expect(await f.store().load({ key: KEY })).toEqual(tokenSet({ label: "newest" }));
  });
});

describe("credential install under sustained contention", () => {
  it("surfaces a vault refusal other than a conflict instead of retrying or reporting success", async () => {
    const f = createFixture();
    const refused = new VaultError({ code: "context" });
    const refusing: OAuthTokenVaultPort = {
      get: input => f.vault.get(input), patchMeta: input => f.vault.patchMeta(input), delete: input => f.vault.delete(input),
      put: async () => { throw refused; },
    };
    const store = createVaultOAuthTokenStore({ vault: refusing, vaultScope: SCOPE, owner: OWNER, clock: f.clock,
      readGeneration: async () => f.state.generation });
    const error = await store.install({ key: KEY, tokens: tokenSet({ label: "refused" }), generation: 1 }).then(() => null, (caught: unknown) => caught);
    expect([error, await f.repo.find({ workspaceId: SCOPE.workspaceId, id: KEY })]).toEqual([refused, null]);
  });

  it("gives up with write-conflict instead of writing over a row that keeps changing", async () => {
    const f = createFixture();
    await f.store().install({ key: KEY, tokens: tokenSet({ label: "first" }), generation: 1 });
    // Every write by this store conflicts, as if another writer always got there first.
    const contended: OAuthTokenVaultPort = {
      get: input => f.vault.get(input), patchMeta: input => f.vault.patchMeta(input), delete: input => f.vault.delete(input),
      put: async input => f.vault.put({ ...input, expectedRevision: (input.expectedRevision ?? 0) + 100 }),
    };
    const store = createVaultOAuthTokenStore({ vault: contended, vaultScope: SCOPE, owner: OWNER, clock: f.clock,
      readGeneration: async () => f.state.generation });
    const error = await refusal(store.install({ key: KEY, tokens: tokenSet({ label: "contended" }), generation: 1 }));
    expect([error.code, await f.store().load({ key: KEY })]).toEqual(["write-conflict", tokenSet({ label: "first" })]);
  });
});

describe("reconnect-required and delete", () => {
  it("markNeedsReauth clears the sealed tokens and records only a fixed status", async () => {
    const f = createFixture();
    const store = f.store();
    await seed({ store, tokens: tokenSet({ label: "one" }) });
    expect(await store.tryAcquireRefreshLease({ key: KEY })).toBe(true);
    await store.markNeedsReauth({ key: KEY, reason: "provider said: refresh-one-secretish" });
    expect(await store.load({ key: KEY })).toBeNull();
    const row = await f.repo.find({ workspaceId: SCOPE.workspaceId, id: KEY });
    expect(row?.meta.status).toBe("reconnect-required");
    expect(JSON.stringify(row?.meta).includes("secretish")).toBe(false);
  });

  it("delete removes the sealed row and a late refresh cannot resurrect it", async () => {
    const f = createFixture();
    const [refresher, disconnect] = [f.store(), f.store()];
    await seed({ store: refresher, tokens: tokenSet({ label: "one" }) });
    expect(await refresher.tryAcquireRefreshLease({ key: KEY })).toBe(true);
    await disconnect.delete({ key: KEY });
    expect(await f.repo.find({ workspaceId: SCOPE.workspaceId, id: KEY })).toBeNull();
    const error = await refusal(refresher.persist({ key: KEY, tokens: tokenSet({ label: "late" }) }));
    expect(error.code).toBe("lease-lost");
    expect(await f.repo.find({ workspaceId: SCOPE.workspaceId, id: KEY })).toBeNull();
  });
});

describe("secret-free errors", () => {
  it("every refusal message is fixed text without key, owner ids or token material", () => {
    const codes: OAuthTokenStoreErrorCode[] = ["configuration", "lease-not-held", "lease-lost", "stale-generation",
      "owner-mismatch", "invalid-record", "write-conflict"];
    const forbidden = [KEY, OWNER.connectionId, OWNER.clientId, tokenSet({ label: "one" }).accessToken];
    for (const code of codes) {
      const error = new OAuthTokenStoreError({ code });
      expect(error.code).toBe(code);
      expect(forbidden.filter(value => `${error.message} ${error.nextAction}`.includes(value))).toEqual([]);
    }
  });
});
