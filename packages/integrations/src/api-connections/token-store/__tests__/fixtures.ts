/** @file Shared fixture: a real in-memory secrets vault, a controllable clock and generation,
 * and a neutral "acme" connection owner. Token strings are built at runtime and are not
 * shaped like any real provider credential. */
import type { OAuthTokenSet } from "@jini-ai/oauth";
import { AesGcmSecretSealer } from "@jini-ai/platform/secrets";
import { InMemoryKeyring } from "@jini-ai/platform/secrets/testing";
import { InMemoryVaultRepo, SecretsVaultService, createVaultMetaParsers, type VaultContext } from "@jini-ai/platform/secrets/credential-sets";
import { createVaultOAuthTokenStore, parseOAuthTokenVaultMeta, type OAuthConnectionOwner, type VaultOAuthTokenStore } from "../index.js";

export const KEY = "connection-key-1";
export const OWNER: OAuthConnectionOwner = { workspaceId: "ws-1", pluginId: "acme-office", connectionId: "conn-1", clientId: "client-1" };
export const SCOPE: VaultContext = { workspaceId: "ws-1", kind: "mcp-auth", ownerKey: "acme-office", principalId: null, binding: null };
export const START_MS = Date.parse("2026-10-20T00:00:00.000Z");

export function tokenSet(required: { label: string }, optional: { expiresAt?: string | null } = {}): OAuthTokenSet {
  return { accessToken: `access-${required.label}-${"a".repeat(20)}`, refreshToken: `refresh-${required.label}-${"r".repeat(20)}`,
    tokenType: "Bearer", scopes: ["records.read"], expiresAt: optional.expiresAt === undefined ? "2026-10-20T01:00:00.000Z" : optional.expiresAt };
}

/** One shared vault plus a factory for stores that stand in for separate processes. */
export function createFixture() {
  const repo = new InMemoryVaultRepo({});
  const keyring = new InMemoryKeyring({ hkdfSalt: "token-store-tests" });
  const vault = new SecretsVaultService({ repo, keyring, sealer: new AesGcmSecretSealer({ keyring }),
    metaParsers: createVaultMetaParsers({}, { parsers: { "mcp-auth": parseOAuthTokenVaultMeta } }),
    authorize: async () => {}, now: () => "2026-10-20T00:00:00.000Z", newId: () => "unused-id" });
  const state = { nowMs: START_MS, generation: 1 };
  const clock = { nowMs: () => state.nowMs };
  const store = (optional: { owner?: OAuthConnectionOwner } = {}): VaultOAuthTokenStore => createVaultOAuthTokenStore({
    vault, vaultScope: SCOPE, owner: optional.owner ?? OWNER, clock, readGeneration: async () => state.generation });
  return { repo, vault, state, clock, store };
}

/** Writes tokens the way a connect flow does: lease, persist, release. */
export async function seed(required: { store: VaultOAuthTokenStore; tokens: OAuthTokenSet }): Promise<void> {
  if (!await required.store.tryAcquireRefreshLease({ key: KEY })) throw new Error("fixture could not take the lease");
  await required.store.persist({ key: KEY, tokens: required.tokens });
  await required.store.releaseRefreshLease({ key: KEY });
}
