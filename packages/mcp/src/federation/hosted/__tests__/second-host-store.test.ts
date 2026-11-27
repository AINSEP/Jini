/**
 * EXTRACT-S5 H1b: a second host wires the moved store, in-memory repository, envelope module and
 * revocation error with its OWN vault service, memory repo, error class, credential policy, settings
 * path, ids and messages — no platform package, no first-host vocabulary.
 */
import { describe, expect, test, vi } from "vitest";
import { ToolInputError } from "@jini-ai/core";
import type { VaultErrorCode, VaultKind, VaultMetaParsers, VaultRecord, VaultRepoPort } from "@jini-ai/core/contracts/vault";
import * as entry from "../index.js";
import type { HostedMcpStorePorts } from "../index.js";

class AcmeVaultError extends Error {
  constructor(readonly code: VaultErrorCode) { super(`acme vault: ${code}`); }
}
class AcmeInputError extends Error {
  constructor(message: string, readonly field: string) { super(message); }
}
const KINDS: VaultKind[] = ["site-assistant", "personal-execution", "media-provider", "publish-peer", "database-destination", "vendor", "source-control", "mcp-env", "mcp-auth", "api-connection", "custom"];
const counts = { seal: 0, open: 0, services: 0, memoryRepos: 0 };
const aadOf = (r: { workspaceId: string; kind: string; ownerKey: string; principalId: string | null; binding: string | null; id: string }) =>
  JSON.stringify([r.workspaceId, r.kind, r.ownerKey, r.principalId, r.binding, r.id]);

function memoryRepo(): VaultRepoPort {
  counts.memoryRepos += 1;
  const rows = new Map<string, VaultRecord>();
  const key = (i: { workspaceId: string; id: string }) => `${i.workspaceId}/${i.id}`;
  return {
    find: async (i) => structuredClone(rows.get(key(i)) ?? null),
    list: async () => [...rows.values()],
    put: async ({ record }) => { const saved: VaultRecord = { ...record, isDefault: record.isDefault ?? false }; rows.set(key(record), saved); return structuredClone(saved); },
    patchMeta: async () => { throw new AcmeVaultError("conflict"); },
    delete: async (i) => rows.delete(key(i)),
  };
}

const ports: HostedMcpStorePorts = {
  vault: {
    createMemoryRepo: memoryRepo,
    createService: (deps) => {
      counts.services += 1;
      return {
        put: async (input) => {
          await deps.authorize({ action: "put", context: input });
          const meta = deps.metaParsers[input.kind]({ meta: input.meta, provider: input.provider });
          const sealed = await deps.sealer.seal({ plaintext: JSON.stringify(input.payload), key: await deps.keyring.activeKey({}), aad: aadOf(input) });
          const now = deps.now();
          await deps.repo.put({ expectedRevision: input.expectedRevision, record: { workspaceId: input.workspaceId, id: input.id, kind: input.kind, ownerKey: input.ownerKey,
            principalId: input.principalId, binding: input.binding, provider: input.provider, label: input.label, revision: 1, tokenLength: null, last4: null,
            meta, sealed, createdAt: now, updatedAt: now } });
          return input;
        },
        get: async (input) => {
          await deps.authorize({ action: "get", context: input });
          const record = await deps.repo.find(input);
          if (!record?.sealed) return null;
          return { payload: JSON.parse(await deps.sealer.open({ sealed: record.sealed }, { aad: aadOf(record) })) };
        },
      };
    },
  },
  vaultErrors: { create: ({ code }) => new AcmeVaultError(code) },
  metaParsers: ({ validateMeta }) => Object.fromEntries(KINDS.map((kind) => [kind, ({ meta }: { meta: unknown }) => validateMeta({ kind, meta: meta as never })])) as unknown as VaultMetaParsers,
  assertFreeField: ({ value, field }) => { if (value.startsWith("sk_acme_")) throw new AcmeInputError("Acme: keep keys out of plain fields.", field); },
  credential: {
    normalize: ({ value, field = "token" }) => { if (typeof value !== "string" || value.trim() === "") throw new AcmeInputError("Acme: empty token.", field); return value.trim(); },
    assert: ({ value }) => { if (typeof value !== "string" || /\s/.test(value)) throw new AcmeInputError("Acme: token has spaces.", "token"); },
    hint: ({ token }) => ({ length: token.length, last4: token.length >= 12 ? token.slice(-4) : null }),
    messages: { env: "Acme: bad env.", ascii: "Acme: ascii only.", storage: "Acme: vault offline.", blank: "Acme: blank env.", url: "Acme: bad url." },
    limit: 4096,
    InputError: AcmeInputError,
  },
  settingsLink: "Console › Tools › Remote servers",
  reauthRequiredCode: "ACME_SIGN_IN_AGAIN",
};
const sealer = {
  seal: async ({ plaintext, aad }: { plaintext: string; aad: string }) => { counts.seal += 1; return { keyId: "acme-k1", ciphertext: Buffer.from(`${aad}\n${plaintext}`).toString("base64"), nonce: "bm9uY2U=", alg: "acme-toy" }; },
  open: async ({ sealed }: { sealed: { ciphertext: string } }, optional?: { aad?: string }) => {
    counts.open += 1;
    const [aad, plaintext] = Buffer.from(sealed.ciphertext, "base64").toString().split("\n");
    if (aad !== optional?.aad) throw new Error("acme: aad mismatch for sk_acme_secret");
    return plaintext!;
  },
};
const keyring = { activeKey: async () => ({ id: "acme-k1", bytes: new Uint8Array(32) }), deriveSigningSecret: async () => new Uint8Array(), derive: async () => new Uint8Array() } as never;
const clock = { nowMs: () => Date.parse("2031-01-02T03:04:05.000Z") } as never;
const WS = "acme-ws-7";
const FIRST_HOST_WORDS = /Settings → External MCP|Integrations → External MCP|tovu/i;

