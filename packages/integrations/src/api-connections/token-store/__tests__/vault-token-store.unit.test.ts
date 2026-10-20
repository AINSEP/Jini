/** @file Unit tests for the vault token store's failure paths: what each vault conflict or
 * outage becomes (a typed refusal, a retry, a lapsed lease), and that a lease is only ever
 * released by the store that holds it. A switchable vault port wraps the real in-memory vault. */
import { describe, expect, it } from "vitest";
import { VaultError, type SecretsVaultService } from "@jini-ai/platform/secrets/credential-sets";
import { OAuthTokenStoreError, type OAuthTokenStoreErrorCode } from "../errors.js";
import { createVaultOAuthTokenStore, type OAuthTokenVaultPort } from "../vault-token-store.js";
import { KEY, OWNER, SCOPE, createFixture, seed, tokenSet } from "./fixtures.js";

type Method = keyof OAuthTokenVaultPort;

/** Delegates to the real vault; a method listed in `failures` throws that error instead, and every call is counted. */
function switchableVault(vault: SecretsVaultService) {
  const failures: Partial<Record<Method, unknown>> = {};
  const calls: Record<Method, number> = { get: 0, put: 0, patchMeta: 0, delete: 0 };
  const guard = (method: Method) => {
    calls[method] += 1;
    if (failures[method] !== undefined) throw failures[method];
  };
  const port: OAuthTokenVaultPort = {
    get: async input => { guard("get"); return vault.get(input); },
    put: async input => { guard("put"); return vault.put(input); },
    patchMeta: async input => { guard("patchMeta"); return vault.patchMeta(input); },
    delete: async input => { guard("delete"); return vault.delete(input); },
  };
  return { port, failures, calls };
}

function storeOver(f: ReturnType<typeof createFixture>, vault: OAuthTokenVaultPort) {
  return createVaultOAuthTokenStore({ vault, vaultScope: SCOPE, owner: OWNER, clock: f.clock, readGeneration: async () => f.state.generation });
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => { throw new Error("expected a refusal"); }, (error: unknown) => error);
}

async function codeOf(promise: Promise<unknown>): Promise<OAuthTokenStoreErrorCode> {
  const error = await caught(promise);
  if (error instanceof OAuthTokenStoreError) return error.code;
  throw error;
}

const conflict = () => new VaultError({ code: "conflict" });
const outage = () => new VaultError({ code: "context" });

describe("refresh writes under a held lease", () => {
  it("reports lease-lost, keeping the vault conflict as cause, when the row changed under the write", async () => {
    const f = createFixture();
    const vault = switchableVault(f.vault);
    const store = storeOver(f, vault.port);
    await seed({ store, tokens: tokenSet({ label: "one" }) });
    expect(await store.tryAcquireRefreshLease({ key: KEY })).toBe(true);
    const cause = conflict();
    vault.failures.put = cause;
    const error = await caught(store.persist({ key: KEY, tokens: tokenSet({ label: "two" }) }));
    expect(error).toMatchObject({ code: "lease-lost", cause });
  });

  it("surfaces a vault failure other than a conflict unchanged", async () => {
    const f = createFixture();
    const vault = switchableVault(f.vault);
    const store = storeOver(f, vault.port);
    await seed({ store, tokens: tokenSet({ label: "one" }) });
    expect(await store.tryAcquireRefreshLease({ key: KEY })).toBe(true);
    const failure = outage();
    vault.failures.put = failure;
    expect(await caught(store.markNeedsReauth({ key: KEY, reason: "rejected" }))).toBe(failure);
  });
});

