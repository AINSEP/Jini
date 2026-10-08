/** Host contracts only. No product SDK, content-type implementation or executable importer lives here. */
import type { PluginManifest, PluginValidationError } from './manifest.js';
import type { PluginDiscoveryRecord } from './discovery-types.js';
import type { ClaimMode } from './claim-conflicts.js';

/** Plain serializable entry envelope; hosts extend it with their own hook payload fields. */
export interface ContentEntryDraft {
  readonly workspaceId: string;
  readonly ext: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}
export interface HookContext { readonly pluginId: string; readonly workspaceId: string }
export type ExtPatch = Readonly<Record<string, string | number | boolean>>;
/** Positional callbacks are the existing plugin wire ABI, not Jini factory boundaries. */
export type BeforeSaveFilter = (entry: Readonly<ContentEntryDraft>, ctx: HookContext) => ExtPatch | Promise<ExtPatch>;
export type HookPoints = Readonly<Record<string, unknown>>;
export interface PluginSdk<H extends HookPoints = HookPoints> {
  readonly content: { read(): Readonly<ContentEntryDraft>; extend(field: string, value: string | number | boolean): void };
  addFilter<K extends keyof H & string>(hookName: K, filter: H[K] extends (...args: never[]) => unknown ? H[K] : BeforeSaveFilter): void;
  addAction(...args: never[]): void;
  addContribution(...args: never[]): void;
}
export interface DefinedPlugin<H extends HookPoints = HookPoints> {
  readonly definition: { setup(sdk: PluginSdk<H>): void | Promise<void> };
}
/** Required binding to the host-owned SDK. Hook ids and semantics never default to a product catalog.
 * @example { hookIds: ['beforeSave'], beforeSaveHook: 'beforeSave', hookSemantics: { beforeSave: 'shared' }, ...abi }
 */
export interface PluginSdkBinding<H extends HookPoints = HookPoints> {
  readonly hookIds: readonly (keyof H & string)[];
  readonly beforeSaveHook: keyof H & string;
  readonly hookSemantics: Readonly<Record<string, ClaimMode>>;
  readonly runtimeSdkVersion: string;
  readonly readDefinedPlugin: (required: { moduleValue: unknown }, optional?: Record<string, never>) => DefinedPlugin<H> | null;
  readonly buildSdk: (required: { sdk: PluginSdk<H> }, optional?: Record<string, never>) => PluginSdk<H>;
  /** Wraps a worker proxy in the host's definePlugin ABI without evaluating plugin code. */
  readonly definePlugin: (required: DefinedPlugin<H>['definition'], optional?: Record<string, never>) => DefinedPlugin<H>;
}

/** The declaration grammar and create/write lifecycle remain host-owned. Opaque fields and plans
 * are carried unchanged; a host adapter binds its concrete content-type contracts. */
export interface DeclaredContentType { readonly key: string; readonly label: string; readonly fields: readonly unknown[] }
export interface DeclaredContentTypePlan { readonly conflicts: readonly string[]; readonly items: readonly unknown[] }
export interface DeclaredContentTypePorts {
  findByKey(required: { workspaceId: string; key: string }): Promise<unknown>;
  register(required: { workspaceId: string; key: string; label: string; fields: readonly unknown[]; actorId: string }): Promise<{ ok: true } | { ok: false; error: Error }>;
}
export interface DeclarativeContentTypesPort {
  validateManifest(required: { manifest: Readonly<Record<string, unknown>> }, optional?: Record<string, never>): { readonly errors: readonly PluginValidationError[] };
  parse(required: { value: unknown }, optional?: Record<string, never>): { readonly decls: readonly DeclaredContentType[]; readonly errors: readonly PluginValidationError[] };
  plan(required: { ports: Pick<DeclaredContentTypePorts, 'findByKey'>; workspaceId: string; decls: readonly DeclaredContentType[] }, optional?: Record<string, never>): Promise<DeclaredContentTypePlan>;
  apply(required: { ports: DeclaredContentTypePorts; workspaceId: string; pluginId: string; plan: DeclaredContentTypePlan }, optional?: Record<string, never>): Promise<unknown>;
}
export interface ManifestHostPorts<H extends HookPoints = HookPoints> {
  readonly pluginSdkBinding: PluginSdkBinding<H>;
  readonly capabilityVocabulary: readonly string[];
  readonly declarativeContentTypes: DeclarativeContentTypesPort;
  /** Preserves the host's reserved-id diagnostic without embedding a product display name. */
  readonly coreOwnerName: string;
}
/** Tier-1 is never executable; tier-2 requires a worker importer; tier-3 requires explicit host allow.
 * Site/install admission errors retain host wording and are supplied by composition. */
export interface PluginTierPolicy {
  readonly siteErrors: (required: { manifestValue: unknown }, optional?: Record<string, never>) => readonly PluginValidationError[];
  readonly checkInstall: (required: { manifest: PluginManifest; files: ReadonlyMap<string, Uint8Array> }, optional?: Record<string, never>) => void;
  readonly allowLoad: (required: { record: PluginDiscoveryRecord; manifest: PluginManifest }, optional?: Record<string, never>) => boolean;
  readonly execution: 'in-process' | 'worker';
}
/** Byte reader owns archive parsing, zip-slip checks and limits. Never accept an unvalidated ZIP map. */
export type ArchiveReaderPort = (required: { archive: Uint8Array }, optional?: Record<string, never>) => Promise<Map<string, Uint8Array>>;
/** Host computes the established sha256-hex digest; the ordered loader compares it to the manifest. */
export type VerifyDigestPort = (required: { absoluteFilePath: string }, optional?: Record<string, never>) => Promise<string>;

/** STRUCTURAL mirrors of Phase 13, packages/agent-plugins/src/lifecycle/{trusted-plugin-files,
 * contribution-loader}.ts. Both packages are L4; the host supplies the existing implementations.
 * These are declarations only: no parallel trust, activation or contribution-loader owner. */
export interface TrustedPluginPackage { readonly pluginId: string; readonly packageRoot: string }
export interface TrustedPluginPackagesQuery {
  readonly workspaceId: string; readonly filename: string; readonly contribution: string; readonly requireActive: boolean;
  readonly orderByPluginId?: boolean | undefined;
  readonly onInactive?: ((required: { readonly plugin: TrustedPluginPackage }) => Promise<void>) | undefined;
}
export type TrustedPluginVerdict = { readonly trusted: TrustedPluginPackage } | { readonly refusal: string };
export type PluginModuleImportPort = (input: { readonly plugin: TrustedPluginPackage; readonly modulePath: string }) => Promise<{ readonly exported: unknown } | string>;
export interface PluginContributionPorts {
  readonly findPackages: (input: TrustedPluginPackagesQuery) => Promise<readonly TrustedPluginVerdict[]>;
  readonly readFile: (input: { readonly plugin: TrustedPluginPackage; readonly filename: string }) => Promise<string>;
  readonly importModule: PluginModuleImportPort;
}
/** Structural host removal port, matching Tovu trash/ports.ts without a CMS dependency edge. */
export type RemoveEntity = (required: {
  workspaceId: string; id: string; display: { title: string; subtitle?: string | null }; at: string;
  expectedVersion: number | null; actor: { principalId: string; pluginId?: string | null }; priorMarker?: string | null;
}) => Promise<{ ok: true; version: number | null } | { ok: false; reason: 'not-found' | 'version-changed' } | { ok: false; reason: 'blocked'; code: string; count: number }>;