describe("second host wires the hosted MCP store by ports", () => {
  test("save/list/read with its own vault, ids and settings path; exact seal/open counts", async () => {
    const repo = new entry.InMemoryExternalMcpServerRepo(ports);
    Object.assign(counts, { seal: 0, open: 0 });
    const events: string[] = [];
    let releaseEnv!: () => void;
    let envStarted!: () => void;
    const envGate = new Promise<void>(resolve => { releaseEnv = resolve; });
    const started = new Promise<void>(resolve => { envStarted = resolve; });
    const tracedSealer = {
      seal: async (input: Parameters<typeof sealer.seal>[0]) => {
        const kind = JSON.parse(input.aad)[1] === "mcp-env" ? "env" : "auth";
        events.push(`${kind} seal`);
        if (kind === "env") { envStarted(); await envGate; }
        return sealer.seal(input);
      },
      open: async (...args: Parameters<typeof sealer.open>) => {
        events.push(JSON.parse(args[1]!.aad!)[1] === "mcp-env" ? "env open" : "auth open");
        return sealer.open(...args);
      },
    };
    const insert = repo.insert.bind(repo);
    vi.spyOn(repo, "insert").mockImplementation(async input => {
      const written = await insert(input);
      if (written) events.push("write");
      return written;
    });
    const deps = { repo, sealer: tracedSealer, keyring, clock: { nowMs: () => { events.push("clock"); return Date.parse("2031-01-02T03:04:05.000Z"); } }, ...ports };
    const saving = entry.saveExternalMcpServer(deps, { workspaceId: WS, enabled: true, serverId: "acme-files", label: "Acme Files", transport: "stdio", command: "acme-mcp",
      args: "--serve", env: "ACME_REGION=eu-1", allowedToolNames: "list_files", authMode: "static_env", accessToken: "acme-token-123456789", accessTokenEnvName: "ACME_TOKEN" } as never);
    await started;
    await new Promise<void>(resolve => { setTimeout(resolve, 0); });
    try { expect(events).toEqual(["env seal"]); } finally { releaseEnv(); }
    const view = await saving;
    expect(events).toEqual(["env seal", "auth seal", "clock", "write", "env open", "auth open"]);
    expect(counts.seal).toBe(2); // env + static-token blob
    expect(counts.open).toBe(2); // toView: env 1 + static 1
    expect(view.accessTokenHint).toEqual({ length: 20, last4: "6789" });
    Object.assign(counts, { seal: 0, open: 0 });
    const { configs, failures } = await entry.readEnabledExternalMcpConfigs({ deps: { repo, sealer, ...ports }, workspaceId: WS });
    expect([counts.seal, counts.open, failures]).toEqual([0, 2, []]);
    expect(configs[0]!.target).toEqual({ kind: "stdio", command: "acme-mcp", args: ["--serve"], env: { ACME_REGION: "eu-1", ACME_TOKEN: "acme-token-123456789" } });
  });

  test("omitted and exact-empty credentials carry ciphertext and AAD; whitespace refuses and JSON clears env", async () => {
    const repo = new entry.InMemoryExternalMcpServerRepo(ports);
    const deps = { repo, sealer, keyring, clock, ...ports };
    const input = { workspaceId: WS, enabled: true, serverId: "acme-carry", transport: "stdio", command: "acme-mcp", args: "", allowedToolNames: "",
      writeAllowedToolNames: "", principalId: "operator:acme", authMode: "static_env", accessTokenEnvName: "ACME_TOKEN" };
    await entry.saveExternalMcpServer(deps, { ...input, env: "K=v", accessToken: "acme-token-123456789" } as never);
    const original = (await repo.findByServerId(input))!;
    await repo.upsert({ ...original, aadVersion: 0, oauthAadVersion: 0 });
    Object.assign(counts, { seal: 0 });
    for (const patch of [{}, { env: "", accessToken: "" }]) {
      await entry.saveExternalMcpServer(deps, { ...input, ...patch } as never);
      const carried = (await repo.findByServerId(input))!;
      expect([carried.sealedEnv, carried.sealedOAuth, carried.aadVersion, carried.oauthAadVersion])
        .toEqual([original.sealedEnv, original.sealedOAuth, 0, 0]);
      expect(counts.seal).toBe(0);
    }
    await expect(entry.saveExternalMcpServer(deps, { ...input, env: " \n " } as never)).rejects.toBeInstanceOf(entry.ExternalMcpValidationError);
    await expect(entry.saveExternalMcpServer(deps, { ...input, accessToken: "   " } as never)).rejects.toMatchObject({ field: "accessToken" });
    await entry.saveExternalMcpServer(deps, { ...input, env: "{}" } as never);
    expect((await repo.findByServerId(input))!.sealedEnv).toBeNull();
    expect(counts.seal).toBe(0);
  });

  test("an unchanged OAuth binding rebuilds from a real runtime write at the same version", async () => {
    const repo = new entry.InMemoryExternalMcpServerRepo(ports);
    const deps = { repo, sealer, keyring, clock, ...ports };
    const input = { workspaceId: WS, enabled: true, serverId: "acme-retry", transport: "streamable_http", command: "", url: "https://mcp.acme.test/mcp", args: "",
      allowedToolNames: "", writeAllowedToolNames: "", principalId: "operator:acme", authMode: "oauth", oauth: { clientId: "acme-client", clientSecret: "acme-client-secret", tokenEndpoint: "https://idp.acme.test/token" } };
    await entry.saveExternalMcpServer(deps, input as never);
    const before = (await repo.findByServerId(input))!;
    const expiresAt = "2031-01-03T03:04:05.000Z" as never;
    const lease = "2031-01-02T03:05:05.000Z" as never;
    const payload = { clientSecret: "refreshed-client-secret", tokens: { accessToken: "refreshed-token", refreshToken: "refresh-2", tokenType: "Bearer", scopes: [], expiresAt } };
    const refreshed = await entry.sealExternalMcpOAuthPayload({ deps, identity: before, payload });
    const update = repo.updateIfVersion.bind(repo);
    let attempts = 0;
    vi.spyOn(repo, "updateIfVersion").mockImplementation(async required => {
      attempts += 1;
      if (attempts === 1) {
        expect(await repo.updateOAuthRuntime({ key: before, expectedSealedOAuth: before.sealedOAuth,
          patch: { ...refreshed, oauthStatus: "connected", oauthExpiresAt: expiresAt, oauthRefreshLeaseUntil: lease, updatedAt: expiresAt } })).toBe(true);
        expect((await repo.findByServerId(input))!.version).toBe(before.version);
      }
      return update(required);
    });
    await entry.saveExternalMcpServer(deps, { ...input, expectedVersion: before.version, oauth: {} } as never);
    const saved = (await repo.findByServerId(input))!;
    expect(attempts).toBe(2);
    expect([saved.version, saved.oauthStatus, saved.oauthExpiresAt, saved.oauthRefreshLeaseUntil])
      .toEqual([before.version + 1, "connected", expiresAt, lease]);
    expect(await entry.openExternalMcpOAuthPayload(deps, saved)).toEqual(payload);
  });

  test("changing the token endpoint preserves dynamic registration keys and clears token and lease", async () => {
    const repo = new entry.InMemoryExternalMcpServerRepo(ports);
    const deps = { repo, sealer, keyring, clock, ...ports };
    const input = { workspaceId: WS, enabled: true, serverId: "acme-binding", transport: "streamable_http", command: "", url: "https://mcp.acme.test/mcp", args: "",
      allowedToolNames: "", writeAllowedToolNames: "", principalId: "operator:acme", authMode: "oauth", oauth: { clientId: "acme-client", tokenEndpoint: "https://idp.acme.test/token" } };
    await entry.saveExternalMcpServer(deps, input as never);
    const before = (await repo.findByServerId(input))!;
    const dynamic = { clientAuth: "client_secret_post", dynamicClientId: "registered-client", registeredRedirectUri: "https://acme.test/callback" };
    const sealed = await entry.sealExternalMcpOAuthPayload({ deps, identity: before, payload: { clientSecret: "old-secret", tokens: { accessToken: "old-token", refreshToken: "old-refresh", tokenType: "Bearer", scopes: [], expiresAt: null } } });
    await repo.upsert({ ...before, ...sealed, oauthEndpointsJson: JSON.stringify({ ...JSON.parse(before.oauthEndpointsJson!), ...dynamic }),
      oauthStatus: "connected", oauthExpiresAt: "2031-01-03T00:00:00.000Z" as never, oauthRefreshLeaseUntil: "2031-01-02T04:00:00.000Z" as never });
    await entry.saveExternalMcpServer(deps, { ...input, oauth: { tokenEndpoint: "https://idp.acme.test/new-token", clientSecret: "replacement-secret" } } as never);
    const saved = (await repo.findByServerId(input))!;
    expect(JSON.parse(saved.oauthEndpointsJson!)).toEqual({ tokenEndpoint: "https://idp.acme.test/new-token", ...dynamic });
    expect([saved.oauthStatus, saved.oauthExpiresAt, saved.oauthRefreshLeaseUntil]).toEqual(["disconnected", null, null]);
    expect(await entry.openExternalMcpOAuthPayload(deps, saved)).toEqual({ clientSecret: "replacement-secret" });
  });

  test("reordered write grants preserve attribution without reading the principal; a changed set reads it", async () => {
    const repo = new entry.InMemoryExternalMcpServerRepo(ports);
    const deps = { repo, sealer, keyring, clock, ...ports };
    const input = { workspaceId: WS, enabled: true, serverId: "acme-grants", transport: "stdio", command: "acme-mcp", args: "", authMode: "none",
      allowedToolNames: "read,write", writeAllowedToolNames: "read,write", principalId: "operator:first" };
    await entry.saveExternalMcpServer(deps, input as never);
    const before = (await repo.findByServerId(input))!;
    const reordered = { ...input, writeAllowedToolNames: "write,read", get principalId(): string { throw new Error("principal must remain deferred"); } };
    await entry.saveExternalMcpServer(deps, reordered as never);
    const unchanged = (await repo.findByServerId(input))!;
    expect([unchanged.writeGrantsUpdatedByPrincipalId, unchanged.writeGrantsUpdatedAt])
      .toEqual([before.writeGrantsUpdatedByPrincipalId, before.writeGrantsUpdatedAt]);
    let reads = 0;
    const changed = { ...input, writeAllowedToolNames: "write", get principalId() { reads += 1; return "operator:second"; } };
    await entry.saveExternalMcpServer({ ...deps, clock: { nowMs: () => Date.parse("2032-02-03T04:05:06.000Z") } }, changed as never);
    const saved = (await repo.findByServerId(input))!;
    expect(reads).toBe(1);
    expect([saved.writeGrantsUpdatedByPrincipalId, saved.writeGrantsUpdatedAt]).toEqual(["operator:second", "2032-02-03T04:05:06.000Z"]);
  });

  test("approval validates the subset before I/O and refuses a false CAS with the canonical error", async () => {
    const updateAccessIfCurrent = vi.fn(async () => false);
    const input = { repo: { updateAccessIfCurrent }, clock, workspaceId: WS, serverId: "acme-approval", principalId: "operator:acme",
      expected: { admissionRevision: "old", enabled: false, allowedToolNames: null, writeAllowedToolNames: null,
        writeGrantsUpdatedByPrincipalId: null, writeGrantsUpdatedAt: null, provisionedByPluginId: null },
      access: { enabled: true, allowedToolNames: ["read"], writeAllowedToolNames: ["write"] } };
    await expect(entry.applyExternalMcpAccess(input)).rejects.toBeInstanceOf(entry.ExternalMcpValidationError);
    expect(updateAccessIfCurrent).not.toHaveBeenCalled();
    const valid = { ...input, access: { ...input.access, writeAllowedToolNames: ["read"] } };
    await expect(entry.applyExternalMcpAccess(valid)).rejects.toBeInstanceOf(ToolInputError);
    expect(updateAccessIfCurrent).toHaveBeenCalledTimes(1);
  });

  test("failures carry the second host's settings path, its messages and errors, never first-host wording or provider text", async () => {
    const repo = new entry.InMemoryExternalMcpServerRepo(ports);
    const deps = { repo, sealer, keyring, clock, ...ports };
    await entry.saveExternalMcpServer(deps, { workspaceId: WS, enabled: true, serverId: "acme-env", transport: "stdio", command: "acme-mcp", args: "", env: "K=v", allowedToolNames: "" } as never);
    const broken = { ...sealer, open: async () => { throw new Error("provider said sk_acme_secret at https://idp.acme.test/x"); } };
    const { failures } = await entry.readEnabledExternalMcpConfigs({ deps: { repo, sealer: broken, ...ports }, workspaceId: WS });
    expect(failures).toEqual([{ serverId: "acme-env", reason: "stored credentials could not be decrypted — check the site credential store and re-enter them in Console › Tools › Remote servers" }]);
    await expect(entry.saveExternalMcpServer(deps, { workspaceId: WS, serverId: "acme-x", transport: "stdio", command: "sk_acme_leak", args: "", allowedToolNames: "" } as never))
      .rejects.toMatchObject({ name: "ExternalMcpValidationError", message: "Acme: keep keys out of plain fields.", field: "command" });
    const revoked = new entry.ExternalMcpConnectionRevokedError({ serverId: "acme-env", label: null, remoteName: "t", reason: "removed", code: "ACME_CONNECTION_REVOKED",
      messages: Object.fromEntries((["removed", "turned-off", "disconnected", "changed", "tool-not-allowed", "write-not-allowed", "unverifiable"] as const).map((r) => [r, () => `Acme ${r}; see Console.`])) as never });
    expect([revoked.message, revoked.code, revoked.retryable]).toEqual(["Acme removed; see Console.", "ACME_CONNECTION_REVOKED", false]);
    expect(JSON.stringify(failures) + revoked.message).not.toMatch(FIRST_HOST_WORDS);
    expect(JSON.stringify(failures)).not.toMatch(/sk_acme_secret|idp\.acme\.test/);
  });

  test("boot skips disabled secrets, redacts broken env and resolves shared tokens before pending status", async () => {
    const repo = new entry.InMemoryExternalMcpServerRepo(ports);
    const deps = { repo, sealer, keyring, clock, ...ports };
    const input = { workspaceId: WS, enabled: false, serverId: "acme-disabled", transport: "stdio", command: "acme-mcp", args: "", env: "K=v", allowedToolNames: "" };
    await entry.saveExternalMcpServer(deps, input as never);
    await entry.saveExternalMcpServer(deps, { ...input, serverId: "acme-broken", enabled: true } as never);
    await entry.saveExternalMcpServer(deps, { ...input, serverId: "acme-shared", enabled: true, env: "{}", authMode: "oauth", transport: "streamable_http", url: "https://mcp.acme.test/mcp" } as never);
    const shared = (await repo.findByServerId({ workspaceId: WS, serverId: "acme-shared" }))!;
    await repo.upsert({ ...shared, oauthStatus: "pending" });
    const opened: string[] = [];
    const broken = { ...sealer, open: async (_required: Parameters<typeof sealer.open>[0], optional?: { aad?: string }) => {
      opened.push(JSON.parse(optional!.aad!)[2]);
      throw new Error("provider sk_acme_secret https://idp.acme.test/private");
    } };
    let token: string | undefined = "shared-token-1";
    const resolveSharedAccessToken = vi.fn(async () => token);
    const resolveAccessToken = vi.fn(async () => { throw new Error("local status must not win"); });
    const result = await entry.readEnabledExternalMcpConfigs({ deps: { repo, sealer: broken, oauth: { resolveSharedAccessToken, resolveAccessToken }, ...ports }, workspaceId: WS });
    expect(opened).toEqual(["acme-broken"]);
    expect(result.failures).toEqual([{ serverId: "acme-broken", reason: "stored credentials could not be decrypted — check the site credential store and re-enter them in Console › Tools › Remote servers" }]);
    expect(resolveAccessToken).not.toHaveBeenCalled();
    expect(resolveSharedAccessToken).toHaveBeenCalledTimes(1);
    expect(result.configs.map(config => config.serverId)).toEqual(["acme-shared"]);
    const target = result.configs[0]!.target;
    expect(target.kind).toBe("streamable_http");
    if (target.kind !== "streamable_http") throw new Error("expected hosted target");
    expect(target.headers).toEqual({ authorization: "Bearer shared-token-1" });
    const [mapped] = entry.toResolvedFederatedConnections({ configs: result.configs });
    expect(mapped!.bearerToken).toBe(target.bearerToken);
    expect(resolveSharedAccessToken).toHaveBeenCalledTimes(1);
    token = "shared-token-2";
    expect(await mapped!.bearerToken!({ url: "https://mcp.example.invalid/v1" })).toBe("shared-token-2");
    token = undefined;
    await expect(mapped!.bearerToken!({ url: "https://mcp.example.invalid/v1" })).rejects.toThrow("This shared connection was removed from this site. Choose a saved connection again in Console › Tools › Remote servers.");
    expect(resolveSharedAccessToken).toHaveBeenCalledTimes(3);
  });

  test("boot opens enabled rows sequentially while the first env open is deferred", async () => {
    const repo = new entry.InMemoryExternalMcpServerRepo(ports);
    const deps = { repo, sealer, keyring, clock, ...ports };
    for (const serverId of ["acme-first", "acme-second"]) {
      await entry.saveExternalMcpServer(deps, { workspaceId: WS, serverId, enabled: true, transport: "stdio", command: "acme-mcp", args: "", env: "K=v", allowedToolNames: "" } as never);
    }
    let release!: () => void;
    let signal!: () => void;
    let releaseSecond!: () => void;
    let signalSecond!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { signal = resolve; });
    const secondGate = new Promise<void>(resolve => { releaseSecond = resolve; });
    const secondStarted = new Promise<void>(resolve => { signalSecond = resolve; });
    const opened: string[] = [];
    const deferred = { ...sealer, open: async (...args: Parameters<typeof sealer.open>) => {
      const serverId = JSON.parse(args[1]!.aad!)[2] as string;
      opened.push(serverId);
      if (serverId === "acme-first") { signal(); await gate; }
      if (serverId === "acme-second") { signalSecond(); await secondGate; }
      return sealer.open(...args);
    } };
    const reading = entry.readEnabledExternalMcpConfigs({ deps: { repo, sealer: deferred, ...ports }, workspaceId: WS });
    await started;
    await new Promise<void>(resolve => { setTimeout(resolve, 0); });
    try {
      expect(opened).toEqual(["acme-first"]);
      release();
      await secondStarted;
      expect(opened).toEqual(["acme-first", "acme-second"]);
    } finally { release(); releaseSecond(); }
    const result = await reading;
    expect(opened).toEqual(["acme-first", "acme-second"]);
    expect(result.configs.map(config => config.serverId)).toEqual(["acme-first", "acme-second"]);
    expect(result.failures).toEqual([]);
  });

  test("OAuth opening distinguishes absent, unreadable, legacy and future payloads", async () => {
    const deps = { sealer, keyring, ...ports };
    const identity = { workspaceId: WS, serverId: "acme-payload" };
    Object.assign(counts, { open: 0 });
    expect(await entry.openExternalMcpOAuthPayload(deps, { ...identity, sealedOAuth: null, oauthAadVersion: 0 })).toEqual({});
    expect(counts.open).toBe(0);
    const legacy = { clientSecret: "legacy-secret", tokens: { accessToken: "legacy-token", refreshToken: null, tokenType: "Bearer", scopes: [], expiresAt: null } };
    const sealedOAuth = await entry.sealExternalMcpVaultPayload({ deps, identity, kind: "mcp-auth", payload: legacy });
    const record = { ...identity, sealedOAuth, oauthAadVersion: 1 };
    await expect(entry.openExternalMcpOAuthPayload({ ...deps, sealer: { open: async () => { throw new Error("unreadable"); } } }, record))
      .rejects.toBeInstanceOf(entry.ExternalMcpSecretStoreUnconfiguredError);
    expect(await entry.openExternalMcpOAuthPayload(deps, record)).toEqual(legacy);
    const future = await entry.sealExternalMcpVaultPayload({ deps, identity, kind: "mcp-auth", payload: { ...legacy, schemaVersion: entry.EXTERNAL_MCP_OAUTH_PAYLOAD_VERSION + 1 } });
    const failed = entry.openExternalMcpOAuthPayload(deps, { ...record, sealedOAuth: future });
    await expect(failed).rejects.toBeInstanceOf(Error);
    await expect(failed).rejects.not.toBeInstanceOf(entry.ExternalMcpSecretStoreUnconfiguredError);
    await expect(failed).rejects.toThrow("newer than this build understands");
  });

  test("admin listing without a sealer infers token presence from blob plus status or expiry", async () => {
    const repo = new entry.InMemoryExternalMcpServerRepo(ports);
    const deps = { repo, sealer, keyring, clock, ...ports };
    const input = { workspaceId: WS, serverId: "acme-presence", enabled: true, transport: "streamable_http", url: "https://mcp.acme.test/mcp", command: "", args: "", allowedToolNames: "", authMode: "oauth", oauth: { clientSecret: "client-secret" } };
    await entry.saveExternalMcpServer(deps, input as never);
    const before = (await repo.findByServerId(input))!;
    const states = [{ oauthStatus: "disconnected", oauthExpiresAt: null, sealedOAuth: before.sealedOAuth },
      { oauthStatus: "connected", oauthExpiresAt: null, sealedOAuth: before.sealedOAuth },
      { oauthStatus: "pending", oauthExpiresAt: "2031-01-03T00:00:00.000Z" as never, sealedOAuth: before.sealedOAuth },
      { oauthStatus: "connected", oauthExpiresAt: "2031-01-03T00:00:00.000Z" as never, sealedOAuth: null }];
    const presence: boolean[] = [];
    Object.assign(counts, { open: 0 });
    for (const state of states) {
      await repo.upsert({ ...before, ...state });
      const [view] = await entry.listExternalMcpServerViews({ deps: { repo, ...ports }, workspaceId: WS });
      presence.push(view!.oauth.hasStoredToken);
      expect(view!.accessTokenHint).toBeNull();
    }
    expect(presence).toEqual([false, true, true, false]);
    expect(counts.open).toBe(0);
  });

  test("authorization: foreign workspace/server/kind refused with the host error before crypto", async () => {
    const sealed = await entry.sealExternalMcpVaultPayload({ deps: { sealer, keyring, ...ports }, identity: { workspaceId: WS, serverId: "acme-a" }, kind: "mcp-env", payload: { K: "v" } });
    Object.assign(counts, { open: 0 });
    for (const identity of [{ workspaceId: "acme-ws-other", serverId: "acme-a" }, { workspaceId: WS, serverId: "acme-b" }]) {
      await expect(entry.openExternalMcpVaultPayload({ sealer, sealed, identity, kind: "mcp-env", ports })).rejects.toBeInstanceOf(AcmeVaultError);
    }
    await expect(entry.openExternalMcpVaultPayload({ sealer, sealed, identity: { workspaceId: WS, serverId: "acme-a" }, kind: "mcp-auth", ports })).rejects.toMatchObject({ code: "context" });
    await expect(entry.sealExternalMcpVaultPayload({ deps: { sealer, keyring, ...ports }, identity: { workspaceId: WS, serverId: "acme-a" }, kind: "vendor" as never, payload: {} })).rejects.toMatchObject({ code: "context" });
    expect(counts.open).toBe(0);
    expect(await entry.openExternalMcpVaultPayload({ sealer, sealed, identity: { workspaceId: WS, serverId: "acme-a" }, kind: "mcp-env", ports })).toEqual({ K: "v" });
  });

  test("a reauthorization failure carries the typed reauth_required category; other failures carry none", async () => {
    const repo = new entry.InMemoryExternalMcpServerRepo(ports);
    const deps = { repo, sealer, keyring, clock, ...ports };
    await entry.saveExternalMcpServer(deps, { workspaceId: WS, enabled: true, serverId: "acme-env", transport: "stdio", command: "acme-mcp", args: "", env: "K=v", allowedToolNames: "" } as never);
    const saved = (await repo.findByServerId({ workspaceId: WS, serverId: "acme-env" }))!;
    const hosted = { ...saved, transport: "streamable_http", command: null, url: "https://mcp.acme.test/mcp", authMode: "oauth", sealedEnv: null };
    await repo.upsert({ ...hosted, serverId: "acme-stored", oauthStatus: "needs_reauth" } as never);
    await repo.upsert({ ...hosted, serverId: "acme-live", oauthStatus: "connected" } as never);
    await repo.upsert({ ...hosted, serverId: "acme-down", oauthStatus: "connected" } as never);
    const oauth = { resolveAccessToken: async ({ serverId }: { serverId: string }): Promise<string> => {
      if (serverId === "acme-live") throw Object.assign(new Error("idp said no"), { code: "ACME_SIGN_IN_AGAIN" });
      throw new Error("idp unreachable");
    } };
    const { failures } = await entry.readEnabledExternalMcpConfigs({ deps: { repo, sealer, oauth, ...ports }, workspaceId: WS });
    expect(Object.fromEntries(failures.map((failure) => [failure.serverId, failure.category ?? null])))
      .toEqual({ "acme-stored": "reauth_required", "acme-live": "reauth_required", "acme-down": null });
    expect(failures.find((failure) => failure.serverId === "acme-stored")?.reason)
      .toBe("its authorization expired or was revoked — reconnect it in Console › Tools › Remote servers");
  });
});

