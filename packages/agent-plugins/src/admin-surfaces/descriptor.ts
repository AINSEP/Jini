/**
 * @file Parses a plugin's admin-surface contribution file: which surfaces it ships, the contained
 * files each one serves, the actions it may ask the host to run (with their schemas), the few
 * extra Content-Security-Policy sources it needs and, optionally, the server-side handler module that
 * answers those actions (`./surface-handlers.ts`) with the schema of the bootstrap data it provides
 * and the connections and public config its handlers may use (`./capability-declarations.ts`).
 *
 * Why parsing is strict: everything here is later trusted by the host. A file path that is not a
 * plain relative path, an action schema outside the supported subset, or a CSP source that is not a
 * bare `https://` origin refuses the WHOLE file, so a half-valid declaration never widens what a
 * surface can reach. Containment on disk (symlinks) is the lifecycle's job (`readTrustedPluginFile`);
 * this file only guarantees the declared strings cannot name anything outside the package root.
 */
import { checkAdminSurfaceActionSchema, type AdminSurfaceActionSchema } from './action-schema.js';
import { parseAdminSurfaceCapabilityDeclarations, type AdminSurfaceCapabilityDeclarations } from './capability-declarations.js';

/** The CSP directives a descriptor may extend. Everything else stays at the strict default. */
export const ADMIN_SURFACE_CSP_DIRECTIVES = ['script-src', 'style-src', 'img-src', 'font-src', 'connect-src', 'frame-src'] as const;
export type AdminSurfaceCspDirective = (typeof ADMIN_SURFACE_CSP_DIRECTIVES)[number];

export interface AdminSurfaceAction {
  readonly name: string;
  readonly input: AdminSurfaceActionSchema;
  /** When declared, the dispatcher refuses a handler result that does not conform. */
  readonly result?: AdminSurfaceActionSchema;
}

export interface AdminSurfaceDescriptor extends AdminSurfaceCapabilityDeclarations {
  readonly id: string;
  readonly title: string;
  /** The `.html` document the frame loads, relative to the plugin root. */
  readonly entry: string;
  /** Other files the entry loads (`.mjs`, `.js`, `.css`, `.json`); nothing else is ever served. */
  readonly files: readonly string[];
  readonly actions: readonly AdminSurfaceAction[];
  readonly csp: Readonly<Partial<Record<AdminSurfaceCspDirective, readonly string[]>>>;
  /** A server-side `.mjs` module exporting this surface's action handlers and optional bootstrap
   * provider (`./surface-handlers.ts`). Loaded only through the executable trust gate; never served. */
  readonly handlerModule?: string;
  /** The schema bootstrap data from `handlerModule` must match before it reaches the frame. */
  readonly bootstrap?: AdminSurfaceActionSchema;
  /** Bare https origins the host may open links to for this surface (`./external-links.ts`); present only when declared. */
  readonly linkOrigins?: readonly string[];
  // `connections` and `publicConfig` (./capability-declarations.ts) also need a `handlerModule`.
}

type Parsed<T> = T | string;
type Entry = Readonly<Record<string, unknown>>;

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ID_LENGTH = 64;
const MAX_TITLE_LENGTH = 100;
const MAX_SURFACES = 16;
const MAX_FILES = 32;
const MAX_ACTIONS = 32;
const MAX_SOURCES = 8;
const MAX_LINK_ORIGINS = 8;
const MAX_RAW_BYTES = 64 * 1024;
/** One path segment: no `.`/`..`, no separators, no `%` (no encoded traversal), no leading dot. */
const SEGMENT_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const FILE_EXTENSIONS = ['.mjs', '.js', '.css', '.json'];
/** A bare https origin with a DNS host name: no wildcard, path, query, credentials, IP or scheme keyword. */
const CSP_SOURCE_PATTERN = /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?$/;