describe("taking the refresh lease", () => {
  it("refuses the lease when another writer changed the row first (conflict on the lease patch)", async () => {
    const f = createFixture();
    const vault = switchableVault(f.vault);
    const store = storeOver(f, vault.port);
    await seed({ store, tokens: tokenSet({ label: "one" }) });
    vault.failures.patchMeta = conflict();
    expect(await store.tryAcquireRefreshLease({ key: KEY })).toBe(false);
  });

  it("does not count a refused lease as held, so a write afterwards is refused", async () => {
    const f = createFixture();
    const vault = switchableVault(f.vault);
    const store = storeOver(f, vault.port);
    await seed({ store, tokens: tokenSet({ label: "one" }) });
    vault.failures.patchMeta = conflict();
    await store.tryAcquireRefreshLease({ key: KEY });
    expect(await codeOf(store.persist({ key: KEY, tokens: tokenSet({ label: "two" }) }))).toBe("lease-not-held");
  });

  it("refuses the lease when a first-time claim loses the create race", async () => {
    const f = createFixture();
    const vault = switchableVault(f.vault);
    vault.failures.put = conflict();
    expect(await storeOver(f, vault.port).tryAcquireRefreshLease({ key: KEY })).toBe(false);
  });

  it("surfaces a vault outage while claiming the lease", async () => {
    const f = createFixture();
    const vault = switchableVault(f.vault);
    const failure = outage();
    vault.failures.put = failure;
    expect(await caught(storeOver(f, vault.port).tryAcquireRefreshLease({ key: KEY }))).toBe(failure);
  });

  it("grants the lease again once the previous holder's lease expired", async () => {
    const f = createFixture();
    const [crashed, next] = [f.store(), f.store()];
    await seed({ store: crashed, tokens: tokenSet({ label: "one" }) });
    expect(await crashed.tryAcquireRefreshLease({ key: KEY })).toBe(true);
    f.state.nowMs += 30_000;
    expect(await next.tryAcquireRefreshLease({ key: KEY })).toBe(true);
  });
});

describe("releasing the refresh lease", () => {
  it("does nothing for a store that holds no lease", async () => {
    const f = createFixture();
    const vault = switchableVault(f.vault);
    await storeOver(f, vault.port).releaseRefreshLease({ key: KEY });
    expect(vault.calls).toEqual({ get: 0, put: 0, patchMeta: 0, delete: 0 });
  });

  it("leaves a newer holder's lease in place after this store's lease expired", async () => {
    const f = createFixture();
    const vault = switchableVault(f.vault);
    const stale = storeOver(f, vault.port);
    const newer = f.store();
    await seed({ store: stale, tokens: tokenSet({ label: "one" }) });
    expect(await stale.tryAcquireRefreshLease({ key: KEY })).toBe(true);
    f.state.nowMs += 30_000;
    expect(await newer.tryAcquireRefreshLease({ key: KEY })).toBe(true);
    const patchesBefore = vault.calls.patchMeta;
    await stale.releaseRefreshLease({ key: KEY });
    expect([vault.calls.patchMeta - patchesBefore, await stale.tryAcquireRefreshLease({ key: KEY })]).toEqual([0, false]);
  });

  it("returns quietly when the row is gone, e.g. deleted by a disconnect", async () => {
    const f = createFixture();
    const vault = switchableVault(f.vault);
    const store = storeOver(f, vault.port);
    await seed({ store, tokens: tokenSet({ label: "one" }) });
    expect(await store.tryAcquireRefreshLease({ key: KEY })).toBe(true);
    await f.store().delete({ key: KEY });
    const patchesBefore = vault.calls.patchMeta;
    await store.releaseRefreshLease({ key: KEY });
    expect(vault.calls.patchMeta - patchesBefore).toBe(0);
  });

  it("lets the lease lapse on its own expiry when a concurrent writer changed the row", async () => {
    const f = createFixture();
    const vault = switchableVault(f.vault);
    const store = storeOver(f, vault.port);
    await seed({ store, tokens: tokenSet({ label: "one" }) });
    expect(await store.tryAcquireRefreshLease({ key: KEY })).toBe(true);
    vault.failures.patchMeta = conflict();
    await store.releaseRefreshLease({ key: KEY });
    const other = f.store();
    expect(await other.tryAcquireRefreshLease({ key: KEY })).toBe(false);
    f.state.nowMs += 30_000;
    expect(await other.tryAcquireRefreshLease({ key: KEY })).toBe(true);
  });

  it("surfaces a vault outage while releasing, and no longer counts the lease as held", async () => {
    const f = createFixture();
    const vault = switchableVault(f.vault);
    const store = storeOver(f, vault.port);
    await seed({ store, tokens: tokenSet({ label: "one" }) });
    expect(await store.tryAcquireRefreshLease({ key: KEY })).toBe(true);
    const failure = outage();
    vault.failures.patchMeta = failure;
    expect(await caught(store.releaseRefreshLease({ key: KEY }))).toBe(failure);
    expect(await codeOf(store.persist({ key: KEY, tokens: tokenSet({ label: "two" }) }))).toBe("lease-not-held");
  });
});