test("invalid auth mode and OAuth grant report fields without submitted values", async () => {
  const repo = new entry.InMemoryExternalMcpServerRepo(ports);
  const deps = { repo, sealer, keyring, clock, ...ports };
  const input = { workspaceId: WS, serverId: "acme-invalid", enabled: true, transport: "streamable_http",
    url: "https://mcp.acme.test/mcp", command: "", args: "", allowedToolNames: "" };
  const marker = "private-enum-marker";
  await expect(entry.saveExternalMcpServer(deps, { ...input, authMode: marker } as never))
    .rejects.toMatchObject({ name: "ExternalMcpValidationError", field: "authMode",
      message: "auth mode is not supported — expected one of none, static_env, oauth" });
  await expect(entry.saveExternalMcpServer(deps, { ...input, authMode: "oauth", oauth: { grant: marker } } as never))
    .rejects.toMatchObject({ name: "ExternalMcpValidationError", field: "oauth.grant",
      message: "OAuth grant is not supported — expected one of authorization_code, device_code" });
});

const stdioInput = { workspaceId: WS, serverId: "docs", enabled: true, transport: "stdio",
  command: " docs-mcp ", args: '  --format=json "project folder" ""\t--tail  ',
  allowedToolNames: "read", writeAllowedToolNames: "", principalId: "operator:acme" };
