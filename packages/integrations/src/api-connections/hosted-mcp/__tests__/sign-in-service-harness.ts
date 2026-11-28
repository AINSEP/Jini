/** Wires the real `createHostedMcpSignInService` around the sign-in harness, plus an in-memory
 *  shared-owner store (records, contexts, bindings, attachments) for the shared sign-in paths. */
import type { DeviceAuthorizationStore, ExternalMcpOAuthService } from "@jini-ai/core/contracts/site/api-connections-hosted-mcp";
import type { ExternalMcpServerRecord } from "@jini-ai/core/contracts/hosted-mcp";
import type { OAuthFlowOperations, OAuthProviderDescriptor, OAuthProviderRegistry, OAuthTokenSet, TokenRefresher } from "@jini-ai/core/contracts/oauth";
import type { VaultRecord } from "@jini-ai/core/contracts/vault";
import type { ApiConnectionRecord, ApiConnectionTokenStore } from "../../index.js";
import type { HostedMcpOAuthFailure } from "../contracts.js";
import type { SignInDeps } from "../sign-in-provider.js";
import type { SharedExternalMcpOwner, SharedSignInIssuingContext } from "../shared-sign-in.js";
import { createDeviceAuthorizationStore, createHostedMcpSignInService } from "../sign-in.js";
import { FakeOAuthError, FakeRepo, makeHarness, makeRecord, type Harness } from "./sign-in-harness.js";

export const CB = "https://site.test/callback";
export const PROVIDER = { providerId: "p", label: "P", tokenEndpoint: "https://as.test/token", authorizationEndpoint: "https://as.test/auth", clientAuth: "none" } as OAuthProviderDescriptor;
export const TOKENS = { accessToken: "at-1", refreshToken: "rt-1", tokenType: "Bearer", scopes: ["s1"], expiresAt: "2026-03-01T00:00:00.000Z" } as OAuthTokenSet;
export const AUTHORIZATION = { deviceCode: "dc-1", userCode: "UC", verificationUri: "https://as.test/verify", verificationUriComplete: "https://as.test/verify?c=UC", expiresAt: "2026-01-02T03:14:05.000Z", intervalSeconds: 5 };

/** An OAuth failure carrying the provider fields `HostedMcpOAuthFailure` adds. */
export class ProviderError extends FakeOAuthError implements HostedMcpOAuthFailure {
  constructor(code: string, readonly providerErrorCode: string | undefined, readonly retryable = false, readonly retryAfterSeconds: number | undefined = undefined) {
    super(code, `provider failure ${code}`, "act");
  }
}

/** A row the self-configuration step leaves untouched: provider, grant and client id all named. */
export function configuredRow(over: Partial<ExternalMcpServerRecord> = {}): ExternalMcpServerRecord {
  return makeRecord({ oauthProviderId: "p", oauthGrant: "authorization_code", oauthClientId: "c1", oauthScopesJson: '["s1"]',
    oauthEndpointsJson: JSON.stringify({ resource: "https://r.test" }), ...over });
}

export interface SharedRig {
  readonly shared: SharedExternalMcpOwner;
  readonly records: Map<string, ApiConnectionRecord>;
  readonly contexts: Map<string, SharedSignInIssuingContext>;
  readonly bindings: Map<string, string>;
  readonly attached: Set<string>;
  readonly installs: unknown[];
}

