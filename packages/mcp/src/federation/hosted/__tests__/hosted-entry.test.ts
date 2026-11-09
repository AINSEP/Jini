/**
 * EXTRACT-S5 H1a: the public `@jini-ai/mcp/federation/hosted` entry reproduces the c3801c833 Tovu
 * projection outputs and admission-revision bytes (captured once before the move, never regenerated)
 * and owns exactly one class per canonical error. Second-host ids/paths/URLs throughout.
 */
import { describe, expect, test } from "vitest";
import * as entry from "../index.js";
import { ExternalMcpValidationError } from "../validation-error.js";
import { ExternalMcpSecretStoreUnconfiguredError } from "../unconfigured-error.js";

const sealed = (ciphertext: string) => ({ keyId: "k-second", ciphertext, nonce: "bm9uY2U=", alg: "aes-256-gcm" });
const ROWS = {
  stdioStatic: { createdAt: "2026-01-02T03:04:05.000Z", transport: "stdio", url: null, command: "/opt/second-host/bin/acme-mcp", args: "[\"--port\",\"7\"]", authMode: "static_env", sealedEnv: sealed("ZW52LWNpcGhlcg=="), sealedOAuth: sealed("c3RhdGljLXRva2Vu"), enabled: true, allowedToolNames: "[\"acme.read\",\"acme.write\"]", writeAllowedToolNames: "[\"acme.write\"]", writeGrantsUpdatedByPrincipalId: "operator:second", writeGrantsUpdatedAt: "2026-02-03T04:05:06.000Z", provisionedByPluginId: "second.plugin" },
  hostedOAuth: { createdAt: "2026-03-04T05:06:07.000Z", transport: "streamable_http", url: "https://mcp.second-host.example/rpc", command: null, args: null, authMode: "oauth", sealedEnv: null, sealedOAuth: sealed("b2F1dGgtYmxvYg=="), enabled: false, allowedToolNames: null, writeAllowedToolNames: null, writeGrantsUpdatedByPrincipalId: null, writeGrantsUpdatedAt: null, provisionedByPluginId: null },
  legacyMode: { createdAt: "2026-04-05T06:07:08.000Z", transport: "streamable_http", url: "https://mcp.second-host.example/legacy", command: null, args: null, authMode: "", sealedEnv: null, sealedOAuth: sealed("bGVnYWN5"), enabled: true, allowedToolNames: "not json", writeAllowedToolNames: "[1,\"x\"]", writeGrantsUpdatedByPrincipalId: null, writeGrantsUpdatedAt: null, provisionedByPluginId: null },
} as const;
const BASELINE: unknown = {"stdioStatic": {"revision": "13e4d4de162bed671342197ed4c373480a93227dcb78b01fa161b4d60a1a77fc", "snapshot": {"admissionRevision": "13e4d4de162bed671342197ed4c373480a93227dcb78b01fa161b4d60a1a77fc", "enabled": true, "allowedToolNames": "[\"acme.read\",\"acme.write\"]", "writeAllowedToolNames": "[\"acme.write\"]", "writeGrantsUpdatedByPrincipalId": "operator:second", "writeGrantsUpdatedAt": "2026-02-03T04:05:06.000Z", "provisionedByPluginId": "second.plugin"}, "grants": {"allowedToolNames": ["acme.read", "acme.write"], "writeAllowedToolNames": ["acme.write"]}, "hasStatic": true}, "hostedOAuth": {"revision": "ea6142287ca6aaef197097a46df462b5a89a46f894edbefad729d571d52de5e2", "snapshot": {"admissionRevision": "ea6142287ca6aaef197097a46df462b5a89a46f894edbefad729d571d52de5e2", "enabled": false, "allowedToolNames": null, "writeAllowedToolNames": null, "writeGrantsUpdatedByPrincipalId": null, "writeGrantsUpdatedAt": null, "provisionedByPluginId": null}, "grants": {"allowedToolNames": [], "writeAllowedToolNames": []}, "hasStatic": false}, "legacyMode": {"revision": "c9a1998fbcaab70695207d8b6bb6826bbce0a3052f1a89bd04b64ba145983541", "snapshot": {"admissionRevision": "c9a1998fbcaab70695207d8b6bb6826bbce0a3052f1a89bd04b64ba145983541", "enabled": true, "allowedToolNames": "not json", "writeAllowedToolNames": "[1,\"x\"]", "writeGrantsUpdatedByPrincipalId": null, "writeGrantsUpdatedAt": null, "provisionedByPluginId": null}, "grants": {"allowedToolNames": [], "writeAllowedToolNames": ["x"]}, "hasStatic": true}, "strictGrants": {"allowedToolNames": ["acme.read", "acme.write"], "writeAllowedToolNames": ["acme.write"]}, "strictError": {"name": "ToolInputError", "message": "The plugin connection has an unreadable tool list. Save its tool list again before enabling it."}, "validated": ["acme.read", "acme.write"], "validationErrors": [{"name": "ExternalMcpValidationError", "message": "'bad name' is not a valid MCP tool name, so the trust tier would refuse it on connect", "field": "writeAllowedToolNames"}, {"name": "ExternalMcpValidationError", "message": "at most 64 tools are supported", "field": "writeAllowedToolNames"}], "oauthStatus": ["connected", "needs_reauth", "disconnected", "disconnected"]};