const hostedInput = { ...stdioInput, transport: "streamable_http", url: "https://docs.example/mcp" };
const stdioOAuth = { providerId: "docs-idp", grant: "device_code", clientId: "desktop", tokenEnvName: "DOCS_ACCESS" };

function setupStore() {
  const repo = new entry.InMemoryExternalMcpServerRepo(ports);
  return { repo, sealer, keyring, clock, ...ports };
}

test("stdio arguments retain quoted spaces, empty arguments and literal embedded quotes on readback", async () => {
  const deps = setupStore();
  await entry.saveExternalMcpServer(deps, { ...stdioInput, authMode: "none",
    args: ' --name="docs" "path with space"\t"" --tail' });
  const { configs, failures } = await entry.readEnabledExternalMcpConfigs({ deps, workspaceId: WS });
  expect(failures).toEqual([]);
  expect(configs.find(config => config.serverId === "docs")?.target).toEqual({
    kind: "stdio", command: "docs-mcp", args: ['--name="docs"', "path with space", "", "--tail"], env: {},
  });
});

test.each([
  { patch: { args: '"unclosed' }, field: "args", message: "an argument opens a double quote that never closes" },
  { patch: { args: '"path"suffix' }, field: "args", message: "a closing double quote must be followed by a space or the end of the arguments" },
  { patch: { command: '   ' }, field: "command", message: "a stdio server needs a command to launch" },
  { patch: { transport: "unsupported" }, field: "transport", message: "transport 'unsupported' is not supported — only stdio, streamable_http is implemented" },
  { patch: { transport: "streamable_http" }, field: "url", message: "a streamable_http server needs a URL" },
  { patch: { transport: "streamable_http", url: "this is not a URL" }, field: "url", message: "Acme: bad url." },
  { patch: { transport: "streamable_http", url: "http://docs.example/mcp" }, field: "url", message: "a remote MCP server URL must use https (http is permitted only for loopback)" },
  { patch: { env: "DOCS=enabled\nmissing-equals" }, field: "env", message: "line 2 of the environment block is not `NAME=VALUE` — correct it in the connection form" },
  { patch: { env: "DOCS=enabled\n9DOCS=no" }, field: "env", message: "line 2 of the environment block has an invalid variable name (letters, digits and underscore, not starting with a digit)" },
  { patch: { env: " \t\n " }, field: "env", message: "Acme: blank env." },
])("invalid stored configuration is refused without writing: $message", async ({ patch, field, message }) => {
  const deps = setupStore();
  await expect(entry.saveExternalMcpServer(deps, { ...stdioInput, authMode: "none", ...patch }))
    .rejects.toMatchObject({ name: "ExternalMcpValidationError", field, message });
  expect(await deps.repo.findByServerId(stdioInput)).toBeNull();
});

