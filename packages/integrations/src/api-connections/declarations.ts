import path from 'node:path';

import type { ApiConnectionHooks } from './ports.js';
import { parseConnectionBudgets, type ConnectionBudget } from './budgets.js';

/**
 * @file Pure rules for a plugin's API-connections contribution file: the declaration parser, the
 * hooks module contract and the client-setting namespace check. Loading stays with the host, which
 * runs hooks through its one executable gate and accepts the descriptor only through
 * `parseApiConnectionDescriptor`.
 *
 * Client config is only ever NAMED by the plugin: names must sit in the host's `clientNamespace`
 * (a required host input; there is no default) and, at load, in the full plugin-id namespace, so a
 * plugin can point at its own `…_CLIENT_ID` / `…_CLIENT_SECRET` and never at another secret of the
 * host. Request budgets (`budgets`) are clamped to the host's maxima by `budgets.ts` and never reach
 * the descriptor; nor do `scopeSets`, `apiOrigins` and `byoClient`, which only the host reads.
 */

/** The setting-name part after the host's namespace. */
const CLIENT_ENV_REST_PATTERN = /^[A-Z0-9_]{1,80}_CLIENT_(ID|SECRET)$/;
/** A host's client-setting namespace: upper-case, ending in `_` (for example `ACME_`). */
const CLIENT_NAMESPACE_PATTERN = /^[A-Z][A-Z0-9_]{0,31}_$/;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_CONNECTIONS = 8;
const MAX_ORIGINS = 32;
const MAX_API_ORIGINS = 8;
const MAX_SCOPE_SETS = 16;
/** The scope-set id shape Jini's admin-surface port accepts. */
const SCOPE_SET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Where a runtime's client id (and, for the hosted web client, its secret) is configured. */
export interface ApiConnectionClientConfig {
  readonly clientIdEnv: string;
  readonly clientSecretEnv?: string;
  /** Hosted only: the site origins the shared client has registered callbacks for, added to the host's
   *  configured list (`API_CONNECTION_CALLBACK_ORIGINS_ENV`). Neither: hosted sign-in is refused. */
  readonly redirectOrigins?: readonly string[];
}

/** One `connections[]` entry before the plugin id is known. */
export interface ApiConnectionDeclaration {
  readonly id: string;
  readonly module: string;
  readonly clients: { readonly web?: ApiConnectionClientConfig; readonly desktop?: ApiConnectionClientConfig };
  /** Clamped per-minute budgets the host charges on every token read; always includes an instance budget. */
  readonly budgets: readonly ConnectionBudget[];
  /** The scope-set ids (opaque product-module ids) the plugin offers, so status can report which are granted. */
  readonly scopeSets: readonly string[];
  /** The https origins the plugin's API calls with this connection reach (form delivery's host allowlist). */
  readonly apiOrigins: readonly string[];
  /** True when a workspace admin may sign in with their own OAuth client instead of the host's (`byo-client.ts`). */
  readonly byoClient: boolean;
  /** Passed to `parseApiConnectionDescriptor` with the plugin id at load time. */
  readonly descriptor: Readonly<Record<string, unknown>>;
}

/** What the hooks module default-exports: hooks built over the host's guarded HTTP capability. */
export interface ApiConnectionHooksModule {
  readonly createHooks: (required: { readonly http: unknown }, optional?: Record<string, never>) => ApiConnectionHooks;
}

type ParseResult = { readonly ok: true; readonly descriptors: readonly ApiConnectionDeclaration[] } | { readonly ok: false; readonly reason: string };

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOrigin(value: unknown): boolean {
  return typeof value === 'string' && URL.canParse(value) && new URL(value).origin === value;
}

function isEnvName(value: unknown, suffix: '_ID' | '_SECRET', namespace: string): value is string {
  return typeof value === 'string' && value.startsWith(namespace) && CLIENT_ENV_REST_PATTERN.test(value.slice(namespace.length)) && value.endsWith(suffix);
}

function isOriginList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= MAX_ORIGINS && value.every(isOrigin);
}

