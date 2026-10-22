import type { TrustedPluginPackage, TrustedPluginPackagesQuery, TrustedPluginVerdict } from './trusted-plugin-files.js';

export type PluginContributionParseResult<T> =
  | { readonly ok: true; readonly descriptors: readonly T[] }
  | { readonly ok: false; readonly reason: string };
export interface PluginContributionResult<T> {
  readonly items: readonly T[];
  readonly refusals: readonly string[];
}
export type PluginModuleImportPort = (input: { readonly plugin: TrustedPluginPackage; readonly modulePath: string }) => Promise<{ readonly exported: unknown } | string>;
export interface PluginContributionDefinition<D, T> {
  readonly filename: string;
  readonly contribution: string;
  readonly kind: 'data' | 'executable';
  readonly parse: (input: { readonly raw: string }) => PluginContributionParseResult<D>;
  /** A string is the complete refusal line; successful values retain declaration order. */
  readonly load: (input: { readonly plugin: TrustedPluginPackage; readonly descriptor: D; readonly importModule: PluginModuleImportPort }) => T | string | Promise<T | string>;
  /** Undefined propagates the fault; [] deliberately tolerates a missing source manifest. */
  readonly onReadError?: (input: { readonly plugin: TrustedPluginPackage; readonly error: unknown }) => readonly string[] | undefined;
}
export interface LoadedPluginContribution<D, M> {
  readonly descriptor: D;
  readonly pluginId: string;
  readonly module: M;
}
export interface PluginContributionPorts {
  readonly findPackages: (input: TrustedPluginPackagesQuery) => Promise<readonly TrustedPluginVerdict[]>;
  readonly readFile: (input: { readonly plugin: TrustedPluginPackage; readonly filename: string }) => Promise<string>;
  readonly importModule: PluginModuleImportPort;
}
export interface LoadPluginContributionsOptional {
  /** Executable definitions always require activation, even if this option is false. */
  readonly requireActive?: boolean;
  readonly orderByPluginId?: boolean;
  readonly onInactive?: TrustedPluginPackagesQuery['onInactive'];
  readonly packageRefusal?: (input: { readonly plugin: TrustedPluginPackage }) => string | undefined;
}

/** Bind traversal to the lifecycle's existing trust/read/import owner. Parser and error policies
 * remain contribution ports: manifests and refusal contracts do not change.
 * @param required - Trusted-file effects, injectable for direct failure and ordering tests.
 * @returns Installed and explicitly trusted source loaders; reads are fresh on each call.
 * @complexity O(p + d) packages and declarations, plus their file/import I/O; O(d + r) output space.
 */
export function createPluginContributionLoader(required: PluginContributionPorts, _optional: Record<string, never> = {}) {
  /** Source bypass is explicit: only the caller can establish that a source directory is trusted.
   * Read faults propagate unless the definition supplies its established recovery policy. */
  async function loadPluginContributionsFromSource<D, T>(
    input: { readonly plugin: TrustedPluginPackage; readonly definition: PluginContributionDefinition<D, T> },
    _options: Record<string, never> = {},
  ): Promise<PluginContributionResult<T>> {
    const { plugin, definition } = input;
    let raw: string;
    try { raw = await required.readFile({ plugin, filename: definition.filename }); }
    catch (error) {
      const refusals = definition.onReadError?.({ plugin, error });
      if (refusals === undefined) throw error;
      return { items: [], refusals };
    }
    const parsed = definition.parse({ raw });
    if (!parsed.ok) return { items: [], refusals: [`${definition.contribution} from '${plugin.pluginId}' were not loaded: ${definition.filename} is invalid: ${parsed.reason}`] };
    const items: T[] = [];
    const refusals: string[] = [];
    for (const descriptor of parsed.descriptors) {
      const loaded = await definition.load({ plugin, descriptor, importModule: required.importModule });
      if (typeof loaded === 'string') refusals.push(loaded);
      else items.push(loaded);
    }
    return { items, refusals };
  }

  /** Discover before loading, then interleave gate and manifest refusals in verdict order.
   * Never fall back to source or bypass the bundled-digest gate for installed packages. */
  async function loadPluginContributions<D, T>(
    input: { readonly workspaceId: string; readonly definition: PluginContributionDefinition<D, T> },
    options: LoadPluginContributionsOptional = {},
  ): Promise<PluginContributionResult<T>> {
    const { definition } = input;
    const { packageRefusal, requireActive = true, ...discovery } = options;
    const verdicts = await required.findPackages({
      ...discovery, workspaceId: input.workspaceId, filename: definition.filename,
      contribution: definition.contribution, requireActive: definition.kind === 'executable' || requireActive,
    });
    const items: T[] = [];
    const refusals: string[] = [];
    for (const verdict of verdicts) {
      if ('refusal' in verdict) { refusals.push(verdict.refusal); continue; }
      const refusal = packageRefusal?.({ plugin: verdict.trusted });
      if (refusal !== undefined) { refusals.push(refusal); continue; }
      const loaded = await loadPluginContributionsFromSource({ plugin: verdict.trusted, definition });
      items.push(...loaded.items);
      refusals.push(...loaded.refusals);
    }
    return { items, refusals };
  }
  return { loadPluginContributions, loadPluginContributionsFromSource };
}

/** Define executable materialization once; each domain owns export validation and refusal wording.
 * @param required - Existing manifest parser, module path, validator and complete refusal formatter.
 * @param optional - Established read/import recovery policy; absent policies propagate I/O faults.
 * @returns A definition whose installed loader always applies activation before importing code.
 * @complexity O(1) composition; each load performs one contained import and one validation.
 */
export function defineExecutablePluginContribution<D, M>(required: {
  readonly filename: string;
  readonly contribution: string;
  readonly parse: PluginContributionDefinition<D, LoadedPluginContribution<D, M>>['parse'];
  readonly modulePath: (input: { readonly descriptor: D }) => string;
  readonly validate: (input: { readonly exported: unknown }) => M | string;
  readonly refusal: (input: { readonly plugin: TrustedPluginPackage; readonly descriptor: D; readonly reason: string }) => string;
}, optional: {
  readonly onReadError?: PluginContributionDefinition<D, LoadedPluginContribution<D, M>>['onReadError'];
  readonly importRefusalReason?: string;
  readonly importErrorReason?: string;
} = {}): PluginContributionDefinition<D, LoadedPluginContribution<D, M>> {
  return {
    filename: required.filename, contribution: required.contribution, kind: 'executable', parse: required.parse,
    ...(optional.onReadError ? { onReadError: optional.onReadError } : {}),
    load: async ({ plugin, descriptor, importModule }) => {
      let module: M | string;
      try {
        const imported = await importModule({ plugin, modulePath: required.modulePath({ descriptor }) });
        module = typeof imported === 'string' ? optional.importRefusalReason ?? imported : required.validate({ exported: imported.exported });
      } catch (error) {
        if (optional.importErrorReason === undefined) throw error;
        module = optional.importErrorReason;
      }
      if (typeof module === 'string') return required.refusal({ plugin, descriptor, reason: module });
      return { descriptor, pluginId: plugin.pluginId, module };
    },
  };
}