test("a local development HTTP endpoint is normalized without demanding HTTPS", async () => {
  const deps = setupStore();
  await entry.saveExternalMcpServer(deps, { ...hostedInput, authMode: "none", url: " http://localhost:8181/mcp " });
  expect((await deps.repo.findByServerId(hostedInput))?.url).toBe("http://localhost:8181/mcp");
});

test.each([
  { field: "args", patch: (n: number) => ({ args: Array.from({ length: n }, (_, i) => `--arg-${i}`).join(" ") }), label: "arguments" },
  { field: "env", patch: (n: number) => ({ env: Array.from({ length: n }, (_, i) => `ENTRY_${i}=value`).join("\n") }), label: "environment variables" },
  { field: "env", patch: (n: number) => ({ env: JSON.stringify(Object.fromEntries(Array.from({ length: n }, (_, i) => [`ENTRY_${i}`, "value"]))) }), label: "environment variables" },
  { field: "oauth.scopes", patch: (n: number) => ({ authMode: "oauth", oauth: { ...stdioOAuth, scopes: Array.from({ length: n }, (_, i) => `scope:${i}`).join(", ") } }), label: "OAuth scopes" },
])("permits 64 $label but refuses 65 ($field)", async ({ patch, field, label }) => {
  const deps = setupStore();
  await entry.saveExternalMcpServer(deps, { ...stdioInput, authMode: "none", ...patch(64) });
  const before = await deps.repo.findByServerId(stdioInput);
  expect(before?.version).toBe(1);
  await expect(entry.saveExternalMcpServer(deps, { ...stdioInput, authMode: "none", ...patch(65) }))
    .rejects.toMatchObject({ name: "ExternalMcpValidationError", field, message: `at most 64 ${label} are supported` });
  expect(await deps.repo.findByServerId(stdioInput)).toEqual(before);
});

