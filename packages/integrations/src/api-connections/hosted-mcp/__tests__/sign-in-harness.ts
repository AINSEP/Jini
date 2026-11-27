/** In-memory fakes for the hosted-MCP sign-in helpers: a version-compared repository, a JSON
 *  "sealer" store and recording ports. Only used by the sign-in-*.test.ts files beside it. */
import type { ExternalMcpSealedOAuthPayload, ExternalMcpServerRecord } from "@jini-ai/core/contracts/hosted-mcp";
import type { DiscoveredOAuthConfiguration } from "@jini-ai/core/contracts/oauth";
import type { SealedSecret } from "@jini-ai/core/contracts/vault";
import type { HostedMcpOAuthFailure, HostedMcpSignInPorts } from "../contracts.js";
import type { SignInDeps } from "../sign-in-provider.js";

export const WS = "ws-1";
export const NOW_MS = Date.UTC(2026, 0, 2, 3, 4, 5);
export const NOW_ISO = new Date(NOW_MS).toISOString();

export class UnconfiguredError extends Error {}
export class FakeOAuthError extends Error {
  constructor(readonly code: string, message: string, readonly operatorAction: string) { super(message); }
}

export function sealed(payload: ExternalMcpSealedOAuthPayload): SealedSecret {
  return { keyId: "k1", ciphertext: JSON.stringify(payload), nonce: "n", alg: "fake" };
}

export function makeRecord(over: Partial<ExternalMcpServerRecord> = {}): ExternalMcpServerRecord {
  return {
    workspaceId: WS, serverId: "srv", label: "Server", provisionedByPluginId: null, transport: "http", authMode: "oauth",
    enabled: true, command: null, url: "https://mcp.example.test/mcp", args: null, allowedToolNames: null,
    writeAllowedToolNames: null, writeGrantsUpdatedByPrincipalId: null, writeGrantsUpdatedAt: null, envNames: null,
    sealedEnv: null, oauthProviderId: null, oauthGrant: null, oauthClientId: null, oauthEndpointsJson: null,
    oauthScopesJson: null, oauthStatus: null, oauthExpiresAt: null, oauthTokenEnvName: null, oauthRefreshLeaseUntil: null,
    sealedOAuth: null, aadVersion: 1, oauthAadVersion: 1, createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z", version: 3, ...over,
  };
}

type Repo = SignInDeps["repo"];
type IfVersionInput = Parameters<Repo["updateIfVersion"]>[0];
type RuntimeInput = Parameters<Repo["updateOAuthRuntime"]>[0];

/** Version-compared in-memory repository. `refuse*` counters make the next N writes miss. */
export class FakeRepo {
  readonly rows = new Map<string, ExternalMcpServerRecord>();
  readonly ifVersionCalls: IfVersionInput[] = [];
  readonly runtimeCalls: RuntimeInput[] = [];
  refuseIfVersion = 0;
  constructor(...records: ExternalMcpServerRecord[]) { for (const r of records) this.rows.set(r.serverId, r); }
  async findByServerId(key: { serverId: string }) { return this.rows.get(key.serverId) ?? null; }
  async updateIfVersion(input: IfVersionInput) {
    this.ifVersionCalls.push(input);
    const current = this.rows.get(input.record.serverId);
    if (this.refuseIfVersion > 0) { this.refuseIfVersion -= 1; return false; }
    if (!current || current.version !== input.expectedVersion) return false;
    this.rows.set(input.record.serverId, input.record);
    return true;
  }
  async updateOAuthRuntime(input: RuntimeInput) {
    this.runtimeCalls.push(input);
    const current = this.rows.get(input.key.serverId);
    if (!current || JSON.stringify(current.sealedOAuth) !== JSON.stringify(input.expectedSealedOAuth)) return false;
    this.rows.set(current.serverId, { ...current, ...input.patch });
    return true;
  }
  asPort(): Repo {
    return { findByServerId: k => this.findByServerId(k), updateIfVersion: i => this.updateIfVersion(i),
      updateOAuthRuntime: i => this.updateOAuthRuntime(i) } as Partial<Repo> as Repo;
  }
}

export interface Harness {
  readonly deps: SignInDeps;
  readonly repo: FakeRepo;
  readonly seals: ExternalMcpSealedOAuthPayload[];
  readonly flowCalls: { name: string; args: unknown[] }[];
  readonly devicesPut: [string, unknown][];
}

