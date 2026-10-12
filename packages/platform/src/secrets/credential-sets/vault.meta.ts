import { VAULT_KINDS, VaultError, type VaultJson, type VaultKind, type VaultMeta, type VaultMetaParsers, type VaultOptions } from "./vault.types.js";

/** Copy eligibility lives with the kind contracts; MCP rows require their server configuration. */
export const isCopyableKind: Readonly<Record<VaultKind, boolean>> = Object.freeze({
  "site-assistant": true, "personal-execution": false, "media-provider": true, custom: true,
  "publish-peer": true, "database-destination": true, vendor: true, "source-control": true,
  "mcp-env": false, "mcp-auth": false,
});

type Field = "string" | "number" | "strings" | "object";
const FIELDS: Record<VaultKind, Record<string, Field>> = {
  "site-assistant": { baseUrl: "string", model: "string" },
  "personal-execution": { protocol: "string", baseUrl: "string", model: "string", maxTokens: "number" },
  "media-provider": { baseUrl: "string", model: "string" },
  custom: { category: "string", baseUrl: "string", additionalHosts: "strings", username: "string" },
  "publish-peer": { baseUrl: "string", remoteWorkspaceId: "string" },
  "database-destination": { description: "object", lastRun: "object" },
  vendor: { accountLabel: "string" }, "source-control": { accountLabel: "string" },
  "mcp-env": {}, "mcp-auth": {},
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}
function isJson(value: unknown): value is VaultJson {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  return isObject(value) && Object.keys(value).every(key => !["__proto__", "constructor", "prototype"].includes(key) && isJson(value[key]));
}

/** Minimal structural parsers. Hosts inject catalog, URL/origin and safe-metadata policy here;
 * secrets stay in payload JSON. Overrides own the complete shape, including merged patches.
 */
export function createVaultMetaParsers(
  _required: VaultOptions,
  { parsers = {} }: { parsers?: Partial<VaultMetaParsers> } = {},
): VaultMetaParsers {
  return Object.fromEntries(VAULT_KINDS.map(kind => [kind, ({ meta }: { meta: unknown }) => {
    if (!isObject(meta) || !isJson(meta) || Object.keys(meta).some(key => !/^[A-Za-z0-9_]+$/.test(key))) throw new VaultError({ code: "invalid-meta" });
    if (parsers[kind]) {
      const parsed = parsers[kind]({ meta: structuredClone(meta) });
      if (!isObject(parsed) || !isJson(parsed) || Object.keys(parsed).some(key => !/^[A-Za-z0-9_]+$/.test(key))) throw new VaultError({ code: "invalid-meta" });
      return structuredClone(parsed);
    }
    for (const [key, value] of Object.entries(meta)) {
      const field = Object.hasOwn(FIELDS[kind], key) ? FIELDS[kind][key] : undefined;
      if (!field || (value !== null && !(field === "strings" ? Array.isArray(value) && value.every(v => typeof v === "string") :
        field === "object" ? isObject(value) : typeof value === field))) throw new VaultError({ code: "invalid-meta" });
    }
    return structuredClone(meta);
  }])) as VaultMetaParsers;
}