test.each([
  { patch: { providerId: undefined }, field: "providerId", message: "an OAuth connection needs either a registered provider id or its own token endpoint" },
  { patch: { providerId: "Bad_ID" }, field: "providerId", message: "'Bad_ID' is not a valid provider id (lowercase letters, digits and hyphens)" },
  { patch: { grant: "" }, field: "grant", message: "an OAuth connection needs a sign-in method" },
  { patch: { clientId: "" }, field: "clientId", message: "an OAuth connection needs a client id" },
  { patch: { clientId: "x".repeat(1025) }, field: "clientId", message: "the OAuth client id may be at most 1024 characters" },
  { patch: { tokenEnvName: "" }, field: "tokenEnvName", message: "a stdio server authenticated with OAuth needs the name of the environment variable that receives its access token" },
  { patch: { tokenEnvName: "9DOCS" }, field: "tokenEnvName", message: "'9DOCS' is not a valid environment variable name (letters, digits and underscore, not starting with a digit)" },
  { patch: { clientSecret: "   " }, field: "clientSecret", message: "Acme: empty token." },
])("validates OAuth fields for local commands: $message", async ({ patch, field, message }) => {
  const deps = setupStore();
  const oauth = { ...stdioOAuth, ...patch };
  // Empty provider is an explicit absence rather than a loose undefined property on a partial payload.
  if (!oauth.providerId) oauth.providerId = "";
  await expect(entry.saveExternalMcpServer(deps, { ...stdioInput, authMode: "oauth",
    oauth: { ...oauth, providerId: oauth.providerId } }))
    .rejects.toMatchObject({ name: "ExternalMcpValidationError", field: `oauth.${field}`, message });
  expect(await deps.repo.findByServerId(stdioInput)).toBeNull();
});

test("saving explicit empty OAuth scopes clears the saved list and repairs a corrupt endpoints column", async () => {
  const deps = setupStore();
  const input = { ...hostedInput, authMode: "oauth", oauth: { scopes: "docs.read, docs.write" } };
  await entry.saveExternalMcpServer(deps, input);
  const before = (await deps.repo.findByServerId(input))!;
  expect(before.oauthScopesJson).toBe('["docs.read","docs.write"]');
  await deps.repo.upsert({ ...before, oauthEndpointsJson: '{invalid' });
  await entry.saveExternalMcpServer(deps, { ...input, oauth: { scopes: "" } });
  expect(await deps.repo.findByServerId(input)).toMatchObject({ oauthScopesJson: "[]", oauthEndpointsJson: null, version: 2 });
});