function isPlainObject(value: unknown): value is Entry {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const isId = (value: unknown): value is string => typeof value === 'string' && value.length <= MAX_ID_LENGTH && ID_PATTERN.test(value);

/** True when `value` is a relative POSIX path whose every segment is plain and that ends in one of
 * `extensions`. @complexity O(n) in the path length. */
export function isContainedAdminSurfacePath(required: { readonly value: unknown; readonly extensions: readonly string[] }, _optional: Record<string, never> = {}): boolean {
  const { value, extensions } = required;
  if (typeof value !== 'string' || value.length > 200) return false;
  return value.split('/').every((segment) => SEGMENT_PATTERN.test(segment)) && extensions.some((extension) => value.endsWith(extension));
}

/** True when `value` is a CSP source this protocol allows a plugin to add.
 * @complexity O(n) in the source length. */
export function isAllowedAdminSurfaceCspSource(required: { readonly value: unknown }, _optional: Record<string, never> = {}): boolean {
  const { value } = required;
  if (typeof value !== 'string' || !CSP_SOURCE_PATTERN.test(value)) return false;
  // The URL parser normalizes default ports and IDNA forms; anything it rewrites is not a bare origin.
  return new URL(value).origin === value;
}

/**
 * Parses the contribution file. One invalid surface refuses the whole file (the loader reports it).
 * @complexity O(s * (f + a + c)) surfaces with their files, actions and CSP sources; input bounded to 64 KiB.
 */
export function parseAdminSurfacesFile(required: { readonly raw: string }, _optional: Record<string, never> = {}): { readonly ok: true; readonly descriptors: readonly AdminSurfaceDescriptor[] } | { readonly ok: false; readonly reason: string } {
  if (required.raw.length > MAX_RAW_BYTES) return { ok: false, reason: 'larger than 64 KiB' };
  let value: unknown;
  try { value = JSON.parse(required.raw); } catch { return { ok: false, reason: 'not valid JSON' }; }
  if (!isPlainObject(value) || value.schemaVersion !== 1) return { ok: false, reason: 'schemaVersion must be 1' };
  const descriptors = parseSurfaces(value.surfaces);
  return typeof descriptors === 'string' ? { ok: false, reason: descriptors } : { ok: true, descriptors };
}

function parseSurfaces(surfaces: unknown): Parsed<readonly AdminSurfaceDescriptor[]> {
  if (!Array.isArray(surfaces) || surfaces.length > MAX_SURFACES) return `surfaces must be an array of at most ${MAX_SURFACES}`;
  const descriptors: AdminSurfaceDescriptor[] = [];
  for (const [index, entry] of surfaces.entries()) {
    const parsed = parseSurface(entry, `surfaces[${index}]`);
    if (typeof parsed === 'string') return parsed;
    if (descriptors.some((seen) => seen.id === parsed.id)) return `surfaces[${index}].id '${parsed.id}' is declared twice`;
    descriptors.push(parsed);
  }
  return descriptors;
}

function parseSurface(entry: unknown, at: string): Parsed<AdminSurfaceDescriptor> {
  if (!isPlainObject(entry)) return `${at} must be an object`;
  const identity = parseIdentity(entry, at);
  if (typeof identity === 'string') return identity;
  const files = parseFiles(entry.files ?? [], at);
  if (typeof files === 'string') return files;
  const actions = parseActions(entry.actions ?? [], at);
  if (typeof actions === 'string') return actions;
  return parseSurfaceExtras(entry, { ...identity, files, actions }, at);
}

/** The CSP extensions, the optional link origins and the optional handler fields, after the core fields parsed. */
function parseSurfaceExtras(entry: Entry, surface: Omit<AdminSurfaceDescriptor, 'csp'>, at: string): Parsed<AdminSurfaceDescriptor> {
  const csp = parseCsp(entry.csp ?? {}, at);
  if (typeof csp === 'string') return csp;
  const linkOrigins = entry.linkOrigins === undefined ? undefined : parseLinkOrigins(entry.linkOrigins, `${at}.linkOrigins`);
  if (typeof linkOrigins === 'string') return linkOrigins;
  const handler = parseHandler(entry, surface, at);
  return typeof handler === 'string' ? handler : { ...surface, csp, ...(linkOrigins && { linkOrigins }), ...handler };
}

/** At most 8 unique bare https origins, by the CSP source rule: a link the host opens leaves the sandbox. */
function parseLinkOrigins(value: unknown, at: string): Parsed<readonly string[]> {
  if (!Array.isArray(value) || value.length > MAX_LINK_ORIGINS) return `${at} must be an array of at most ${MAX_LINK_ORIGINS}`;
  const bad = value.findIndex((origin, index) => !isAllowedAdminSurfaceCspSource({ value: origin }) || value.indexOf(origin) !== index);
  return bad === -1 ? (value as string[]) : `${at}[${bad}] must be a unique bare https origin (no wildcards, paths or keywords)`;
}

/**
 * The optional server-side handler fields. A handler module is plugin code running in the server, so
 * it may not also be served to the frame, and every action it answers must declare a `result`: unlike
 * a host handler, plugin code is not trusted to shape what reaches the frame.
 */
type HandlerFields = Pick<AdminSurfaceDescriptor, 'handlerModule' | 'bootstrap' | 'connections' | 'publicConfig'>;

function parseHandler(entry: Entry, surface: Pick<AdminSurfaceDescriptor, 'files' | 'actions'>, at: string): Parsed<HandlerFields> {
  const { handlerModule } = entry;
  if (handlerModule === undefined) return handlerOnlyFieldRefusal(entry, at) ?? {};
  if (!isContainedAdminSurfacePath({ value: handlerModule, extensions: ['.mjs'] })) return `${at}.handlerModule must be a plain relative path ending in .mjs`;
  if (surface.files.includes(handlerModule as string)) return `${at}.handlerModule is server code and may not also be served to the frame`;
  const unchecked = surface.actions.findIndex((action) => action.result === undefined);
  if (unchecked !== -1) return `${at}.actions[${unchecked}] must declare a result schema when the surface has a handlerModule`;
  const declarations = parseAdminSurfaceCapabilityDeclarations({ entry, at });
  if (typeof declarations === 'string') return declarations;
  const handler = parseBootstrap(entry.bootstrap, handlerModule as string, at);
  return typeof handler === 'string' ? handler : { ...handler, ...declarations };
}

/** Fields only a handler module can use; without one they would be dead declarations. */
function handlerOnlyFieldRefusal(entry: Entry, at: string): string | null {
  if (entry.bootstrap !== undefined) return `${at}.bootstrap needs a handlerModule that provides it`;
  const declared = ['connections', 'publicConfig'].find((name) => entry[name] !== undefined);
  return declared === undefined ? null : `${at}.${declared} needs a handlerModule that uses it`;
}

function parseBootstrap(bootstrap: unknown, handlerModule: string, at: string): Parsed<Pick<AdminSurfaceDescriptor, 'handlerModule' | 'bootstrap'>> {
  if (bootstrap === undefined) return { handlerModule };
  const reason = checkAdminSurfaceActionSchema({ schema: bootstrap });
  return reason === null ? { handlerModule, bootstrap: bootstrap as AdminSurfaceActionSchema } : `${at}.bootstrap ${reason}`;
}

function parseIdentity(entry: Entry, at: string): Parsed<Pick<AdminSurfaceDescriptor, 'id' | 'title' | 'entry'>> {
  const { id, title, entry: html } = entry;
  if (!isId(id)) return `${at}.id must be a lowercase hyphenated id`;
  if (typeof title !== 'string' || !title.trim() || title.length > MAX_TITLE_LENGTH) return `${at}.title must be a non-empty string of at most ${MAX_TITLE_LENGTH} characters`;
  if (!isContainedAdminSurfacePath({ value: html, extensions: ['.html'] })) return `${at}.entry must be a plain relative path ending in .html`;
  return { id, title, entry: html as string };
}

function parseFiles(value: unknown, at: string): Parsed<readonly string[]> {
  if (!Array.isArray(value) || value.length > MAX_FILES) return `${at}.files must be an array of at most ${MAX_FILES}`;
  const bad = value.findIndex((file) => !isContainedAdminSurfacePath({ value: file, extensions: FILE_EXTENSIONS }));
  return bad === -1 ? (value as string[]) : `${at}.files[${bad}] must be a plain relative path ending in ${FILE_EXTENSIONS.join(', ')}`;
}

function parseActions(value: unknown, at: string): Parsed<readonly AdminSurfaceAction[]> {
  if (!Array.isArray(value) || value.length > MAX_ACTIONS) return `${at}.actions must be an array of at most ${MAX_ACTIONS}`;
  const actions: AdminSurfaceAction[] = [];
  for (const [index, action] of value.entries()) {
    const parsed = parseAction(action, `${at}.actions[${index}]`);
    if (typeof parsed === 'string') return parsed;
    if (actions.some((seen) => seen.name === parsed.name)) return `${at}.actions[${index}].name '${parsed.name}' is declared twice`;
    actions.push(parsed);
  }
  return actions;
}

function parseAction(action: unknown, at: string): Parsed<AdminSurfaceAction> {
  if (!isPlainObject(action)) return `${at} must be an object`;
  if (!isId(action.name)) return `${at}.name must be a lowercase hyphenated id`;
  const input = checkAdminSurfaceActionSchema({ schema: action.input });
  if (input !== null) return `${at}.input ${input}`;
  if (action.result === undefined) return { name: action.name, input: action.input as AdminSurfaceActionSchema };
  const result = checkAdminSurfaceActionSchema({ schema: action.result });
  if (result !== null) return `${at}.result ${result}`;
  return { name: action.name, input: action.input as AdminSurfaceActionSchema, result: action.result as AdminSurfaceActionSchema };
}

function parseCsp(value: unknown, at: string): Parsed<AdminSurfaceDescriptor['csp']> {
  if (!isPlainObject(value)) return `${at}.csp must be an object`;
  for (const [directive, sources] of Object.entries(value)) {
    if (!(ADMIN_SURFACE_CSP_DIRECTIVES as readonly string[]).includes(directive)) return `${at}.csp may not extend '${directive.slice(0, 32)}'`;
    if (!Array.isArray(sources) || sources.length > MAX_SOURCES) return `${at}.csp['${directive}'] must be an array of at most ${MAX_SOURCES}`;
    if (!sources.every((source) => isAllowedAdminSurfaceCspSource({ value: source }))) return `${at}.csp['${directive}'] may only list bare https origins (no wildcards, paths or keywords)`;
  }
  return value as AdminSurfaceDescriptor['csp'];
}
