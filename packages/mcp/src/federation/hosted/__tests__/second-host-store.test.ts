/**
 * EXTRACT-S5 H1b: a second host wires the moved store, in-memory repository, envelope module and
 * revocation error with its OWN vault service, memory repo, error class, credential policy, settings
 * path, ids and messages — no platform package, no first-host vocabulary.
 */
import { describe, expect, test } from "vitest";
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
    const deps = { repo, sealer, keyring, clock, ...ports };
    const view = await entry.saveExternalMcpServer(deps, { workspaceId: WS, enabled: true, serverId: "acme-files", label: "Acme Files", transport: "stdio", command: "acme-mcp",
      args: "--serve", env: "ACME_REGION=eu-1", allowedToolNames: "list_files", authMode: "static_env", accessToken: "acme-token-123456789", accessTokenEnvName: "ACME_TOKEN" } as never);
    expect(counts.seal).toBe(2); // env + static-token blob
    expect(counts.open).toBe(2); // toView: env 1 + static 1
    expect(view.accessTokenHint).toEqual({ length: 20, last4: "6789" });
    Object.assign(counts, { seal: 0, open: 0 });
    const { configs, failures } = await entry.readEnabledExternalMcpConfigs({ repo, sealer, ...ports }, WS);
    expect([counts.seal, counts.open, failures]).toEqual([0, 2, []]);
    expect(configs[0]!.target).toEqual({ kind: "stdio", command: "acme-mcp", args: ["--serve"], env: { ACME_REGION: "eu-1", ACME_TOKEN: "acme-token-123456789" } });
  });

  test("failures carry the second host's settings path, its messages and errors, never first-host wording or provider text", async () => {
    const repo = new entry.InMemoryExternalMcpServerRepo(ports);
    const deps = { repo, sealer, keyring, clock, ...ports };
    await entry.saveExternalMcpServer(deps, { workspaceId: WS, enabled: true, serverId: "acme-env", transport: "stdio", command: "acme-mcp", args: "", env: "K=v", allowedToolNames: "" } as never);
    const broken = { ...sealer, open: async () => { throw new Error("provider said sk_acme_secret at https://idp.acme.test/x"); } };
    const { failures } = await entry.readEnabledExternalMcpConfigs({ repo, sealer: broken, ...ports }, WS);
    expect(failures).toEqual([{ serverId: "acme-env", reason: "stored credentials could not be decrypted — check the site credential store and re-enter them in Console › Tools › Remote servers" }]);
    await expect(entry.saveExternalMcpServer(deps, { workspaceId: WS, serverId: "acme-x", transport: "stdio", command: "sk_acme_leak", args: "", allowedToolNames: "" } as never))
      .rejects.toMatchObject({ name: "ExternalMcpValidationError", message: "Acme: keep keys out of plain fields.", field: "command" });
    const revoked = new entry.ExternalMcpConnectionRevokedError({ serverId: "acme-env", label: null, remoteName: "t", reason: "removed", code: "ACME_CONNECTION_REVOKED",
      messages: Object.fromEntries((["removed", "turned-off", "disconnected", "changed", "tool-not-allowed", "write-not-allowed", "unverifiable"] as const).map((r) => [r, () => `Acme ${r}; see Console.`])) as never });
    expect([revoked.message, revoked.code, revoked.retryable]).toEqual(["Acme removed; see Console.", "ACME_CONNECTION_REVOKED", false]);
    expect(JSON.stringify(failures) + revoked.message).not.toMatch(FIRST_HOST_WORDS);
    expect(JSON.stringify(failures)).not.toMatch(/sk_acme_secret|idp\.acme\.test/);
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
});