test.each([
  { input: { ...stdioInput, accessToken: "fixture-token" }, field: "accessTokenEnvName", message: "a local command given an access token needs the name of the environment variable that receives it" },
  { input: { ...stdioInput, accessToken: "fixture-token", accessTokenEnvName: "9DOCS" }, field: "accessTokenEnvName", message: "'9DOCS' is not a valid environment variable name (letters, digits and underscore, not starting with a digit)" },
  { input: { ...hostedInput }, field: "accessToken", message: "Enter a token. Spaces alone are not a token." },
])("a static credential needs valid placement before saving: $message", async ({ input, field, message }) => {
  const deps = setupStore();
  await expect(entry.saveExternalMcpServer(deps, { ...input, authMode: "static_env" }))
    .rejects.toMatchObject({ name: "ExternalMcpValidationError", field, message });
  expect(await deps.repo.findByServerId(input)).toBeNull();
});

test.each(["env", "accessToken"] as const)("a failing seal of %s reports safe storage copy and writes nothing", async field => {
  const deps = setupStore();
  const failing = { ...deps, sealer: { ...sealer, seal: async () => { throw new Error("private keystore path"); } } };
  const input = field === "env" ? { ...stdioInput, authMode: "none", env: "DOCS=enabled" } :
    { ...hostedInput, authMode: "static_env", accessToken: "fixture-token" };
  await expect(entry.saveExternalMcpServer(failing, input)).rejects.toMatchObject({
    name: "ExternalMcpSecretStoreUnconfiguredError", message: "Acme: vault offline.",
  });
  expect(await deps.repo.findByServerId(input)).toBeNull();
});

test("an overflowing roster still allows edits and frees a slot after deletion", async () => {
  const deps = setupStore();
  const input = { ...stdioInput, authMode: "none" };
  for (let i = 0; i < 32; i++) {
    await entry.saveExternalMcpServer(deps, { ...input, serverId: `docs-${i}` });
  }
  await expect(entry.saveExternalMcpServer(deps, input)).rejects.toMatchObject({
    name: "ExternalMcpValidationError", field: "id", message: "this workspace already has the maximum of 32 external MCP servers",
  });
  expect(await deps.repo.findByServerId(input)).toBeNull();
  const edited = { ...input, serverId: "docs-0", label: "Updated Docs" };
  await entry.saveExternalMcpServer(deps, edited);
  expect((await deps.repo.findByServerId(edited))?.label).toBe("Updated Docs");
  expect(await entry.deleteExternalMcpServer(deps, edited)).toBe(true);
  expect(await deps.repo.findByServerId(edited)).toBeNull();
  expect(await entry.deleteExternalMcpServer(deps, edited)).toBe(false);
  await entry.saveExternalMcpServer(deps, input);
  expect((await deps.repo.findByServerId(input))?.version).toBe(1);
});

test("a stdio OAuth token wins over a stale variable and only the explicit environment is launched", async () => {
  const deps = setupStore();
  const input = { ...stdioInput, authMode: "oauth", command: "docs-launcher", args: '"config path" --read',
    env: "DOCS_TOKEN=old\nDOCS_REGION=west", allowedToolNames: "read", oauth: {
      providerId: "acme-docs", clientId: "client", grant: "device_code", tokenEnvName: "DOCS_TOKEN",
    } };
  await entry.saveExternalMcpServer(deps, input);
  const row = await deps.repo.findByServerId(input);
  if (!row) throw new Error("Expected stored connection");
  await deps.repo.upsert({ ...row, oauthStatus: "connected" });
  const resolveAccessToken = vi.fn(async () => "fresh-token");
  const { configs, failures } = await entry.readEnabledExternalMcpConfigs({ deps: { ...deps, oauth: { resolveAccessToken } }, workspaceId: WS });
  expect(failures).toEqual([]);
  expect(entry.toResolvedFederatedConnections({ configs }).map(({ launch, config }) => ({ launch, id: config.connectionId })))
    .toEqual([{ id: input.serverId, launch: { command: "docs-launcher", args: ["config path", "--read"],
      env: { DOCS_TOKEN: "fresh-token", DOCS_REGION: "west" } } }]);
  expect(resolveAccessToken).toHaveBeenCalledExactlyOnceWith({ serverId: input.serverId });
});

test.each([
  { authMode: "static_env", message: "no environment variable name is configured to receive its access token" },
  { authMode: "oauth", message: "no environment variable name is configured to receive its OAuth access token" },
] as const)("boot excludes a legacy $authMode row with no token variable", async ({ authMode, message }) => {
  const deps = setupStore();
  const input = authMode === "static_env"
    ? { ...stdioInput, authMode, accessToken: "fixture-token", accessTokenEnvName: "DOCS_TOKEN" }
    : { ...stdioInput, authMode, oauth: { providerId: "acme-docs", clientId: "client", grant: "device_code", tokenEnvName: "DOCS_TOKEN" } };
  await entry.saveExternalMcpServer(deps, input);
  const row = await deps.repo.findByServerId(input);
  if (!row) throw new Error("Expected stored connection");
  await deps.repo.upsert({ ...row, oauthTokenEnvName: null });
  const resolveAccessToken = vi.fn(async () => "unexpected-token");
  expect(await entry.readEnabledExternalMcpConfigs({ deps: { ...deps, oauth: { resolveAccessToken } }, workspaceId: WS }))
    .toEqual({ configs: [], failures: [{ serverId: input.serverId, reason: message }] });
  expect(resolveAccessToken).not.toHaveBeenCalled();
});

test("an unsupported stored transport is reported without opening its credentials", async () => {
  const deps = setupStore();
  const input = { ...stdioInput, env: "REGION=west" };
  await entry.saveExternalMcpServer(deps, input);
  const row = await deps.repo.findByServerId(input);
  if (!row) throw new Error("Expected stored connection");
  await deps.repo.upsert({ ...row, transport: "legacy" });
  const open = vi.fn(sealer.open);
  expect(await entry.readEnabledExternalMcpConfigs({ deps: { ...deps, sealer: { ...sealer, open } }, workspaceId: WS }))
    .toEqual({ configs: [], failures: [{ serverId: input.serverId, reason: "unsupported transport 'legacy'" }] });
  expect(open).not.toHaveBeenCalled();
});