/** In-memory shared owner; `inventory` is exposed only when given. */
export function makeSharedOwner(_over: { inventory?: readonly VaultRecord[] } = {}): SharedRig {
  const records = new Map<string, ApiConnectionRecord>();
  const contexts = new Map<string, SharedSignInIssuingContext>();
  const bindings = new Map<string, string>();
  const attached = new Set<string>();
  const installs: unknown[] = [];
  const tokenStore = { install: async (input: unknown) => { installs.push(input); } } as Partial<ApiConnectionTokenStore> as ApiConnectionTokenStore;
  const shared: SharedExternalMcpOwner = {
    ownerWorkspaceId: "owner-ws", siteId: "site-1", siteName: "Site", ownerPrincipalId: "owner",
    owner: {
      records: {
        read: async ({ key }) => records.get(key) ?? null,
        compareAndSet: async ({ key, expectedRevision, record }) => {
          if ((records.get(key)?.revision ?? 0) !== expectedRevision) return false;
          records.set(key, record);
          return true;
        },
      },
      readContext: async ({ credentialId }) => contexts.get(credentialId) ?? null,
      saveContext: async ({ credentialId, context }) => { contexts.set(credentialId, context); },
      tokensFor: () => tokenStore,
      readConnection: async ({ credentialId }) => {
        const record = records.get(credentialId);
        const context = contexts.get(credentialId);
        return record && context ? { credentialId, identity: context.identity, generation: record.generation, status: record.status, account: record.account, grantedScopes: record.grantedScopes } : null;
      },
    },
    bindings: {
      read: async ({ consumerId }) => { const credentialId = bindings.get(consumerId); return credentialId === undefined ? null : { credentialId }; },
      set: async ({ consumerId, credentialId }) => { bindings.set(consumerId, credentialId); },
      remove: async ({ consumerId }) => { bindings.delete(consumerId); },
    },
    attachments: {
      attach: async ({ keyId }) => { attached.add(keyId); },
      detach: async ({ keyId }) => { attached.delete(keyId); },
      isAttached: async ({ keyId }) => attached.has(keyId),
    },
    transaction: async ({ run }) => run(),
    ...(_over.inventory === undefined ? {} : { inventory: async () => _over.inventory ?? [] }),
  };
  return { shared, records, contexts, bindings, attached, installs };
}

type TokenRefresherDeps = Parameters<OAuthFlowOperations["createTokenRefresher"]>[0];
type Flow = Record<string, (...args: never[]) => unknown>;
export interface SignInRig {
  readonly service: ExternalMcpOAuthService;
  readonly h: Harness;
  readonly refresherDeps: TokenRefresherDeps[];
  readonly connected: string[];
  readonly devices: DeviceAuthorizationStore;
}

/** The real service over `row`; `token` answers every refresher's `getAccessToken`; `extra` overrides deps (e.g. sealer, keyring). */
export function makeSignInService(row: ExternalMcpServerRecord, _over: { flow?: Flow; shared?: SharedRig; onConnected?: ((id: string) => Promise<void>) | null; token?: (key: string) => Promise<string>; providers?: boolean; extra?: Partial<SignInDeps> } = {}): SignInRig {
  const refresherDeps: TokenRefresherDeps[] = [];
  const connected: string[] = [];
  const devices = createDeviceAuthorizationStore();
  const registry = { get: () => PROVIDER } as Partial<OAuthProviderRegistry> as OAuthProviderRegistry;
  const token = _over.token ?? (async (key: string) => `tok:${key}`);
  const flow: Flow = {
    createTokenRefresher: (input: TokenRefresherDeps): TokenRefresher => { refresherDeps.push(input); return { getAccessToken: ({ key }) => token(key), inFlightCount: () => 0 }; },
    createSealedAuthorizationState: (input: { serverId: string; workspaceId: string }) => ({ sealedFor: `${input.workspaceId}/${input.serverId}` }),
    createOAuthProviderRegistry: () => registry,
    ..._over.flow,
  };
  const onConnected = _over.onConnected === undefined ? async (id: string) => { connected.push(id); } : _over.onConnected;
  const h = makeHarness(new FakeRepo(row), { flow, extra: { devices, ...(onConnected === null ? {} : { onConnected }), ...(_over.providers === false ? {} : { providers: registry }), ...(_over.shared ? { shared: _over.shared.shared } : {}), ..._over.extra } });
  return { service: createHostedMcpSignInService(h.deps), h, refresherDeps, connected, devices };
}
