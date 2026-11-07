/**
 * @file The pure half of the object-stores Agent Plugin contribution: the descriptor parser and the
 * operator env declarations a provider may carry. The host names the file and loads each module
 * through its lifecycle, validating it with `objectStoreProviderFault` from `@jini-ai/core/object-store`.
 */
import path from "node:path";

const MAX_LABEL_LENGTH = 100;

export interface ObjectStoreEnvDeclaration {
  readonly providerId: string;
  readonly selector: string;
  readonly settings: Readonly<Record<string, string>>;
  readonly credentialFields: Readonly<Record<string, string>>;
  readonly secret: string;
  readonly required: readonly string[];
}
/** One provider entry; structurally the lifecycle's provider-contribution descriptor plus `env`. */
export interface ObjectStoreDescriptor {
  readonly id: string;
  /** Plain-JS module inside the plugin root (`.mjs`); containment is checked on disk at import. */
  readonly module: string;
  readonly label?: string;
  readonly env?: Omit<ObjectStoreEnvDeclaration, "providerId">;
}

export type ObjectStoresParseResult = { readonly ok: true; readonly descriptors: readonly ObjectStoreDescriptor[] } | { readonly ok: false; readonly reason: string };

/**
 * Parses a plugin's object-stores file: `{ schemaVersion: 1, providers: [{ id, module, label? }] }`. Ids
 * are checked against the shared grammar by the loader before any module is imported.
 * @complexity O(n) entries.
 */
export function parseObjectStoresFile(required: { readonly raw: string }, _optional: Record<string, never> = {}): ObjectStoresParseResult {
  let value: unknown;
  try {
    value = JSON.parse(required.raw);
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  if (!isPlainObject(value) || value.schemaVersion !== 1) return { ok: false, reason: "schemaVersion must be 1" };
  if (!Array.isArray(value.providers)) return { ok: false, reason: "providers must be an array" };
  const descriptors: ObjectStoreDescriptor[] = [];
  for (const [index, entry] of value.providers.entries()) {
    const result = parseDescriptor({ entry, at: `providers[${index}]` });
    if (typeof result === "string") return { ok: false, reason: result };
    if (descriptors.some((seen) => seen.id === result.id)) return { ok: false, reason: `providers[${index}].id '${result.id}' is declared twice` };
    descriptors.push(result);
  }
  return { ok: true, descriptors };
}

/** One manifest entry, or why it is malformed. @complexity O(1). */
function parseDescriptor({ entry, at }: { entry: unknown; at: string }, _optional = {}): ObjectStoreDescriptor | string {
  if (!isPlainObject(entry)) return `${at} must be an object`;
  const { id, label, module } = entry;
  if (typeof id !== "string") return `${at}.id must be a string`;
  if (typeof module !== "string" || !module.endsWith(".mjs") || path.posix.isAbsolute(module)) return `${at}.module must be a relative path ending in .mjs`;
  const extra = descriptorMetadata({ label, env: entry.env, at });
  if (typeof extra === "string") return extra;
  return { id, module, ...extra };
}

/** Optional metadata shares the provider declaration's validation and refusal policy. */
function descriptorMetadata({ label, env, at }: { label: unknown; env: unknown; at: string }, _optional = {}): Pick<ObjectStoreDescriptor, "label" | "env"> | string {
  if (label !== undefined && (typeof label !== "string" || label.trim() === "" || label.length > MAX_LABEL_LENGTH)) return `${at}.label must be a non-empty string of at most ${MAX_LABEL_LENGTH} characters`;
  if (env !== undefined && !validEnvDeclaration({ value: env })) return `${at}.env must declare a selector, env maps, secret and ordered required variables`;
  return { ...(label === undefined ? {} : { label: label as string }), ...(env === undefined ? {} : { env: env as NonNullable<ObjectStoreDescriptor["env"]> }) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function envMap(value: unknown): value is Readonly<Record<string, string>> {
  return isPlainObject(value) && Object.values(value).every(envName);
}
function envName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]*$/.test(value);
}
function envSelector(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]*$/.test(value) && value !== "local";
}
function validEnvDeclaration({ value }: { value: unknown }, _optional = {}): boolean {
  if (!isPlainObject(value)) return false;
  if (!envSelector(value.selector)) return false;
  if (!envMap(value.settings) || !envMap(value.credentialFields) || !envName(value.secret)) return false;
  return Array.isArray(value.required) && value.required.length > 0 && value.required.every(envName);
}