test("a hosted OAuth row reports pending authorization and missing resolver as different failures", async () => {
  const deps = setupStore();
  const input = { ...hostedInput, authMode: "oauth" };
  await entry.saveExternalMcpServer(deps, input);
  const row = await deps.repo.findByServerId(input);
  if (!row) throw new Error("Expected stored connection");
  const read = () => entry.readEnabledExternalMcpConfigs({ deps, workspaceId: WS });
  expect(await read()).toEqual({ configs: [], failures: [{ serverId: input.serverId,
    reason: "it has not been authorized yet (status 'pending') — connect it in Console › Tools › Remote servers" }] });
  await deps.repo.upsert({ ...row, oauthStatus: "connected" });
  expect(await read()).toEqual({ configs: [], failures: [{ serverId: input.serverId,
    reason: "this process was not wired with an OAuth token resolver, so its access token cannot be obtained" }] });
});

test("a corrupted hosted access token is not added to a launch config or exposed in diagnostics", async () => {
  const deps = setupStore();
  const input = { ...hostedInput, authMode: "static_env", accessToken: "fixture-token" };
  await entry.saveExternalMcpServer(deps, input);
  const broken = { ...sealer, open: async () => { throw new Error("private key detail"); } };
  expect(await entry.readEnabledExternalMcpConfigs({ deps: { ...deps, sealer: broken }, workspaceId: WS }))
    .toEqual({ configs: [], failures: [{ serverId: input.serverId,
      reason: "its stored access token could not be decrypted — re-enter it in Console › Tools › Remote servers" }] });
});

test("plain OAuth identifiers are screened, while the secret field may carry opaque credentials", async () => {
  const deps = setupStore();
  const input = { ...hostedInput, authMode: "oauth", oauth: { providerId: "acme", clientSecret: "sk_acme_fixture" } };
  await expect(entry.saveExternalMcpServer(deps, { ...input, oauth: { ...input.oauth, clientId: "sk_acme_wrong_field" } }))
    .rejects.toMatchObject({ name: "ExternalMcpValidationError", field: "oauth.clientId", message: "Acme: keep keys out of plain fields." });
  expect(await deps.repo.findByServerId(input)).toBeNull();
  await entry.saveExternalMcpServer(deps, input);
  const row = await deps.repo.findByServerId(input);
  if (!row) throw new Error("Expected stored connection");
  expect(await entry.openExternalMcpOAuthPayload(deps, row)).toEqual({ clientSecret: "sk_acme_fixture" });
  const fieldFailure = new Error("plain-field dependency unavailable");
  await expect(entry.saveExternalMcpServer({ ...deps, assertFreeField: () => { throw fieldFailure; } }, input)).rejects.toBe(fieldFailure);
  expect(await deps.repo.findByServerId(input)).toEqual(row);
});

test("the admin view retains variable names after unseal fails and never emits a placeholder hint", async () => {
  const deps = setupStore();
  const input = { ...stdioInput, authMode: "none", env: "DOCS_API=sample-secret\nREGION=west" };
  await entry.saveExternalMcpServer(deps, input);
  const sealer = { ...deps.sealer, open: async () => { throw new Error("old key was retired"); } };
  const { serverId } = input;
  const view = (await entry.listExternalMcpServerViews({ deps: { ...deps, sealer }, workspaceId: WS })).find(row => row.serverId === serverId);
  expect(view).toMatchObject({ serverId, envNames: ["DOCS_API", "REGION"], accessTokenHint: null, hasAccessToken: false });
  expect(view).not.toHaveProperty("envTokenHints");
  expect(JSON.stringify(view)).not.toMatch(/sample-secret|old key/);
});

test("the store refuses a server id that cannot be used as a federation namespace", async () => {
  const deps = setupStore();
  const input = { ...stdioInput, serverId: "team_docs" };
  await expect(entry.saveExternalMcpServer(deps, input)).rejects.toMatchObject({
    name: "ExternalMcpValidationError", field: "id", message: expect.stringContaining("connectionId 'team_docs' must match"),
  });
  expect(await deps.repo.findByServerId(input)).toBeNull();
});

test.each([
  { kind: "typed input refusal", error: new AcmeInputError("Acme: token rejected.", "token"), reason: "Acme: token rejected." },
  { kind: "unexpected host error", error: new Error("private policy detail"), reason: "Acme: ascii only." },
])("hosted bearer validation distinguishes a $kind without connecting", async ({ error, reason }) => {
  const deps = setupStore();
  const input = { ...hostedInput, authMode: "static_env", accessToken: "fixture-token" };
  await entry.saveExternalMcpServer(deps, input);
  const assert = vi.fn<HostedMcpStorePorts["credential"]["assert"]>(() => { throw error; });
  expect(await entry.readEnabledExternalMcpConfigs({ deps: { ...deps, credential: { ...deps.credential, assert } }, workspaceId: WS }))
    .toEqual({ configs: [], failures: [{ serverId: input.serverId, reason }] });
  expect(assert).toHaveBeenCalledExactlyOnceWith({ value: "fixture-token", hosted: true });
});

test.each([
  { authMode: "static_env", patch: { accessToken: "fixture-token" } },
  { authMode: "oauth", patch: { oauth: { clientSecret: "fixture-secret" } } },
])("unexpected $authMode credential normalization errors propagate without writing a row", async ({ authMode, patch }) => {
  const deps = setupStore();
  const error = new Error("credential policy unavailable");
  const normalize = vi.fn<HostedMcpStorePorts["credential"]["normalize"]>(() => { throw error; });
  const input = { ...hostedInput, authMode, ...patch };
  await expect(entry.saveExternalMcpServer({ ...deps, credential: { ...deps.credential, normalize } }, input)).rejects.toBe(error);
  expect(await deps.repo.findByServerId(input)).toBeNull();
});

test("a shared grant lookup failure never falls back to the locally owned OAuth token", async () => {
  const deps = setupStore();
  const input = { ...hostedInput, authMode: "oauth" };
  await entry.saveExternalMcpServer(deps, input);
  const row = await deps.repo.findByServerId(input);
  if (!row) throw new Error("Expected stored connection");
  await deps.repo.upsert({ ...row, oauthStatus: "connected" });
  const resolveSharedAccessToken = vi.fn(async () => { throw new Error("private provider detail"); });
  const resolveAccessToken = vi.fn(async () => "owned-token");
  const oauth = { resolveSharedAccessToken, resolveAccessToken };
  expect(await entry.readEnabledExternalMcpConfigs({ deps: { ...deps, oauth }, workspaceId: WS })).toEqual({
    configs: [], failures: [{ serverId: input.serverId, reason: "This shared connection is no longer granted to this site. Choose it again or sign in from Console › Tools › Remote servers." }],
  });
  expect(resolveSharedAccessToken).toHaveBeenCalledExactlyOnceWith({ serverId: input.serverId });
  expect(resolveAccessToken).not.toHaveBeenCalled();
});
