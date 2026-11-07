import type { MailProviderField, MailProviderSetup } from "./engine-contracts.js";

/**
 * @file The declarative setup metadata a mail plugin may ship in its mail-adapters file's v2
 * descriptor (`setup: { helpUrl?, fields?: [...] }`): field labels, input types, non-secret
 * defaults (an API origin, a preset server endpoint) and help links. Core renders whatever the
 * plugin declares and never branches on a provider id — a vendor's know-how ships in its plugin.
 *
 * Absent `setup` (every descriptor written before 2026-10-22), {@link defaultMailProviderSetup}
 * derives plain fields from `credentialKeys`, so an older plugin still gets a usable form.
 */

const FIELD_TYPES = ["secret", "text", "url", "email"] as const;
const MAX_TEXT = 300;

/** The generic field each credential key gets when the plugin declares nothing more specific. */
const DEFAULT_FIELDS: Readonly<Record<string, MailProviderField>> = {
  token: { key: "token", label: "API key", type: "secret", required: true },
  username: { key: "username", label: "Username", type: "text", required: true },
  baseUrl: { key: "baseUrl", label: "API base URL", type: "url", required: true },
};

/**
 * Plain fields for each declared credential key, plus `baseUrl`: the credential store files every
 * key under an origin, so the form always asks for one. An unknown key becomes a required text field.
 * @complexity O(k) keys.
 */
export function defaultMailProviderSetup(required: { credentialKeys: readonly string[] }, _optional: Record<string, never> = {}): MailProviderSetup {
  return { fields: storedKeys(required.credentialKeys).map((key) => DEFAULT_FIELDS[key] ?? { key, label: key, type: "text", required: true }) };
}

/** The credential keys a saved key actually has: the declared ones plus `baseUrl`. @complexity O(k). */
function storedKeys(credentialKeys: readonly string[], _options: Record<string, never> = {}): string[] {
  return [...new Set([...credentialKeys, "baseUrl"])];
}

/**
 * Parses a descriptor's optional `setup`. Pure. `undefined` stays undefined (use the default).
 * A field's `key` must be one of the provider's credential keys or `baseUrl` (always stored), and
 * `token` must be a secret field, so a plugin cannot turn the key input into plain text.
 * @returns The setup, or the reason it is invalid (the whole descriptor is then refused).
 * @complexity O(f) fields.
 */
export function parseMailProviderSetup(required: { value: unknown; at: string; credentialKeys: readonly string[] }, _optional: Record<string, never> = {}): MailProviderSetup | string | undefined {
  const { value, at } = required;
  if (value === undefined) return undefined;
  if (!isRecord(value)) return `${at}.setup must be an object`;
  const helpUrl = optionalHttpsUrl({ value: value.helpUrl });
  if (helpUrl === null) return `${at}.setup.helpUrl must be an https URL`;
  const fields = parseFields({ value: value.fields ?? [], at, allowed: new Set(storedKeys(required.credentialKeys)) });
  if (typeof fields === "string") return fields;
  const declared = new Set(fields.map((field) => field.key));
  // Undeclared keys keep their plain default field, so a partial `setup` never drops an input.
  const missing = defaultMailProviderSetup({ credentialKeys: required.credentialKeys }).fields.filter((field) => !declared.has(field.key));
  return { fields: [...fields, ...missing], ...(helpUrl ? { helpUrl } : {}) };
}

/** The declared fields in order, or why one is invalid. @complexity O(f^2) for tiny f. */
function parseFields(required: { value: unknown; at: string; allowed: ReadonlySet<string> }, _options: Record<string, never> = {}): MailProviderField[] | string {
  const { value, at } = required;
  if (!Array.isArray(value)) return `${at}.setup.fields must be an array`;
  const fields: MailProviderField[] = [];
  for (const [index, entry] of value.entries()) {
    const field = parseField({ entry, at: `${at}.setup.fields[${index}]`, allowed: required.allowed });
    if (typeof field === "string") return field;
    if (fields.some((seen) => seen.key === field.key)) return `${at}.setup.fields[${index}].key '${field.key}' is declared twice`;
    fields.push(field);
  }
  return fields;
}

/**
 * The descriptor property form of {@link parseMailProviderSetup}: `{}` when absent, `{setup}` when
 * valid, else the reason. @complexity O(f) fields.
 */
export function parseMailProviderSetupProperty(required: { value: unknown; at: string; credentialKeys: readonly string[] }, _optional: Record<string, never> = {}): { setup?: MailProviderSetup } | string {
  const setup = parseMailProviderSetup(required);
  if (typeof setup === "string") return setup;
  return setup ? { setup } : {};
}

/** One field entry, or why it is invalid. @complexity O(1). */
function parseField(required: { entry: unknown; at: string; allowed: ReadonlySet<string> }, _options: Record<string, never> = {}): MailProviderField | string {
  const { entry, at } = required;
  if (!isRecord(entry)) return `${at} must be an object`;
  const head = parseFieldHead({ entry, at, allowed: required.allowed });
  if (typeof head === "string") return head;
  const text = optionalTexts(entry, ["defaultValue", "placeholder", "help"]);
  if (typeof text === "string") return `${at}.${text} must be a non-empty string`;
  const helpUrl = optionalHttpsUrl({ value: entry.helpUrl });
  if (helpUrl === null) return `${at}.helpUrl must be an https URL`;
  // A secret has no default: a default would be a secret shipped in a public plugin manifest.
  if (head.type === "secret" && text.defaultValue !== undefined) return `${at}.defaultValue is not allowed on a secret field`;
  return { ...head, required: entry.required !== false, ...text, ...(helpUrl ? { helpUrl } : {}) };
}

/** A field's key, label and type, or why they are invalid. @complexity O(1). */
function parseFieldHead(required: { entry: Readonly<Record<string, unknown>>; at: string; allowed: ReadonlySet<string> }, _options: Record<string, never> = {}): Pick<MailProviderField, "key" | "label" | "type"> | string {
  const { entry, at } = required;
  if (typeof entry.key !== "string" || !required.allowed.has(entry.key)) return `${at}.key must be one of the provider's credential keys or baseUrl`;
  if (!isText(entry.label)) return `${at}.label must be a non-empty string`;
  const type = entry.type ?? "text";
  if (!FIELD_TYPES.includes(type as MailProviderField["type"])) return `${at}.type must be one of ${FIELD_TYPES.join(", ")}`;
  if (entry.key === "token" && type !== "secret") return `${at}: the token field must be type secret`;
  return { key: entry.key, label: entry.label.trim(), type: type as MailProviderField["type"] };
}

type OptionalTextName = "defaultValue" | "placeholder" | "help";

/** The present optional strings, or the name of the first malformed one. @complexity O(n) names. */
function optionalTexts(entry: Readonly<Record<string, unknown>>, names: readonly OptionalTextName[]): Partial<Record<OptionalTextName, string>> | string {
  const out: Partial<Record<OptionalTextName, string>> = {};
  for (const name of names) {
    if (entry[name] === undefined) continue;
    if (!isText(entry[name])) return name;
    out[name] = (entry[name] as string).trim();
  }
  return out;
}

/** undefined when absent, null when malformed, else the URL. @complexity O(1). */
function optionalHttpsUrl({ value }: { value: unknown }, _options: Record<string, never> = {}): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= MAX_TEXT;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
