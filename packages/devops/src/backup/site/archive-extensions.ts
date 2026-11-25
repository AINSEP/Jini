import { createHash } from "node:crypto";
import type { AgentPluginLayout } from "@jini-ai/core/contracts/headless/plugin-host";
import type { ArchivePlugin } from "./archive-manifest.js";
import { SiteShareRefusal } from "./share-refusal.js";
import type { CollectedSiteBackupFiles, PlannedDiskFile, ReadPlannedFileResult, SiteBackupInclude, SiteBackupSources } from "./sources.js";

/** One installed agent plugin package, as the host's plugin lifecycle lists it. */
export interface InstalledAgentPluginRecord {
  readonly pluginId: string;
  readonly version?: string | undefined;
  readonly archiveDigest: string;
}

/** The host's agent-plugin lifecycle reads this preparation needs, bound to one plugin layout. */
export interface ArchiveExtensionsLifecycle {
  readonly listInstalledPlugins: (required: { workspaceRoot: string }) => Promise<readonly InstalledAgentPluginRecord[]>;
  readonly readBundledAgentPluginDigests: (required: { workspaceRoot: string }) => Promise<ReadonlyMap<string, string>>;
  readonly preferBundledAgentPluginDigests: (candidates: readonly InstalledAgentPluginRecord[], bundled: ReadonlyMap<string, string>) => readonly InstalledAgentPluginRecord[];
  readonly readAgentPluginActivations: (required: { workspaceRoot: string }) => Promise<{ readonly plugins: Readonly<Record<string, { readonly enabled?: boolean | undefined } | undefined>> }>;
}

/** Everything the preparation takes from the host. Every member is REQUIRED: the engine carries no host defaults. */
export interface ArchiveExtensionsDeps {
  readonly collectSiteBackupFiles: (input: { sources: SiteBackupSources; include: SiteBackupInclude }, optional: { profile: "share" }) => Promise<CollectedSiteBackupFiles>;
  readonly readPlannedFile: (file: PlannedDiskFile) => Promise<ReadPlannedFileResult>;
  /** Binds the host's plugin lifecycle to the site's agent-plugin layout. */
  readonly createLifecycle: (required: { layout: AgentPluginLayout }) => ArchiveExtensionsLifecycle;
  /** The theme owner's packaged original for a theme, or nothing when it has none. */
  readonly resolveThemeOriginalSource: (required: { manifest: { tier: "static"; id: string }; siteThemesRoot: string; packageThemesRoot: string | undefined }) => { readonly originalDir: string } | null | undefined;
  /** The host's runtime-path to archive-path mapping; `null` for a path the archive never carries. */
  readonly runtimeToArchivePath: (required: { path: string }) => string | null;
  /** The file names a plugin package's own manifest may carry. */
  readonly pluginManifestFilenames: readonly string[];
}


/** Selects installed package versions through the lifecycle owner; includes reset baselines.
 * @throws SiteShareRefusal for multiple workspaces, unsafe originals or stale planned files.
 * @complexity O(files × (themes + plugins) + package bytes), bounded by share caps.
 */
