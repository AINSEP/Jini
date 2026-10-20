import { VAULT_KINDS, VaultError, type VaultJson, type VaultKind, type VaultMeta, type VaultMetaParsers, type VaultOptions } from "./vault.types.js";
import { normalizeCredentialWorksFor } from "./provider-matches.js";

/** Copy eligibility lives with the kind contracts; MCP rows require their server configuration. */
export const isCopyableKind: Readonly<Record<VaultKind, boolean>> = Object.freeze({
  "site-assistant": true, "personal-execution": false, "media-provider": true, custom: false,
  "publish-peer": true, "database-destination": true, vendor: true, "source-control": true,
  "mcp-env": false, "mcp-auth": false,
  // A plugin API connection's tokens and attempts are bound to one workspace's sign-in.
  "api-connection": false,
});

type Field = "string" | "number" | "strings" | "object";
const FIELDS: Record<VaultKind, Record<string, Field>> = {
  "site-assistant": { baseUrl: "string", model: "string" },
  "personal-execution": { protocol: "string", baseUrl: "string", model: "string", maxTokens: "number" },
  "media-provider": { baseUrl: "string", model: "string" },
  custom: { credentialType: "string", worksFor: "strings", category: "string", baseUrl: "string", additionalHosts: "strings", username: "string" },
  "publish-peer": { baseUrl: "string", remoteWorkspaceId: "string" },
  "database-destination": { description: "object", lastRun: "object" },
  vendor: { accountLabel: "string", credentialType: "string", worksFor: "strings", category: "string",
    baseUrl: "string", additionalHosts: "strings", username: "string" }, "source-control": { accountLabel: "string" },
  "mcp-env": {}, "mcp-auth": {},
  // Hosts register the owning feature's parser (e.g. parseOAuthTokenVaultMeta); no default fields.
  "api-connection": {},
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

/** Enforce common credential metadata before and after optional host policy parsing.
 * Missing fields on pre-unification rows are read defaults, never a reason to rewrite/reseal.
 * Explicit empty compatibility is preserved; labels never imply compatibility.
 * @throws VaultError when a supplied subtype or compatibility list is invalid.
 * @complexity O(worksFor characters); returns a fresh metadata object.
 */
function credentialMeta({ meta, kind, provider }: { meta: VaultMeta; kind: "vendor" | "custom"; provider?: string | null | undefined }, _options: VaultOptions = {}): VaultMeta {
  const credentialType = meta.credentialType === undefined ? kind : meta.credentialType;
  if ((credentialType !== "vendor" && credentialType !== "custom") || (kind === "custom" && credentialType !== "custom")) throw new VaultError({ code: "invalid-meta" });
  const worksFor = meta.worksFor === undefined ? (credentialType === "vendor" && provider != null ? [provider] : []) : meta.worksFor;
  return { ...meta, credentialType, worksFor: normalizeCredentialWorksFor({ value: worksFor }) };
}

/** Minimal structural parsers. Hosts inject catalog, URL/origin and safe-metadata policy here;
 * secrets stay in payload JSON. Overrides own the complete shape, including merged patches.
 */
export function createVaultMetaParsers(
  _required: VaultOptions,
  { parsers = {} }: { parsers?: Partial<VaultMetaParsers> } = {},
): VaultMetaParsers {
  return Object.fromEntries([...VAULT_KINDS, "custom" as const].map(kind => [kind, ({ meta, provider }: { meta: unknown; provider?: string | null | undefined }) => {
    if (!isObject(meta) || !isJson(meta) || Object.keys(meta).some(key => !/^[A-Za-z0-9_]+$/.test(key))) throw new VaultError({ code: "invalid-meta" });
    const canonical = kind === "vendor" || kind === "custom" ? credentialMeta({ meta, kind, provider }) : meta;
    if (parsers[kind]) {
      const parsed = parsers[kind]({ meta: structuredClone(canonical), provider });
      if (!isObject(parsed) || !isJson(parsed) || Object.keys(parsed).some(key => !/^[A-Za-z0-9_]+$/.test(key))) throw new VaultError({ code: "invalid-meta" });
      return structuredClone(kind === "vendor" || kind === "custom" ? credentialMeta({ meta: parsed, kind, provider }) : parsed);
    }
    for (const [key, value] of Object.entries(canonical)) {
      const field = Object.hasOwn(FIELDS[kind], key) ? FIELDS[kind][key] : undefined;
      if (!field || (value !== null && !(field === "strings" ? Array.isArray(value) && value.every(v => typeof v === "string") :
        field === "object" ? isObject(value) : typeof value === field))) throw new VaultError({ code: "invalid-meta" });
    }
    return structuredClone(canonical);
  }])) as VaultMetaParsers;
}
