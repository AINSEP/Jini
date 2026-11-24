import { describe, expect, it } from "vitest";
import type { VaultRecord } from "@jini-ai/core/contracts/vault";
import {
  buildPublishContentPeerAad,
  legacyVaultAad,
  normalizeLegacyVaultPayload,
  type LegacyVaultPolicy,
  type VaultLegacyContext,
} from "../legacy-codecs.js";

// Moved from the host's vault-l005-characterization and vault-boot integration tests. The host's
// own owner key is injected; `host` stands in for it here.
const formerCustomOwnerKey = "host";
const record: VaultRecord = { workspaceId: "ws", id: "id", kind: "vendor", ownerKey: formerCustomOwnerKey, principalId: null,
  binding: null, provider: null, label: "Label", isDefault: true, revision: 1, sealed: null,
  last4: null, tokenLength: null, meta: {}, createdAt: "2026-10-20", updatedAt: "2026-10-20" };
const legacy: VaultLegacyContext = { table: "custom_credential_sets", workspaceId: "ws", id: "id",
  principalId: null, provider: null, serverId: null, aadVersion: 1 };
const policy: LegacyVaultPolicy = { tokenField: () => "token",
  legacyPublishCredential: () => ({ vendorId: "target", tokenField: "apiToken" }) };
const aadOf = (input: { record: VaultRecord; legacy: VaultLegacyContext }) => legacyVaultAad({ ...input, formerCustomOwnerKey });

describe("legacy vault codecs", () => {
  it("L005: historical AAD lineages pin exact bytes and reject wrong kinds/versions/scopes", () => {
    const cases: { table: string; row: Partial<VaultRecord>; context?: Partial<VaultLegacyContext>; aad: string; zero?: boolean }[] = [
      { table: "site_assistant_credentials", row: { kind: "site-assistant" }, aad: "site-assistant-credential:v1:ws", zero: true },
      { table: "admin_execution_credentials", row: { kind: "personal-execution", principalId: "person" }, context: { principalId: "person" }, aad: "admin-execution-credential:v1:ws:person", zero: true },
      { table: "media_provider_credentials", row: { kind: "media-provider", provider: "media" }, context: { provider: "media" }, aad: "media-provider-credential:v1:ws:media", zero: true },
      { table: "custom_credential_sets", row: { meta: { credentialType: "custom" } }, aad: "custom-credential-set:v1:ws:id" },
      { table: "publish_content_peers", row: { kind: "publish-peer" }, aad: "publish-content-peer:v1:ws:id" },
      { table: "database_transfer_destinations", row: { kind: "database-destination" }, aad: "database-transfer-destination:v1:ws" },
      { table: "vendor_credential_sets", row: { provider: "vendor" }, context: { provider: "vendor" }, aad: "vendor-credential-set:v1:ws:vendor:id" },
      { table: "source_control_credential_sets", row: { kind: "source-control", provider: "git" }, context: { provider: "git" }, aad: "source-control-credential-set:v1:ws:git:id" },
      { table: "publish_credential_sets", row: {}, context: { provider: "host" }, aad: "publish-credential-set:v1:ws:host:id" },
      { table: "external_mcp_servers", row: { kind: "mcp-env", ownerKey: "server" }, context: { serverId: "server" }, aad: "external-mcp-env:v1:ws:server", zero: true },
      { table: "external_mcp_servers", row: { kind: "mcp-auth", ownerKey: "server" }, context: { serverId: "server" }, aad: "external-mcp-oauth:v1:ws:server", zero: true },
      { table: "secrets_vault_custom_v1", row: { meta: { credentialType: "custom" } }, aad: `secrets-vault:v1:["ws","id","custom","${formerCustomOwnerKey}",null,null]` },
    ];
    for (const entry of cases) {
      const row = { ...record, ...entry.row };
      const context = { ...legacy, ...entry.context, table: entry.table };
      expect(aadOf({ record: row, legacy: context }), entry.table).toBe(entry.aad);
      if (entry.zero) expect(aadOf({ record: row, legacy: { ...context, aadVersion: 0 } })).toBeUndefined();
      else expect(() => aadOf({ record: row, legacy: { ...context, aadVersion: 0 } })).toThrow();
      for (const aadVersion of [-1, 2, 0.5, NaN]) expect(() => aadOf({ record: row, legacy: { ...context, aadVersion } })).toThrow();
      expect(() => aadOf({ record: row, legacy: { ...context, workspaceId: "other" } })).toThrow();
      expect(() => aadOf({ record: { ...row, kind: "wrong" as VaultRecord["kind"] }, legacy: context })).toThrow();
    }
    expect(() => aadOf({ record, legacy: { ...legacy, table: "unknown" } })).toThrow();
    for (const field of ["id", "ownerKey", "provider", "principalId", "binding"] as const) {
      expect(() => aadOf({ record: { ...record, meta: { credentialType: "custom" }, [field]: "other" }, legacy: { ...legacy, table: "secrets_vault_custom_v1" } })).toThrow();
    }
  });

  it("the former custom vault AAD binds the injected host owner key, not a fixed one", () => {
    const row = { ...record, meta: { credentialType: "custom" } };
    const context = { ...legacy, table: "secrets_vault_custom_v1" };
    expect(() => legacyVaultAad({ record: row, legacy: context, formerCustomOwnerKey: "another-host" })).toThrow();
    expect(legacyVaultAad({ record: { ...row, ownerKey: "another-host" }, legacy: context, formerCustomOwnerKey: "another-host" }))
      .toBe('secrets-vault:v1:["ws","id","custom","another-host",null,null]');
  });

  it("legacy codec checks versions, personal/MCP identity and exact peer version format", () => {
    expect(buildPublishContentPeerAad({ workspaceId: "ws", id: "peer" })).toBe("publish-content-peer:v1:ws:peer");
    expect(buildPublishContentPeerAad({ workspaceId: "ws", id: "peer", aadVersion: 2 })).toBe("publish-content-peer:v2:ws:peer");
    const personal = { workspaceId: "ws", kind: "personal-execution", principalId: "p", provider: "provider", ownerKey: formerCustomOwnerKey } as Parameters<typeof legacyVaultAad>[0]["record"];
    const context: VaultLegacyContext = { table: "admin_execution_credentials", workspaceId: "ws", id: "ws", principalId: "p", provider: "provider", serverId: null, aadVersion: 1 };
    expect(aadOf({ record: personal, legacy: context })).toBe("admin-execution-credential:v1:ws:p");
    expect(aadOf({ record: personal, legacy: { ...context, aadVersion: 0 } })).toBeUndefined();
    expect(() => aadOf({ record: personal, legacy: { ...context, aadVersion: 2 } })).toThrow();
    expect(() => aadOf({ record: personal, legacy: { ...context, principalId: "other" } })).toThrow();
    expect(() => aadOf({ record: personal, legacy: { ...context, workspaceId: "other" } })).toThrow();
    expect(() => aadOf({ record: personal, legacy: { ...context, table: "unknown" } })).toThrow();
  });
});

