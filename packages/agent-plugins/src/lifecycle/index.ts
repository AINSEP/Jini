import { createPersistentStateModule } from "./persistent-state.js";
import { fetchAgentPluginArchive, maxAgentPluginArchiveBytes } from './fetch-archive.js';
import type { FetchAgentPluginArchiveOptional } from './fetch-archive.js';
import { createSeedBundledModule } from './seed-bundled.js';
import { createRetireBundledModule } from './retire-bundled.js';
import { createActivationModule } from './activation.js';
import { createBundledDigestsModule } from './bundled-digests.js';
import { createBundledSourceArchiveModule } from './bundled-source-archive.js';
import { createCapabilityProjectionModule } from './capability-projection.js';
import { createInstallModule } from './install.js';
import { createInstallFromUrlModule } from './install-from-url.js';
import { createPackagePathsModule } from './package-paths.js';
import { createResolveAgentPluginRefsModule } from './resolve-agent-plugin-refs.js';
import { createSearchModule } from './search.js';
import { createSetEnabledModule } from './set-enabled.js';
import { createTrustedPluginFilesModule } from './trusted-plugin-files.js';
import { createPluginContributionLoader } from './contribution-loader.js';
import { createUninstallModule } from './uninstall.js';
import type { AgentPluginLifecyclePorts, AgentPluginLifecycleRequired, AgentPluginLifecycleOptional } from './ports.js';
import type { AgentPluginDeliveryMode } from './resolve-agent-plugin-refs.js';
import type { InstalledDigestIdentity } from './bundled-digests.js';

export type { SeededAgentPluginOutcome, SeedBundledAgentPluginsRequired, SeedBundledAgentPluginsResult } from './seed-bundled.js';
export type { RetireBundledAgentPluginsRequired, RetireBundledAgentPluginsOptional, RetiredAgentPluginOutcome, RetiredAgentPluginSuccessorOutcome } from './retire-bundled.js';
export * from './ports.js';
export * from './layout.js';
export * from './manifest.js';
export * from './fetch-archive.js';
export * from './mcp-provisioning.js';
export * from './contribution-loader.js';
export { createAgentPluginActivations, ACTIVATIONS_FILENAME, ACTIVATIONS_LOCK_FILENAME, AgentPluginActivationsBusyError, AgentPluginActivationsUnreadableError } from './activation.js';
export { BUNDLED_DIGESTS_FILENAME } from './bundled-digests.js';
export { AgentPluginInstallError } from './install.js';
export { PackagePathViolation } from './package-paths.js';
export { AgentPluginNotInstalledError } from './set-enabled.js';
export { AgentPluginNotFoundError, AgentPluginNotUninstallableError, AgentPluginChangedSincePreviewError } from './uninstall.js';
export type { AgentPluginOrigin, AgentPluginActivationRecord, AgentPluginActivations, AgentPluginActivationVerdict, SetAgentPluginActivationRequired, SetAgentPluginActivationOptional, BundledAgentPluginEnableOutcome, DeleteAgentPluginActivationRequired } from './activation.js';
export type { BundledAgentPluginDigests, SeededBundledAgentPluginDigest, InstalledDigestIdentity } from './bundled-digests.js';
export type { PackedAgentPluginArchive } from './bundled-source-archive.js';
export type { AgentPluginArchiveEntry, AgentPluginArchiveReaderPort, AgentPluginArchiveReaderPort as ArchiveReaderPort, AgentPluginInstallErrorCode, InstalledAgentPluginSkill, InstalledAgentPlugin, InstallAgentPluginRequired, InstallAgentPluginOptional } from './install.js';
export type { AgentPluginIntegrity, InstallAgentPluginFromUrlRequired, InstallAgentPluginFromUrlOptional, InstalledAgentPluginFromUrl } from './install-from-url.js';
export type { AgentPluginDeliveryMode, ResolveAgentPluginRefsResult } from './resolve-agent-plugin-refs.js';
export type { SetAgentPluginEnabledInput, SetAgentPluginEnabledResult } from './set-enabled.js';
export type { UninstallAgentPluginRequired, UninstallAgentPluginOptional, UninstallAgentPluginResult, AgentPluginUninstallPreview, StagedTree } from './uninstall.js';
export type { TrustedPluginPackage, TrustedPluginPackagesQuery, TrustedPluginVerdict } from './trusted-plugin-files.js';
export type { AgentPluginSearchSkill, AgentPluginSearchCandidate, AgentPluginSearchMatch } from './search.js';

/** One host context owns queues and effects. Keep this object and its ports stable for its lifetime.
 * Installation/activation and MCP provisioning are separate operations: the host explicitly wires
 * provisioning using the exported helpers, with its own retry/recovery policy. */
