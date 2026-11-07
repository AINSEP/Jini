import type { DeployOpsDescriptor, DeployOpsModule } from './ops-contracts.js';

/**
 * @file The pure parser for a plugin's `deploy-ops` contribution file, and the module contract each
 * declared platform's default export must meet. The host reads the file and imports the module
 * through its own activation, digest and containment gates.
 */

type ParseResult = { ok: true; descriptors: DeployOpsDescriptor[] } | { ok: false; reason: string };
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Parse data only. Duplicate ids, URL hosts and escaping paths refuse the entire manifest. O(platforms). */
export function parseDeployOpsFile({ raw }: { readonly raw: string }, _optional: Record<string, never> = {}): ParseResult {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { ok: false, reason: "not valid JSON" }; }
  if (!object(value) || value.schemaVersion !== 1) return { ok: false, reason: "schemaVersion must be 1" };
  if (!Array.isArray(value.platforms) || value.platforms.length > 32) return { ok: false, reason: "platforms must be an array of at most 32 entries" };
  const descriptors: DeployOpsDescriptor[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of value.platforms.entries()) {
    const at = `platforms[${i}]`;
    if (!object(entry)) return { ok: false, reason: `${at} must be an object` };
    const reason = descriptorError({ entry, at, seen }, {});
    if (reason) return { ok: false, reason };
    const { id, label, module, hosts } = entry as unknown as DeployOpsDescriptor;
    seen.add(id); descriptors.push({ id, label, module, hosts });
  }
  return { ok: true, descriptors };
}

/** Lexical containment is checked before the lifecycle loader checks disk containment. */
function containedModule({ module }: { module: unknown }, _optional = {}): boolean {
  if (typeof module !== "string" || !module.endsWith(".mjs")) return false;
  return !module.startsWith("/") && !module.includes("\\") && !module.split("/").some(s => s === ".." || s === "." || !s);
}

function validHosts({ hosts }: { hosts: unknown }, _optional = {}): boolean {
  return Array.isArray(hosts) && hosts.length > 0 && hosts.length <= 8 && hosts.every(host => typeof host === "string" && host.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host));
}

function descriptorError({ entry, at, seen }: { entry: Record<string, unknown>; at: string; seen: Set<string> }, _optional = {}): string | undefined {
  const { id, label, module, hosts } = entry;
  if (typeof id !== "string" || id.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return `${at}.id must be a lowercase hyphenated id`;
  if (seen.has(id)) return `${at}.id '${id}' is declared twice`;
  return descriptorFieldsError({ label, module, hosts, at }, {});
}

function descriptorFieldsError({ label, module, hosts, at }: { label: unknown; module: unknown; hosts: unknown; at: string }, _optional = {}): string | undefined {
  if (typeof label !== "string" || !label.trim() || label.length > 100) return `${at}.label must be a non-empty string`;
  if (!containedModule({ module }, {})) return `${at}.module must be a contained relative .mjs path`;
  if (!validHosts({ hosts }, {})) return `${at}.hosts must be a non-empty array of HTTPS hostnames`;
  return undefined;
}

const OPTIONAL_VERBS = ["listTargets", "deploy", "listSecrets", "setSecret", "unsetSecret", "readSecret"] as const;
const SECRET_VERBS = ["listSecrets", "setSecret", "unsetSecret"] as const;
/** A half secrets adapter would list what it cannot remove (or the reverse), so the verbs and capabilities come as one set. O(1). */
function secretsShapeError(candidate: Record<string, unknown>): string | undefined {
  const present = SECRET_VERBS.filter(verb => candidate[verb] !== undefined);
  if (present.length === 0) return candidate.secretCapabilities !== undefined || candidate.readSecret !== undefined ? "secretCapabilities and readSecret need listSecrets(), setSecret() and unsetSecret()" : undefined;
  if (present.length !== SECRET_VERBS.length) return "a secrets adapter must export listSecrets(), setSecret() and unsetSecret() together";
  const caps = candidate.secretCapabilities;
  if (!object(caps) || !["next-deploy", "vendor-restart", "immediately"].includes(caps.appliesOn as string) || typeof caps.supportsStaging !== "boolean") return "secretCapabilities must declare appliesOn and supportsStaging";
  return undefined;
}

/** Export shape and secrets capabilities remain this domain's contract. @complexity O(1). */
export function asDeployOpsModule({ exported: candidate }: { readonly exported: unknown }, _optional: Record<string, never> = {}): DeployOpsModule | string {
  if (!object(candidate) || typeof candidate.status !== "function" || typeof candidate.logs !== "function" || OPTIONAL_VERBS.some(verb => candidate[verb] !== undefined && typeof candidate[verb] !== "function")) return "module must export status() and logs()";
  const reason = secretsShapeError(candidate);
  return reason ?? (candidate as unknown as DeployOpsModule);
}