function normalize({ row, plaintext }: { row: VaultRecord; plaintext: string | null },
  { context = legacy, injected = policy }: { context?: VaultLegacyContext; injected?: LegacyVaultPolicy } = {}) {
  return normalizeLegacyVaultPayload({ record: row, legacy: context, plaintext, policy: injected });
}

describe("legacy vault payload normalization", () => {
  it("L005: payload normalization pins null/plain/JSON, username precedence, publish mapping and MCP hints", () => {
    expect(normalize({ row: { ...record, meta: { normalization: "missing-key", legacyAad: {}, keep: true } }, plaintext: null })).toEqual({ payload: null, meta: { keep: true }, provider: null });
    for (const kind of ["site-assistant", "personal-execution", "media-provider", "publish-peer"] as const)
      expect(normalize({ row: { ...record, kind }, plaintext: "plain" })).toEqual({ payload: { apiKey: "plain" }, meta: {}, provider: null, hintToken: "plain" });
    expect(normalize({ row: { ...record, kind: "database-destination" }, plaintext: "connection" })).toEqual({ payload: { connectionString: "connection" }, meta: {}, provider: null });
    for (const text of ["null", "[]", "1", '"string"', "invalid"]) expect(() => normalize({ row: record, plaintext: text })).toThrow();
  });

  it("L005: custom usernames, publish discriminators and MCP token hints retain their historical contracts", () => {
    for (const username of [undefined, null, "saved"]) {
      const row = { ...record, meta: { credentialType: "custom", ...(username === undefined ? {} : { username }) } };
      const result = normalize({ row, plaintext: '{"username":"sealed","token":"plain"}' });
      expect(result.meta.username).toBe(username === "saved" ? "saved" : "sealed");
      expect(result.payload).toEqual({ token: "plain" });
      expect(result.hintToken).toBe("plain");
      expect(row.meta).toEqual({ credentialType: "custom", ...(username === undefined ? {} : { username }) });
    }
    for (const username of ["", null, 1]) expect(normalize({ row: { ...record, meta: { credentialType: "custom" } }, plaintext: JSON.stringify({ username }) }).meta.username).toBeUndefined();
    for (const kind of ["mcp-env", "mcp-auth"] as const) expect(normalize({ row: { ...record, kind }, plaintext: '{"token":"plain","schemaVersion":1}' }).hintToken).toBeUndefined();
    expect(normalize({ row: record, plaintext: '{"token":1}' }).hintToken).toBeUndefined();
    expect(normalize({ row: record, plaintext: "{}" }, { injected: { ...policy, tokenField: () => undefined } }).hintToken).toBeUndefined();
    expect(normalize({ row: record, plaintext: '{"providerId":"old","apiToken":"plain"}' }, { context: { ...legacy, table: "publish_credential_sets", provider: "host" } }))
      .toEqual({ payload: { vendorId: "target", apiToken: "plain" }, meta: {}, provider: "target", hintToken: "plain" });
    expect(() => normalize({ row: record, plaintext: "{}" }, { context: { ...legacy, table: "publish_credential_sets", provider: "host" }, injected: { ...policy, legacyPublishCredential: () => undefined } })).toThrow(/VAULT_CATALOG_UNAVAILABLE/);
  });
});