const caught = (run: () => unknown) => { try { run(); return null; } catch (error) { const e = error as Error & { field?: string }; return e.field === undefined ? { name: e.name, message: e.message } : { name: e.name, message: e.message, field: e.field }; } };
function compute(p: typeof entry.hostedMcpProjections): unknown {
  const rows = Object.fromEntries(Object.entries(ROWS).map(([key, record]) => [key, { revision: p.admissionRevision(record), snapshot: p.accessSnapshot({ record }), grants: p.readToolGrants(record), hasStatic: p.hasStaticAccessToken(record) }]));
  return { ...rows, strictGrants: p.readToolGrants(ROWS.stdioStatic, { strict: true }), strictError: caught(() => p.readToolGrants(ROWS.legacyMode, { strict: true })),
    validated: p.validateToolNames({ names: ["acme.read", "acme.write", "acme.read"], field: "allowedToolNames" }),
    validationErrors: [["bad name"], Array.from({ length: 65 }, (_, i) => `t${i}`)].map(names => caught(() => p.validateToolNames({ names, field: "writeAllowedToolNames" }))),
    oauthStatus: ["connected", "needs_reauth", "bogus", null].map(oauthStatus => p.oauthStatus({ oauthStatus })) };
}

describe("@jini-ai/mcp/federation/hosted", () => {
  test("all six projection outputs and revision bytes equal the pre-move baseline", () => {
    expect(compute(entry.hostedMcpProjections)).toEqual(BASELINE);
  });

  test("projection members are the exported functions, not wrappers", () => {
    expect(entry.hostedMcpProjections.admissionRevision).toBe(entry.externalMcpAdmissionRevision);
    expect(entry.hostedMcpProjections.accessSnapshot).toBe(entry.externalMcpAccessSnapshot);
    expect(entry.hostedMcpProjections.readToolGrants).toBe(entry.readExternalMcpToolGrants);
    expect(entry.hostedMcpProjections.validateToolNames).toBe(entry.validateExternalMcpToolNames);
    expect(entry.hostedMcpProjections.oauthStatus).toBe(entry.resolveExternalMcpOAuthStatus);
    expect(entry.hostedMcpProjections.hasStaticAccessToken).toBe(entry.externalMcpRecordHasStaticAccessToken);
  });

  test("vocabulary tuples keep the saved literals", () => {
    expect(entry.SUPPORTED_EXTERNAL_MCP_TRANSPORTS).toEqual(["stdio", "streamable_http"]);
    expect(entry.EXTERNAL_MCP_OAUTH_GRANTS).toEqual(["authorization_code", "device_code"]);
    expect(entry.EXTERNAL_MCP_AUTH_MODES).toEqual(["none", "static_env", "oauth"]);
    expect(entry.EXTERNAL_MCP_OAUTH_STATUSES).toEqual(["disconnected", "pending", "connected", "needs_reauth"]);
    expect(entry.resolveExternalMcpAuthMode({ authMode: "anything-else" })).toBe("static_env");
  });

  test("one class per canonical error, identical through the entry, with name and field", () => {
    expect(entry.ExternalMcpValidationError).toBe(ExternalMcpValidationError);
    expect(entry.ExternalMcpSecretStoreUnconfiguredError).toBe(ExternalMcpSecretStoreUnconfiguredError);
    const thrown = (() => { try { entry.validateExternalMcpToolNames({ names: ["has space"], field: "acme.grants" }); } catch (e) { return e; } return undefined; })();
    expect(thrown).toBeInstanceOf(entry.ExternalMcpValidationError);
    expect(thrown).toMatchObject({ name: "ExternalMcpValidationError", field: "acme.grants" });
    const unconfigured = new entry.ExternalMcpSecretStoreUnconfiguredError("no key");
    expect(unconfigured).toBeInstanceOf(Error);
    expect(unconfigured).not.toBeInstanceOf(entry.ExternalMcpValidationError);
    expect(unconfigured.name).toBe("ExternalMcpSecretStoreUnconfiguredError");
  });
});