/** Builds deps around `repo`. `flow` replaces individual flow operations; `store` individual store ops. */
export function makeHarness(repo: FakeRepo, over: { flow?: Record<string, (...args: never[]) => unknown>; store?: Partial<HostedMcpSignInPorts["store"]>; extra?: Partial<SignInDeps> } = {}): Harness {
  const seals: ExternalMcpSealedOAuthPayload[] = [];
  const flowCalls: { name: string; args: unknown[] }[] = [];
  const devicesPut: [string, unknown][] = [];
  const flow = new Proxy({}, { get: (_t, name: string) => (...args: unknown[]) => {
    flowCalls.push({ name, args });
    const impl = over.flow?.[name] as ((...a: unknown[]) => unknown) | undefined;
    if (!impl) throw new Error(`unexpected flow.${name}`);
    return impl(...args);
  } });
  type Ports = HostedMcpSignInPorts;
  const errors: Ports["errors"] = {
    oauth: ({ code, message, operatorAction }) => new FakeOAuthError(code, message, operatorAction),
    isOAuthError: (e: unknown): e is HostedMcpOAuthFailure => e instanceof FakeOAuthError,
    validation: (message, field) => new Error(`validation(${field}): ${message}`),
    isUnconfigured: e => e instanceof UnconfiguredError,
    reauthRequired: ({ serverId, cause }) => new Error(`reauth:${serverId}`, { cause }),
  };
  const store: Ports["store"] = {
    openPayload: async (_s, record) => (record.sealedOAuth ? JSON.parse(record.sealedOAuth.ciphertext) as ExternalMcpSealedOAuthPayload : {}),
    sealPayload: async (_d, _i, payload) => { seals.push(payload); return { sealedOAuth: sealed(payload), oauthAadVersion: 9 }; },
    ...over.store,
  };
  const typed: Pick<Ports, "errors" | "store" | "projections" | "aad" | "registrationIdentity" | "withCopy"> = {
    errors, store,
    projections: { authMode: r => r.authMode as ReturnType<Ports["projections"]["authMode"]>, oauthStatus: r => r.oauthStatus as ReturnType<Ports["projections"]["oauthStatus"]> },
    aad: { format: ({ kind, version, parts }) => `${kind}|${version}|${parts.join(",")}` },
    registrationIdentity: { softwareId: "sw-id", clientName: r => `client for ${r.label ?? r.serverId}`, sharedClientName: "shared" },
    withCopy: ({ call }) => call(),
  };
  const ports = {
    ...typed, flow,
    oauthMessages: { tag: "messages" },
    discoveryPolicy: ({ guard }: { guard: unknown }) => ({ policyFor: guard }),
    copy: { actions: { noProvider: "act-provider", noClientId: "act-client", chooseGrant: "act-grant", noRegistration: "act-registration", restartDevice: "act-device", restartShared: "act-shared" },
      noSupportedGrant: ({ serverId, offered }: { serverId: string; offered: readonly string[] }) => `no grant for ${serverId}: ${offered.join("|")}` },
  } as unknown as Ports;
  const deps = {
    workspaceId: WS, repo: repo.asPort(), clock: { nowMs: () => NOW_MS },
    sealer: { tag: "sealer" }, keyring: { tag: "keyring" },
    httpPorts: { guard: { tag: "guard" } },
    devices: { put: async (id: string, a: unknown) => { devicesPut.push([id, a]); } },
    ports, ...over.extra,
  } as unknown as SignInDeps;
  return { deps, repo, seals, flowCalls, devicesPut };
}

/** A discovery result advertising an authorization-code server with dynamic registration. */
export function discovery(server: Record<string, unknown> = {}, rest: Record<string, unknown> = {}): DiscoveredOAuthConfiguration {
  return { server: { issuer: "https://as.test", tokenEndpoint: "https://as.test/token", authorizationEndpoint: "https://as.test/auth", deviceAuthorizationEndpoint: null,
    registrationEndpoint: "https://as.test/register", grantTypesSupported: ["authorization_code"], tokenEndpointAuthMethodsSupported: ["none"], ...server },
    resourceScopes: ["offline_access"], ...rest } as unknown as DiscoveredOAuthConfiguration;
}
