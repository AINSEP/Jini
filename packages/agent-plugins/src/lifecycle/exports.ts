/** Declarative public-page exports. Parsing grants no trust and never reads plugin files. */
import { validatePluginIdentity } from '@jini-ai/core/plugin-directory';
import {
  checkAdminSurfaceActionSchema, exceedsAdminSurfacePayloadLimit, validateAdminSurfaceActionValue,
  type AdminSurfaceActionSchema,
} from '../admin-surfaces/action-schema.js';

/** Matches the CMS consent vocabulary without introducing a dependency on CMS. */
export type AgentPluginExportConsent = 'necessary' | 'functional' | 'analytics' | 'marketing';
export type AgentPluginExportStaticMode = 'full' | 'link-only' | 'fallback-only';
export interface AgentPluginExport {
  readonly template: string;
  readonly props: Extract<AdminSurfaceActionSchema, { type: 'object' }>;
  readonly consent: AgentPluginExportConsent;
  readonly staticExport: AgentPluginExportStaticMode;
  readonly version: number;
  /** Omitted means version 1; hosts accept minVersion <= marker version <= version. */
  readonly minVersion?: number;
  readonly aliases?: readonly string[];
  /** Slot name -> capability declared by this same plugin's provides list. */
  readonly hostLinks?: Readonly<Record<string, string>>;
  readonly styles?: string;
  readonly assets?: Readonly<Record<string, string>>;
}
export interface AgentPluginExportMetadata {
  readonly exports?: Readonly<Record<string, AgentPluginExport>>;
  /** Explicit publisher-qualified old identities; admission and ambiguity are host decisions. */
  readonly renamedFrom?: readonly string[];
}
export type ParseAgentPluginExportsResult =
  | { readonly ok: true; readonly metadata: AgentPluginExportMetadata; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly errors: readonly string[] };

type Entry = Readonly<Record<string, unknown>>;
const KNOWN_KEYS = new Set(['template', 'props', 'consent', 'staticExport', 'version', 'minVersion', 'aliases', 'hostLinks', 'styles', 'assets']);
const isObject = (value: unknown): value is Entry => typeof value === 'object' && value !== null && !Array.isArray(value);
const isName = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value);
const isVersion = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1;
const isNames = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every(isName);

/** Export declarations use portable paths without admin-surface file caps. Importing that
 * descriptor here would cycle through its tool/lifecycle types. Actual disk/symlink containment
 * remains exclusively with readTrustedPluginFile; this is only the declaration grammar. */