export async function prepareArchiveExtensions(required: { sources: SiteBackupSources; files: readonly PlannedDiskFile[]; deps: ArchiveExtensionsDeps }, optional: { packageThemesRoot?: string } = {}): Promise<{ files: PlannedDiskFile[]; plugins: ArchivePlugin[]; notices?: readonly string[] }> {
  const files = [...required.files], notices: string[] = [];
  await includeThemeOriginals({ sources: required.sources, files, notices, deps: required.deps }, optional);
  const workspaces = new Set(files.flatMap(file => /^agent-plugins\/ws\/([^/]+)\//.exec(file.path)?.[1] ?? []));
  if (workspaces.size > 1) throw new SiteShareRefusal({ code: "UNSUPPORTED_DATA", message: "Export requires a single plugin workspace." });
  const plugins: ArchivePlugin[] = [];
  let selected = files;
  const workspaceId = [...workspaces][0];
  if (workspaceId) {
    const lifecycle = required.deps.createLifecycle({ layout: required.sources.agentPlugins });
    const workspaceRoot = required.sources.agentPlugins.forWorkspace({ workspaceId }).root;
    const candidates = await lifecycle.listInstalledPlugins({ workspaceRoot });
    const bundled = await lifecycle.readBundledAgentPluginDigests({ workspaceRoot });
    const installed = lifecycle.preferBundledAgentPluginDigests(candidates, bundled);
    if (new Set(installed.map(plugin => plugin.pluginId)).size !== installed.length) throw new SiteShareRefusal({ code: "UNSUPPORTED_PLUGIN", message: "Export requires one installed digest per plugin id." });
    const activations = await lifecycle.readAgentPluginActivations({ workspaceRoot });
    // Old copies can stop indexing after a manifest contract changes. The ledger still names
    // this build's valid revision; leave every other copy on disk, outside the flattened export.
    const bundledSelection = new Map(installed.filter(plugin => bundled.get(plugin.pluginId) === plugin.archiveDigest).map(plugin => [plugin.pluginId, plugin.archiveDigest]));
    selected = files.filter(file => !isSupersededBundledRevision({ file, selected: bundledSelection }));
    for (const plugin of installed) plugins.push({ kind: "agent", id: plugin.pluginId, version: plugin.version ?? "unknown", digest: plugin.archiveDigest, enabled: activations.plugins[plugin.pluginId]?.enabled ?? true, shipped: true });
  }
  plugins.push(...await unindexedAgentRecords({ files: selected, plugins }));
  plugins.push(...await sitePluginRecords({ files: selected, deps: required.deps }));
  return { files: selected.filter(file => required.deps.runtimeToArchivePath({ path: file.path }) !== null), plugins, ...(notices.length ? { notices } : {}) };
}

/** Flatten only the verified selected bundled revision; unrecorded/absent selections still refuse.
 * @complexity O(path length) matching and O(1) ledger lookup per planned file; no disk writes. */
function isSupersededBundledRevision(required: { file: PlannedDiskFile; selected: ReadonlyMap<string, string> }): boolean {
  const revision = /^agent-plugins\/ws\/[^/]+\/([^/]+)\/package\/sha256\/([a-f0-9]{64})\//.exec(required.file.path);
  if (!revision) return false;
  const selected = required.selected.get(revision[1]!);
  return selected !== undefined && selected !== revision[2];
}

async function includeThemeOriginals(required: { sources: SiteBackupSources; files: PlannedDiskFile[]; notices: string[]; deps: ArchiveExtensionsDeps }, optional: { packageThemesRoot?: string }): Promise<void> {
  const themes = required.files.filter(file => /^themes\/(static|declarative|code)\/[^/]+\/theme.json$/.test(file.path));
  for (const file of themes) {
    // The filter above kept only `themes/<tier>/<id>/theme.json`, so both segments exist.
    const [, tier, id] = file.path.split("/") as [string, string, string];
    const originalPrefix = `themes/__original-themes__/${tier}/${id}/`;
    if (required.files.some(file => file.path.startsWith(originalPrefix))) continue;
    const original = required.deps.resolveThemeOriginalSource({ manifest: { tier: tier as "static", id }, siteThemesRoot: required.sources.themesDir, packageThemesRoot: optional.packageThemesRoot });
    if (original) {
      const collected = await required.deps.collectSiteBackupFiles({ sources: { ...required.sources, themesDir: original.originalDir }, include: { database: false, media: false, themes: true, plugins: false, settings: false } }, { profile: "share" });
      recordThemeOriginalCollection(required.notices, collected, id);
      required.files.push(...collected.files.filter(file => file.path.startsWith("themes/")).map(file => ({ ...file, path: originalPrefix + file.path.slice("themes/".length) })));
    } else {
      // A theme without a recorded baseline still needs a recoverable original in v2.
      // Preserve its current snapshot as that baseline; never invent package content.
      const livePrefix = `themes/${tier}/${id}/`;
      required.files.push(...required.files.filter(file => file.path.startsWith(livePrefix)).map(file => ({ ...file, path: originalPrefix + file.path.slice(livePrefix.length) })));
    }
  }
}

function recordThemeOriginalCollection(notices: string[], collected: CollectedSiteBackupFiles, id: string): void {
  notices.push(...(collected.notices ?? []));
  if (collected.skipped.length) {
    const skipped = collected.skipped[0];
    if (skipped === undefined) throw new Error("Theme original export has no skipped-file details");
    throw new SiteShareRefusal({ code: "UNSAFE_FILE", message: `Cannot export theme original '${id}': ${skipped.reason}.` });
  }
}

async function sitePluginRecords({ files, deps }: { files: readonly PlannedDiskFile[]; deps: ArchiveExtensionsDeps }): Promise<ArchivePlugin[]> {
  const groups = new Map<string, PlannedDiskFile[]>();
  for (const file of files) {
    const mapped = deps.runtimeToArchivePath({ path: file.path });
    const id = mapped && /^plugins\/([^/]+)\/package\//.exec(mapped)?.[1];
    if (id) { const group = groups.get(id) ?? []; group.push(file); groups.set(id, group); }
  }
  const plugins: ArchivePlugin[] = [];
  for (const [id, entries] of groups) {
    const digest = createHash("sha256");
    let version = "unknown";
    for (const file of entries) {
      const read = await deps.readPlannedFile(file);
      if (!read.ok) throw new SiteShareRefusal({ code: "PLAN_STALE", message: read.message });
      digest.update(file.path).update(createHash("sha256").update(read.bytes).digest());
      version = sitePluginVersion({ file, bytes: read.bytes, id, current: version, manifestNames: deps.pluginManifestFilenames });
    }
    plugins.push({ kind: "site", id, version, digest: digest.digest("hex"), enabled: false, shipped: true });
  }
  return plugins;
}

/** Malformed/unindexed packages are still site content. Preserve their bytes, never infer trust. */
async function unindexedAgentRecords(required: { files: readonly PlannedDiskFile[]; plugins: readonly ArchivePlugin[] }): Promise<ArchivePlugin[]> {
  const known = new Map(required.plugins.map(plugin => [plugin.id, plugin.digest]));
  const extras: ArchivePlugin[] = [];
  for (const file of required.files) {
    const match = /^agent-plugins\/ws\/[^/]+\/([^/]+)\/package\/sha256\/([a-f0-9]{64})\//.exec(file.path);
    if (!match) continue;
    const id = match[1]!;
    const digest = match[2]!;
    const previous = known.get(id);
    if (previous && previous !== digest) throw new SiteShareRefusal({ code: "UNSUPPORTED_PLUGIN", message: `Plugin '${id}' has multiple installed digests.` });
    if (!previous) {
      known.set(id, digest);
      extras.push({ kind: "agent", id, version: "unknown", digest, enabled: false, shipped: true });
    }
  }
  return extras;
}

/** Only the package's own manifest names its version; nested example manifests do not. Jini lists exactly
 *  one manifest per package (the one discovery validated against its version folder). */
function sitePluginVersion(required: { file: PlannedDiskFile; bytes: Buffer; id: string; current: string; manifestNames: readonly string[] }): string {
  if (!required.manifestNames.some(name => required.file.path === `plugins/${required.id}/package/${name}`)) return required.current;
  return String(JSON.parse(required.bytes.toString("utf8")).version ?? "unknown");
}
