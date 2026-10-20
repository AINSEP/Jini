/**
 * @file Parses the two capability declarations a surface with a `handlerModule` may make: which of
 * the plugin's own connections its handlers administer (with the per-start parameters and callback
 * fields each may use), and which public configuration values the host may hand its handlers.
 *
 * Why they are declared, not requested at run time: the surfaces file is part of the shipped,
 * digest-checked package, so these lists are the trusted allowlists the admin-surface capability
 * session (`./surface-capabilities.ts`) enforces. A handler can never reach a connection, a start
 * parameter, a callback field or a config value its surface did not declare. Config names that look
 * like secrets are refused here, so a secret can never become "public config" by a naming slip.
 */

/** One connection a surface's handlers may administer. `id` is the plugin's own connection id, never a ref. */
export interface AdminSurfaceConnectionDeclaration {
  readonly id: string;
  /** Authorization parameters a handler may set for one sign-in (the connection must also allow them). */
  readonly startParams: readonly string[];
  /** Provider callback fields a handler may take once after a completed sign-in. */
  readonly callbackFields: readonly string[];
}

export interface AdminSurfaceCapabilityDeclarations {
  readonly connections?: readonly AdminSurfaceConnectionDeclaration[];
  readonly publicConfig?: readonly string[];
}

type Entry = Readonly<Record<string, unknown>>;

/** Same shapes the API-connection descriptor accepts for connection ids and parameter names. */
const CONNECTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const FIELD_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
/**
 * Copy of the OAuth core's `isCallbackFieldName` pattern (`@jini-ai/oauth` loopback-callback.ts is
 * the source of truth; agent-plugins does not depend on it). The descriptor applies the full check,
 * including the reserved protocol names, so a field passing here but reserved there is never declared.
 */
const CALLBACK_FIELD_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
/** Environment-style names, so a host can map them to its own config without translation. */
const CONFIG_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
/** Name parts that mark a credential. A plugin's public values never need one of them. */
const SECRET_NAME_PATTERN = /SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|COOKIE|SESSION|SIGNING/;
const MAX_CONNECTIONS = 4;
const MAX_FIELDS = 8;
const MAX_CONFIG_NAMES = 16;

const isPlainObject = (value: unknown): value is Entry => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A bounded, de-duplicated list of names matching `pattern`, or why not. @complexity O(n) names. */
function parseNames(value: unknown, required: { readonly pattern: RegExp; readonly max: number; readonly at: string }): readonly string[] | string {
  const { pattern, max, at } = required;
  if (!Array.isArray(value) || value.length > max) return `${at} must be an array of at most ${max}`;
  const bad = value.findIndex((name, index) => typeof name !== 'string' || !pattern.test(name) || value.indexOf(name) !== index);
  return bad === -1 ? (value as string[]) : `${at}[${bad}] must be a unique name matching ${pattern.source}`;
}

function parseConnection(entry: unknown, at: string): AdminSurfaceConnectionDeclaration | string {
  if (!isPlainObject(entry)) return `${at} must be an object`;
  if (typeof entry.id !== 'string' || !CONNECTION_ID_PATTERN.test(entry.id)) return `${at}.id must be a short connection id`;
  const startParams = parseNames(entry.startParams ?? [], { pattern: FIELD_NAME_PATTERN, max: MAX_FIELDS, at: `${at}.startParams` });
  if (typeof startParams === 'string') return startParams;
  const callbackFields = parseNames(entry.callbackFields ?? [], { pattern: CALLBACK_FIELD_NAME_PATTERN, max: MAX_FIELDS, at: `${at}.callbackFields` });
  return typeof callbackFields === 'string' ? callbackFields : { id: entry.id, startParams, callbackFields };
}

function parseConnections(value: unknown, at: string): readonly AdminSurfaceConnectionDeclaration[] | string {
  if (!Array.isArray(value) || value.length > MAX_CONNECTIONS) return `${at} must be an array of at most ${MAX_CONNECTIONS}`;
  const connections: AdminSurfaceConnectionDeclaration[] = [];
  for (const [index, entry] of value.entries()) {
    const parsed = parseConnection(entry, `${at}[${index}]`);
    if (typeof parsed === 'string') return parsed;
    if (connections.some((seen) => seen.id === parsed.id)) return `${at}[${index}].id '${parsed.id}' is declared twice`;
    connections.push(parsed);
  }
  return connections;
}

function parsePublicConfig(value: unknown, at: string): readonly string[] | string {
  const names = parseNames(value, { pattern: CONFIG_NAME_PATTERN, max: MAX_CONFIG_NAMES, at });
  if (typeof names === 'string') return names;
  const secret = names.findIndex((name) => SECRET_NAME_PATTERN.test(name));
  return secret === -1 ? names : `${at}[${secret}] names a secret; public config may only hold values that are safe to show`;
}

/**
 * The surface's capability declarations, with keys present only when declared (an undeclared list
 * adds no key, so existing descriptors parse unchanged), or why the file is refused.
 * @complexity O(c * f + n) connections with their fields plus config names; every list is capped.
 */
export function parseAdminSurfaceCapabilityDeclarations(required: { readonly entry: Entry; readonly at: string }, _optional: Record<string, never> = {}): AdminSurfaceCapabilityDeclarations | string {
  const { entry, at } = required;
  const connections = entry.connections === undefined ? undefined : parseConnections(entry.connections, `${at}.connections`);
  if (typeof connections === 'string') return connections;
  const publicConfig = entry.publicConfig === undefined ? undefined : parsePublicConfig(entry.publicConfig, `${at}.publicConfig`);
  if (typeof publicConfig === 'string') return publicConfig;
  return { ...(connections && { connections }), ...(publicConfig && { publicConfig }) };
}