function isExportFile({ value, extension }: { readonly value: unknown; readonly extension: readonly string[] }, _optional = {}): boolean {
  return typeof value === 'string' && /^(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(value)
    && extension.some(suffix => value.endsWith(suffix));
}

/** Reuse the identity owner's grammar, including its reserved-publisher rule. */
function isPluginId(value: unknown): value is string {
  return typeof value === 'string' && validatePluginIdentity({ manifest: { extensions: { export: { id: value } } }, namespace: 'export' }).errors.length === 0;
}

/** Optional maps retain only declared values; fromEntries also handles prototype-named keys safely. */
function checkMap({ value, valid }: { readonly value: unknown; readonly valid: (value: unknown) => boolean }, _optional = {}): boolean {
  return value === undefined || (isObject(value) && Object.entries(value).every(([key, item]) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(key) && valid(item)));
}

function checkVersions({ entry }: { readonly entry: Entry }, _optional = {}): string | null {
  if (!isVersion(entry.version)) return 'version must be a positive safe integer';
  if (entry.minVersion === undefined) return null;
  return isVersion(entry.minVersion) && entry.minVersion <= entry.version ? null : 'minVersion must be between 1 and version';
}

function checkFiles({ entry }: { readonly entry: Entry }, _optional = {}): string | null {
  if (!isExportFile({ value: entry.template, extension: ['.html'] })) return 'template must be a contained .html path';
  if (entry.styles !== undefined && !isExportFile({ value: entry.styles, extension: ['.css'] })) return 'styles must be a contained .css path';
  const validAsset = (value: unknown) => isExportFile({ value, extension: ['.png', '.svg'] });
  return checkMap({ value: entry.assets, valid: validAsset }) ? null : 'assets must map names to contained .png or .svg paths';
}

function checkContract({ entry, provides }: { readonly entry: Entry; readonly provides: readonly string[] }, _optional = {}): string | null {
  if (!['necessary', 'functional', 'analytics', 'marketing'].includes(entry.consent as string)) return 'consent must name a consent category';
  if (!['full', 'link-only', 'fallback-only'].includes(entry.staticExport as string)) return 'staticExport must be full, link-only or fallback-only';
  if (entry.aliases !== undefined && !isNames(entry.aliases)) return 'aliases must be an array of component names';
  if (!checkMap({ value: entry.hostLinks, valid: value => typeof value === 'string' && provides.includes(value) })) return 'hostLinks must name capabilities this plugin provides';
  const reason = checkAdminSurfaceActionSchema({ schema: entry.props });
  if (reason !== null) return `props ${reason}`;
  return (entry.props as AdminSurfaceActionSchema).type === 'object' ? null : 'props must declare an object schema';
}

/** Parses one namespace's exports; invalid known fields refuse the contract, unknown keys warn.
 * File contents, trust admission, rename ambiguity and rendering remain host responsibilities.
 * @returns Validated metadata or errors, without I/O. @complexity O(e + s + a) export, schema and alias entries.
 */
export function parseAgentPluginExports(
  { extension, provides }: { readonly extension: Entry; readonly provides: readonly string[] },
  _optional: Record<string, never> = {},
): ParseAgentPluginExportsResult {
  const renamedFrom = extension.renamedFrom;
  if (renamedFrom !== undefined && !(Array.isArray(renamedFrom) && renamedFrom.every(isPluginId))) return { ok: false, errors: ['renamedFrom must be an array of publisher-qualified plugin ids'] };
  const metadata = renamedFrom === undefined ? {} : { renamedFrom: renamedFrom as string[] };
  if (extension.exports === undefined) return { ok: true, metadata, warnings: [] };
  if (!isObject(extension.exports)) return { ok: false, errors: ['exports must be an object keyed by component name'] };
  const warnings: string[] = [];
  const entries: [string, AgentPluginExport][] = [];
  for (const [name, entry] of Object.entries(extension.exports)) {
    const reason = checkExport({ name, entry, provides, warnings });
    if (reason !== null) return { ok: false, errors: [`exports.${name}: ${reason}`] };
    const known = Object.fromEntries(Object.entries(entry as Entry).filter(([key]) => KNOWN_KEYS.has(key)));
    entries.push([name, known as unknown as AgentPluginExport]);
  }
  return { ok: true, metadata: { ...metadata, exports: Object.fromEntries(entries) }, warnings };
}

function checkExport({ name, entry, provides, warnings }: { readonly name: string; readonly entry: unknown; readonly provides: readonly string[]; readonly warnings: string[] }, _optional = {}): string | null {
  if (!isName(name)) return 'invalid component name';
  if (!isObject(entry)) return 'must be an object';
  for (const key of Object.keys(entry)) {
    if (!KNOWN_KEYS.has(key)) warnings.push(`unrecognized exports.${name} field '${key}' (ignored)`);
  }
  return checkVersions({ entry }) ?? checkFiles({ entry }) ?? checkContract({ entry, provides });
}

/** Save and render share the existing bounded schema/value policy; messages never echo prop values.
 * @returns First validation reason, or null on success. No side effects. @complexity O(p) prop values.
 */
export function validateAgentPluginExportProps(
  { definition, props }: { readonly definition: AgentPluginExport; readonly props: unknown },
  _optional: Record<string, never> = {},
): string | null {
  if (exceedsAdminSurfacePayloadLimit({ payload: props })) return 'props exceed the payload limit';
  return validateAdminSurfaceActionValue({ schema: definition.props, value: props });
}
