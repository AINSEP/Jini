/** @file Security pins for the vault-backed OAuth token store: sealed storage, owner binding,
 * durable lease + CAS, generation and holder fencing, reconnect-required, delete, and
 * secret-free errors/status. */
import { describe, expect, it } from "vitest";
import { OAuthTokenStoreError, parseOAuthTokenVaultMeta, type OAuthTokenStoreErrorCode } from "../index.js";
import { buildRecordMeta, buildTokenPayload } from "../record.js";
import { createVaultOAuthTokenStore } from "../vault-token-store.js";
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
