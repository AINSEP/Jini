import { VAULT_KINDS, VaultError, type VaultJson, type VaultKind, type VaultMeta, type VaultMetaParser, type VaultMetaParsers, type VaultOptions } from "./vault.types.js";
import { normalizeCredentialWorksFor } from "./provider-matches.js";

/** Copy eligibility lives with the kind contracts; MCP rows require their server configuration. */
export const isCopyableKind: Readonly<Record<VaultKind, boolean>> = Object.freeze({
  "site-assistant": true, "personal-execution": false, "media-provider": true, custom: false,
  "publish-peer": true, "database-destination": true, vendor: true, "source-control": true,
  "mcp-env": false, "mcp-auth": false,
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

type CredentialKind = "vendor" | "custom";
type ParseInput = { meta: unknown; provider?: string | null | undefined };

/** Enforce common credential metadata before and after optional host policy parsing.
 * Missing fields on pre-unification rows are read defaults, never a reason to rewrite/reseal.
 * Explicit empty compatibility is preserved; labels never imply compatibility.
 * @throws VaultError when a supplied subtype or compatibility list is invalid.
 * @complexity O(worksFor characters); returns a fresh metadata object.
 */
function credentialMeta({ meta, kind, provider }: { meta: VaultMeta; kind: CredentialKind; provider?: string | null | undefined }): VaultMeta {
  const credentialType = meta.credentialType === undefined ? kind : meta.credentialType;
  if ((credentialType !== "vendor" && credentialType !== "custom") || (kind === "custom" && credentialType !== "custom")) throw new VaultError({ code: "invalid-meta" });
  const worksFor = meta.worksFor === undefined ? (credentialType === "vendor" && provider != null ? [provider] : []) : meta.worksFor;
  return { ...meta, credentialType, worksFor: normalizeCredentialWorksFor({ value: worksFor }) };
}

/** Plain JSON object with identifier-only top-level keys; checked on input and on override output. */
function requireMetaShape({ value }: { value: unknown }): VaultMeta {
  if (!isObject(value) || !isJson(value) || Object.keys(value).some(key => !/^[A-Za-z0-9_]+$/.test(key))) throw new VaultError({ code: "invalid-meta" });
  return value;
}

/** vendor/custom rows carry the unified subtype + compatibility contract; other kinds pass through. */
function canonicalMeta({ meta, kind, provider }: { meta: VaultMeta; kind: VaultKind; provider?: string | null | undefined }): VaultMeta {
  return kind === "vendor" || kind === "custom" ? credentialMeta({ meta, kind, provider }) : meta;
}

function matchesField({ field, value }: { field: Field; value: VaultJson }): boolean {
  if (value === null) return true;
  if (field === "strings") return Array.isArray(value) && value.every(v => typeof v === "string");
  if (field === "object") return isObject(value);
  return typeof value === field;
}

function assertDeclaredFields({ meta, kind }: { meta: VaultMeta; kind: VaultKind }): void {
  for (const [key, value] of Object.entries(meta)) {
    const field = Object.hasOwn(FIELDS[kind], key) ? FIELDS[kind][key] : undefined;
    if (!field || !matchesField({ field, value })) throw new VaultError({ code: "invalid-meta" });
  }
}

function parseKindMeta({ kind, override }: { kind: VaultKind; override: VaultMetaParser | undefined }, { meta, provider }: ParseInput): VaultMeta {
  const canonical = canonicalMeta({ meta: requireMetaShape({ value: meta }), kind, provider });
  if (override) {
    const parsed = requireMetaShape({ value: override({ meta: structuredClone(canonical), provider }) });
    return structuredClone(canonicalMeta({ meta: parsed, kind, provider }));
  }
  assertDeclaredFields({ meta: canonical, kind });
  return structuredClone(canonical);
}

/** Minimal structural parsers. Hosts inject catalog, URL/origin and safe-metadata policy here;
 * secrets stay in payload JSON. Overrides own the complete shape, including merged patches.
 */
export function createVaultMetaParsers(
  _required: VaultOptions,
  { parsers = {} }: { parsers?: Partial<VaultMetaParsers> } = {},
): VaultMetaParsers {
  return Object.fromEntries([...VAULT_KINDS, "custom" as const].map(kind =>
    [kind, (input: ParseInput) => parseKindMeta({ kind, override: parsers[kind] }, input)])) as VaultMetaParsers;
}