/** Both runtime clients, or why one is invalid. @complexity O(o) origins. */
function parseClients(clients: Readonly<Record<string, unknown>>, at: string, namespace: string): ApiConnectionDeclaration['clients'] | string {
  const web = parseClient(clients.web, `${at}.clients.web`, namespace);
  const desktop = parseClient(clients.desktop, `${at}.clients.desktop`, namespace);
  if (typeof web === 'string') return web;
  if (typeof desktop === 'string') return desktop;
  return { ...(web ? { web } : {}), ...(desktop ? { desktop } : {}) };
}

/** One client config, or why it is invalid. @complexity O(o) origins. */
// complexity-debt: four optional fields, each validated in place; splitting further only moves the branches.
function parseClient(value: unknown, at: string, namespace: string): ApiConnectionClientConfig | string | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) return `${at} must be an object`;
  const { clientIdEnv, clientSecretEnv, redirectOrigins } = value;
  if (!isEnvName(clientIdEnv, '_ID', namespace)) return `${at}.clientIdEnv must name a ${namespace}…_CLIENT_ID setting`;
  if (clientSecretEnv !== undefined && !isEnvName(clientSecretEnv, '_SECRET', namespace)) return `${at}.clientSecretEnv must name a ${namespace}…_CLIENT_SECRET setting`;
  if (redirectOrigins !== undefined && !isOriginList(redirectOrigins)) return `${at}.redirectOrigins must be a list of origins`;
  return { clientIdEnv, ...(clientSecretEnv === undefined ? {} : { clientSecretEnv }), ...(redirectOrigins === undefined ? {} : { redirectOrigins }) };
}

function isHttpsOrigin(value: unknown): value is string {
  return isOrigin(value) && new URL(value as string).protocol === 'https:';
}

function isBoundedList(value: unknown, max: number, isItem: (item: unknown) => boolean): value is readonly string[] {
  return Array.isArray(value) && value.length <= max && value.every(isItem);
}

const isScopeSetId = (id: unknown): boolean => typeof id === 'string' && SCOPE_SET_ID_PATTERN.test(id);

/** Optional host-read fields, each bounded; absent lists are empty and an absent `byoClient` is false. @complexity O(n) entries. */
function parseHostLists(scopeSets: unknown, apiOrigins: unknown, byoClient: unknown, at: string): Pick<ApiConnectionDeclaration, 'scopeSets' | 'apiOrigins' | 'byoClient'> | string {
  const sets = scopeSets ?? [];
  const origins = apiOrigins ?? [];
  if (!isBoundedList(sets, MAX_SCOPE_SETS, isScopeSetId)) return `${at}.scopeSets must be at most ${MAX_SCOPE_SETS} short ids`;
  if (!isBoundedList(origins, MAX_API_ORIGINS, isHttpsOrigin)) return `${at}.apiOrigins must be at most ${MAX_API_ORIGINS} https:// origins`;
  if (byoClient !== undefined && typeof byoClient !== 'boolean') return `${at}.byoClient must be true or false`;
  return { scopeSets: [...sets] as string[], apiOrigins: [...origins] as string[], byoClient: byoClient === true };
}

function idOrModuleProblem(id: unknown, module: unknown, at: string): string | undefined {
  if (typeof id !== 'string' || id.length > 64 || !ID_PATTERN.test(id)) return `${at}.id must be a lowercase hyphenated id`;
  if (typeof module !== 'string' || !module.endsWith('.mjs') || path.posix.isAbsolute(module)) return `${at}.module must be a relative path ending in .mjs`;
  return undefined;
}

/**
 * One declaration, or why it is invalid. Either client may name a secret setting: the desktop
 * (installed-app) client stays public even then, because some providers issue installed apps a
 * secret that is not confidential; the host still keeps it in config only, never in output or logs.
 * @complexity O(1).
 */