describe("delete", () => {
  it("succeeds without a vault delete when no row is stored", async () => {
    const f = createFixture();
    const vault = switchableVault(f.vault);
    await storeOver(f, vault.port).delete({ key: KEY });
    expect([vault.calls.get, vault.calls.delete]).toEqual([1, 0]);
  });

  it("retries a conflicting delete, then gives up with write-conflict and keeps the row", async () => {
    const f = createFixture();
    const vault = switchableVault(f.vault);
    const store = storeOver(f, vault.port);
    await store.install({ key: KEY, tokens: tokenSet({ label: "one" }), generation: 1 });
    vault.failures.delete = conflict();
    expect(await codeOf(store.delete({ key: KEY }))).toBe("write-conflict");
    expect([vault.calls.delete, await f.store().load({ key: KEY })]).toEqual([3, tokenSet({ label: "one" })]);
  });

  it("succeeds when a retry after a conflict finds the row already removed", async () => {
    const f = createFixture();
    const vault = switchableVault(f.vault);
    const store = storeOver(f, vault.port);
    await store.install({ key: KEY, tokens: tokenSet({ label: "one" }), generation: 1 });
    const removeOnce: OAuthTokenVaultPort = { ...vault.port, delete: async input => {
      await f.vault.delete(input);
      throw conflict();
    } };
    await storeOver(f, removeOnce).delete({ key: KEY });
    expect(await f.repo.find({ workspaceId: SCOPE.workspaceId, id: KEY })).toBeNull();
  });

  it("surfaces a vault outage instead of retrying", async () => {
    const f = createFixture();
    const vault = switchableVault(f.vault);
    const store = storeOver(f, vault.port);
    await store.install({ key: KEY, tokens: tokenSet({ label: "one" }), generation: 1 });
    const failure = outage();
    vault.failures.delete = failure;
    expect([await caught(store.delete({ key: KEY })), vault.calls.delete]).toEqual([failure, 1]);
  });
});

describe("token validation before writing", () => {
  // Malformed on purpose: the store must not seal a token set its own reads would refuse.
  const malformed = { ...tokenSet({ label: "bad" }), accessToken: "" };

  it("refuses a malformed refresh result and keeps the stored tokens", async () => {
    const f = createFixture();
    const store = f.store();
    await seed({ store, tokens: tokenSet({ label: "one" }) });
    expect(await store.tryAcquireRefreshLease({ key: KEY })).toBe(true);
    expect(await codeOf(store.persist({ key: KEY, tokens: malformed }))).toBe("invalid-record");
    expect(await f.store().load({ key: KEY })).toEqual(tokenSet({ label: "one" }));
  });

  it("refuses a malformed sign-in credential and writes nothing", async () => {
    const f = createFixture();
    expect(await codeOf(f.store().install({ key: KEY, tokens: malformed, generation: 1 }))).toBe("invalid-record");
    expect(await f.repo.find({ workspaceId: SCOPE.workspaceId, id: KEY })).toBeNull();
  });
});

describe("reads", () => {
  it("serves nothing and records no load when no row is stored", async () => {
    const f = createFixture();
    const store = f.store();
    expect([await store.load({ key: KEY }), await store.loadForRevocation({ key: KEY })]).toEqual([null, null]);
  });

  it("ignores loads older than the observation window when judging a lease", async () => {
    const f = createFixture();
    const store = f.store();
    await store.install({ key: KEY, tokens: tokenSet({ label: "one" }), generation: 1 });
    await store.load({ key: KEY });
    f.state.nowMs += 60_000;
    f.state.generation = 2;
    expect(await store.tryAcquireRefreshLease({ key: KEY })).toBe(true);
  });

  it("forgets earlier loads on delete, so a later lease is judged on loads after it", async () => {
    const f = createFixture();
    const store = f.store();
    await store.install({ key: KEY, tokens: tokenSet({ label: "one" }), generation: 1 });
    await store.load({ key: KEY });
    await store.delete({ key: KEY });
    f.state.generation = 2;
    expect(await store.tryAcquireRefreshLease({ key: KEY })).toBe(true);
  });
});