export function createAgentPluginLifecycle(required: AgentPluginLifecycleRequired, optional: AgentPluginLifecycleOptional = {}) {
  const context: AgentPluginLifecyclePorts = Object.keys(optional).length ? { ...required, ...optional } : required;
  if (!context.productName.trim() || !context.extensionNamespace.trim() || !context.bundledArchiveMagic) {
    throw new Error('productName, extensionNamespace and bundledArchiveMagic are required');
  }
  if (context.deliveryMode !== 'inject' && context.deliveryMode !== 'pointer') throw new Error('Invalid deliveryMode');
  const activation = createActivationModule(context);
  const digests = createBundledDigestsModule(context);
  const archive = createBundledSourceArchiveModule(context);
  const capabilities = createCapabilityProjectionModule(context);
  const install = createInstallModule(context);
  const fromUrl = createInstallFromUrlModule(context);
  const paths = createPackagePathsModule(context);
  const refs = createResolveAgentPluginRefsModule(context);
  const search = createSearchModule(context);
  const enabled = createSetEnabledModule(context);
  const trusted = createTrustedPluginFilesModule(context);
  const contributions = createPluginContributionLoader({
    findPackages: input => trusted.findTrustedPluginPackages(input),
    readFile: ({ plugin, filename }) => trusted.readTrustedPluginFile(plugin, filename),
    importModule: ({ plugin, modulePath }) => trusted.importContainedModule(plugin, modulePath),
  });
  const uninstall = createUninstallModule(context);
  return {
    ...contributions,
    fetchAgentPluginArchive: (input: { readonly url: string }, optional: FetchAgentPluginArchiveOptional = {}) => fetchAgentPluginArchive({ ...input, fetch: context.fetch, outboundGuard: context.outboundGuard }, optional),
    maxAgentPluginArchiveBytes,
    seedBundledAgentPlugins: createSeedBundledModule(context).seedBundledAgentPlugins,
    retireBundledAgentPlugins: createRetireBundledModule(context).retireBundledAgentPlugins,
    setAgentPluginActivation: activation.setAgentPluginActivation,
    recordBundledAgentPluginIfAbsent: activation.recordBundledAgentPluginIfAbsent,
    enableBundledAgentPluginUnlessOperatorDisabled: activation.enableBundledAgentPluginUnlessOperatorDisabled,
    deleteAgentPluginActivation: activation.deleteAgentPluginActivation,
    recordBundledAgentPluginDigests: (input: { readonly workspaceRoot: string; readonly seeded: Parameters<typeof digests.recordBundledAgentPluginDigests>[0]['seeded'] }, optional: { readonly now?: (required: Record<string, never>) => Date } = {}) => digests.recordBundledAgentPluginDigests({ ...input, ...optional }),
    removeBundledAgentPluginDigest: digests.removeBundledAgentPluginDigest,
    installAgentPlugin: install.installAgentPlugin,
    installAgentPluginFromUrl: fromUrl.installAgentPluginFromUrl,
    setAgentPluginEnabled: enabled.setAgentPluginEnabled,
    findTrustedPluginPackages: (input: Omit<Parameters<typeof trusted.findTrustedPluginPackages>[0], 'orderByPluginId' | 'onInactive'>, optional: Pick<Parameters<typeof trusted.findTrustedPluginPackages>[0], 'orderByPluginId' | 'onInactive'> = {}) => trusted.findTrustedPluginPackages({ ...input, ...optional }),
    previewAgentPluginUninstall: uninstall.previewAgentPluginUninstall,
    uninstallAgentPlugin: uninstall.uninstallAgentPlugin,
    stageForRemoval: (input: { readonly packagesDir: string; readonly packageRoot: string }, _optional: Record<string, never> = {}) => uninstall.stageForRemoval(input.packagesDir, input.packageRoot),
    restoreStagedTrees: (input: { readonly staged: Parameters<typeof uninstall.restoreStagedTrees>[0]; readonly cause: unknown }, _optional: Record<string, never> = {}) => uninstall.restoreStagedTrees(input.staged, input.cause),
    removeFrozenPackageTree: (input: { readonly root: string }, _optional: Record<string, never> = {}) => uninstall.removeFrozenPackageTree(input.root),
    isAgentPluginActive: (input: { readonly activations: Parameters<typeof activation.isAgentPluginActive>[0]; readonly pluginId: string }) => activation.isAgentPluginActive(input.activations, input.pluginId),
    filterActiveAgentPlugins: <T>(input: { readonly activations: Parameters<typeof activation.isAgentPluginActive>[0]; readonly items: readonly T[]; readonly pluginIdOf: (required: { readonly item: T }) => string }) => activation.filterActiveAgentPlugins(input.activations, input.items, item => input.pluginIdOf({ item })),
    readAgentPluginActivations: (input: { readonly workspaceRoot: string }) => activation.readAgentPluginActivations(input.workspaceRoot),
    assertAgentPluginActivationsWritable: (input: { readonly workspaceRoot: string }) => activation.assertAgentPluginActivationsWritable(input.workspaceRoot),
    isAgentPluginRecordedAsBundled: (input: { readonly workspaceRoot: string; readonly pluginId: string }) => activation.isAgentPluginRecordedAsBundled(input.workspaceRoot, input.pluginId),
    resolveAgentPluginActivation: (input: { readonly workspaceRoot: string; readonly pluginId: string }) => activation.resolveAgentPluginActivation(input.workspaceRoot, input.pluginId),
    normalizeActivations: (input: { readonly value: unknown }) => activation.normalizeActivations(input.value),
    readBundledAgentPluginDigests: (input: { readonly workspaceRoot: string }) => digests.readBundledAgentPluginDigests(input.workspaceRoot),
    normalizeBundledDigests: (input: { readonly value: unknown }) => digests.normalizeBundledDigests(input.value),
    preferBundledAgentPluginDigests: <T extends InstalledDigestIdentity>(input: { readonly installed: readonly T[]; readonly bundled: Parameters<typeof digests.preferBundledAgentPluginDigests>[1] }) => digests.preferBundledAgentPluginDigests(input.installed, input.bundled),
    normalizePackageEntryPath: (input: { readonly rawEntryPath: string }) => paths.normalizePackageEntryPath(input.rawEntryPath),
    assertContainedOnDisk: (input: { readonly packageRoot: string; readonly entryPath: string }) => paths.assertContainedOnDisk(input.packageRoot, input.entryPath),
    classifyAgentPluginMcpServerTrust: (input: { readonly server: Parameters<typeof capabilities.classifyAgentPluginMcpServerTrust>[0] }) => capabilities.classifyAgentPluginMcpServerTrust(input.server),
    readInstalledSkillMarkdown: (input: { readonly packageRoot: string; readonly skillPath: string }) => capabilities.readInstalledSkillMarkdown(input.packageRoot, input.skillPath),
    readInstalledMcpServerIds: (input: { readonly packageRoot: string }) => capabilities.readInstalledMcpServerIds(input.packageRoot),
    readInstalledMcpServers: (input: { readonly packageRoot: string }) => capabilities.readInstalledMcpServers(input.packageRoot),
    resolveAgentPluginRefs: (input: { readonly pluginRefIds: readonly string[]; readonly workspaceLayout: Parameters<typeof refs.resolveAgentPluginRefs>[1] }, optional: { readonly deliveryMode?: AgentPluginDeliveryMode } = {}) => refs.resolveAgentPluginRefs(input.pluginRefIds, input.workspaceLayout, optional.deliveryMode ?? context.deliveryMode),
    pluginMemory: (input: { readonly workspaceId: string; readonly pluginId: string }) => createPersistentStateModule(context).memory({
      workspaceRoot: context.layout.forWorkspace({ workspaceId: input.workspaceId }).root, pluginId: input.pluginId,
    }),
    migratePluginLayout: (input: { readonly workspaceId: string }) => createPersistentStateModule(context).migrate({
      workspaceRoot: context.layout.forWorkspace({ workspaceId: input.workspaceId }).root,
    }),
    listInstalledPlugins: (input: { readonly workspaceRoot: string }) => refs.listInstalledPlugins(input.workspaceRoot),
    isInstalledDigestPresent: (input: { readonly packagesDir: string; readonly archiveDigest: string }) => refs.isInstalledDigestPresent(input.packagesDir, input.archiveDigest),
    rankInstalledAgentPlugins: (input: { readonly query: string; readonly candidates: Parameters<typeof search.rankInstalledAgentPlugins>[1]; readonly limit: number }) => search.rankInstalledAgentPlugins(input.query, input.candidates, input.limit),
    readTrustedPluginFile: (input: { readonly plugin: Parameters<typeof trusted.readTrustedPluginFile>[0]; readonly filename: string }) => trusted.readTrustedPluginFile(input.plugin, input.filename),
    importContainedModule: (input: { readonly plugin: Parameters<typeof trusted.importContainedModule>[0]; readonly modulePath: string }) => trusted.importContainedModule(input.plugin, input.modulePath),
    maxAgentPluginInstallArchiveBytes: (_input: Record<string, never>) => install.maxAgentPluginInstallArchiveBytes(),
    indexInstalledRoot: (input: { readonly packageRoot: string; readonly archiveDigest: string }) => install.indexInstalledRoot(input.packageRoot, input.archiveDigest),
    packAgentPluginDirectory: (input: { readonly sourceDir: string }) => archive.packAgentPluginDirectory(input.sourceDir),
    createBundledSourceArchiveReader: (_input: Record<string, never>) => archive.createBundledSourceArchiveReader(),
  };
}