function parseDeclaration(entry: unknown, at: string, namespace: string): ApiConnectionDeclaration | string {
  if (!isObject(entry)) return `${at} must be an object`;
  const { id, module, clients, budgets: declaredBudgets, scopeSets, apiOrigins, byoClient, ...descriptor } = entry;
  const invalid = idOrModuleProblem(id, module, at);
  if (invalid) return invalid;
  if (!isObject(clients)) return `${at}.clients must be an object`;
  const runtimeClients = parseClients(clients, at, namespace);
  if (typeof runtimeClients === 'string') return runtimeClients;
  const budgets = parseConnectionBudgets({ value: declaredBudgets, at: `${at}.budgets` });
  if (typeof budgets === 'string') return budgets;
  const lists = parseHostLists(scopeSets, apiOrigins, byoClient, at);
  if (typeof lists === 'string') return lists;
  // idOrModuleProblem returned undefined, so both are checked strings.
  return { id: id as string, module: module as string, clients: runtimeClients, budgets, ...lists, descriptor };
}

const INVALID_JSON = Symbol('invalid-json');
function parseJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return INVALID_JSON; }
}

/** A host misconfiguration, not plugin data: refuse it loudly rather than accept every setting name. */
function checkedNamespace(clientNamespace: string): string {
  if (!CLIENT_NAMESPACE_PATTERN.test(clientNamespace)) throw new TypeError('clientNamespace must be upper-case letters, digits and underscores, ending in "_".');
  return clientNamespace;
}

/**
 * Parses a plugin's API-connections file. Pure; unknown keys go to the descriptor parser.
 * `clientNamespace` is the host's client-setting prefix (for example `ACME_`); Jini ships no default.
 * @throws TypeError when `clientNamespace` is malformed (host misconfiguration).
 * @complexity O(c).
 */
// complexity-debt: top-level shape checks plus the per-entry loop and duplicate check.
export function parseApiConnectionsFile(required: { readonly raw: string; readonly clientNamespace: string }, _optional: Record<string, never> = {}): ParseResult {
  const namespace = checkedNamespace(required.clientNamespace);
  const value = parseJson(required.raw);
  if (value === INVALID_JSON) return { ok: false, reason: 'not valid JSON' };
  if (!isObject(value) || value.schemaVersion !== 1) return { ok: false, reason: 'schemaVersion must be 1' };
  if (!Array.isArray(value.connections) || value.connections.length > MAX_CONNECTIONS) return { ok: false, reason: `connections must be an array of at most ${MAX_CONNECTIONS}` };
  const descriptors: ApiConnectionDeclaration[] = [];
  for (const [index, entry] of value.connections.entries()) {
    const result = parseDeclaration(entry, `connections[${index}]`, namespace);
    if (typeof result === 'string') return { ok: false, reason: result };
    if (descriptors.some((seen) => seen.id === result.id)) return { ok: false, reason: `connections[${index}].id '${result.id}' is declared twice` };
    descriptors.push(result);
  }
  return { ok: true, descriptors };
}

/** The hooks module contract: the module itself, or why it is refused. @complexity O(1). */
export function asApiConnectionHooksModule(required: { readonly exported: unknown }, _optional: Record<string, never> = {}): ApiConnectionHooksModule | string {
  const { exported } = required;
  return isObject(exported) && typeof exported.createHooks === 'function' ? exported as unknown as ApiConnectionHooksModule : 'its module has no createHooks() function';
}

/** Refuse another plugin's client config before reading environment or constructing a service.
 * Full ids distinguish plugins sharing a prefix; dots and hyphens have distinct encodings to avoid
 * namespace collisions ("acme.office" vs "acme-office"). O(c) over at most two runtime clients.
 * @throws Error naming the plugin's namespace when a client setting lies outside it.
 */
export function checkApiConnectionClientNamespace(
  required: { readonly pluginId: string; readonly clients: ApiConnectionDeclaration['clients']; readonly clientNamespace: string },
  _optional: Record<string, never> = {},
): void {
  const namespace = `${checkedNamespace(required.clientNamespace)}${required.pluginId.toUpperCase().replaceAll('.', '__').replaceAll('-', '_')}_`;
  for (const [runtime, client] of Object.entries(required.clients)) {
    const prefix = `${namespace}OAUTH_${runtime.toUpperCase()}_CLIENT_`;
    if (client && (client.clientIdEnv !== `${prefix}ID` || (client.clientSecretEnv !== undefined && client.clientSecretEnv !== `${prefix}SECRET`))) {
      throw new Error(`Client settings must belong to this plugin's ${namespace} namespace.`);
    }
  }
}
