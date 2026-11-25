import fs from "node:fs";
import path from "node:path";
import type { AgentPluginLayout } from "@jini-ai/core/contracts/headless/plugin-host";
import { writeExclusive } from "./import-restore-placement.js";

/** The slice of a manifest's plugin row this step reads (the host's archive plugin satisfies it). */
export interface ImportedArchivePlugin {
  readonly kind: string;
  readonly id: string;
  readonly digest: string;
  readonly enabled: boolean;
}

/** One plugin as the host's lifecycle lists it after seeding. */
export interface InstalledImportPlugin { readonly pluginId: string; readonly archiveDigest?: string | undefined }

/** The host agent-plugin lifecycle operations the import restore drives. */
export interface ImportPluginLifecycle {
  /** The host's "Soon" lock catalog, handed back to {@link ImportPluginStateDeps.findSoonAgentPlugin}. */
  readonly soonCatalog: unknown;
  seedBundledAgentPlugins(required: { layout: AgentPluginLayout; workspaceId: string; sourceRoot: string }): Promise<unknown>;
  listInstalledPlugins(required: { workspaceRoot: string }): Promise<readonly InstalledImportPlugin[]>;
  setAgentPluginActivation(required: { workspaceRoot: string; pluginId: string; enabled: boolean; actor: string }): Promise<unknown>;
}

/** Host values the restore cannot own: lifecycle, "Soon" lock, starter workspace id and path policy. */
export interface ImportPluginStateDeps {
  /** Folder of this build's bundled agent-plugin sources. */
  sourceRoot: string;
  createLifecycle(required: { layout: AgentPluginLayout; sourceRoot: string }): ImportPluginLifecycle;
  /** Truthy when the host locks this plugin off ("Soon"); locked plugins are written off, not refused. */
  findSoonAgentPlugin(required: { catalog: unknown; workspaceRoot: string; pluginId: string }): Promise<unknown>;
  /** The workspace id the starter template seeds. */
  starterWorkspaceId(): string;
  validatePath(required: { path: string }): void;
}

type InstalledPlugin = InstalledImportPlugin;
type MemoryDirs = Pick<ReturnType<AgentPluginLayout["forWorkspace"]>, "pluginMemoryDir">;

/** Functional private staging state; discarded with the import stage, never an import history report. */
export interface ImportedExtensionState {
  plugins: readonly ImportedArchivePlugin[];
  trustedPlugins: readonly ImportedArchivePlugin[];
  modified: readonly string[];
  /** Code units staged switched off because this install does not recognise them. Absent in
   * stages written before this field existed. */
  keptOff?: readonly string[];
}

/** Seed only THIS install's code before applying imported activation choices by plugin id.
 * Shipped code remains quarantined (see `importedActivation` for the per-plugin decision).
 * @complexity O(local bundled package bytes + imported memory bytes), bounded by share caps.
 */
export async function restoreImportedPluginState(required: { root: string; dir: string; layout: AgentPluginLayout; state: ImportedExtensionState; files: readonly string[]; deps: ImportPluginStateDeps }, _optional: Record<string, never> = {}): Promise<ReadonlySet<string>> {
  if (!required.state.plugins.some(plugin => plugin.kind === "agent")) return new Set();
  const { layout } = required;
  const { deps } = required;
  const workspaceId = deps.starterWorkspaceId();
  const { sourceRoot } = deps;
  const lifecycle = deps.createLifecycle({ layout, sourceRoot });
  await lifecycle.seedBundledAgentPlugins({ layout, workspaceId, sourceRoot });
  const workspace = layout.forWorkspace({ workspaceId });
  const installed = await lifecycle.listInstalledPlugins({ workspaceRoot: workspace.root });
  const trusted = new Set(required.state.trustedPlugins.map(plugin => plugin.id));
  const enabledUnits = new Set<string>();
  for (const plugin of required.state.plugins.filter(plugin => plugin.kind === "agent")) {
    const edited = required.state.modified.includes("agent-plugins/" + plugin.id);
    // A "Soon" plugin is locked off (host "Soon" lock, owner 2026-11-10): written off
    // rather than refused, so one locked plugin never aborts the rest of the import.
    const enabled = importedActivation({ plugin, installed, trusted, edited })
      && !(await deps.findSoonAgentPlugin({ catalog: lifecycle.soonCatalog, workspaceRoot: workspace.root, pluginId: plugin.id }));
    await lifecycle.setAgentPluginActivation({ workspaceRoot: workspace.root, pluginId: plugin.id, enabled, actor: "system:import" });
    if (enabled) enabledUnits.add("agent-plugins/" + plugin.id);
  }
  // Cross-build choices can enable local code after staging classified the source as unrecognised.
  // Completion notices must reflect the activation we wrote, while source bytes stay quarantined.
  const keptOff = (required.state.keptOff ?? []).filter(unit => !enabledUnits.has(unit));
  fs.writeFileSync(path.join(required.root, ".archive-state.json"), JSON.stringify({ ...required.state, keptOff }), { mode: 0o600 });
  return placeImportedMemory({ root: required.root, dir: required.dir, files: required.files, workspace, pluginIds: new Set(installed.map(plugin => plugin.pluginId)), validatePath: deps.validatePath });
}

/**
 * The activation an imported agent plugin writes onto this install's own bundled code.
 * - This install ships the same id under a different digest (the source ran another build
 *   version) and the copy was not edited: carry the operator's choice by id, including an
 *   explicit `false` so later boots preserve it. The imported code stays quarantined.
 * - Otherwise only bundled-identical, trusted code carries the source's `enabled` over; an
 *   unrecognised or edited version explicitly stays off.
 * `trusted` already excludes edited units.
 */
function importedActivation(required: { plugin: ImportedArchivePlugin; installed: readonly InstalledPlugin[]; trusted: ReadonlySet<string>; edited: boolean }): boolean {
  const { plugin } = required;
  const local = required.installed.find(local => local.pluginId === plugin.id);
  if (local && local.archiveDigest !== plugin.digest && !required.edited) return plugin.enabled;
  return Boolean(local && required.trusted.has(plugin.id) && plugin.enabled);
}

/** Places imported agent-plugin memory for plugins installed here; returns the staged files it placed.
 * @complexity O(files + memory bytes). */
function placeImportedMemory(required: { root: string; dir: string; files: readonly string[]; workspace: MemoryDirs; pluginIds: ReadonlySet<string>; validatePath: (required: { path: string }) => void }): Set<string> {
  const placed = new Set<string>();
  for (const file of required.files) {
    const match = /^agent-plugins\/([^/]+)\/memory\/(notes|learned)\/(.+)$/.exec(file);
    if (!match || !required.pluginIds.has(match[1]!)) continue;
    const memoryDir = required.workspace.pluginMemoryDir({ pluginId: match[1]!, kind: match[2] as "notes" | "learned" });
    placed.add(file);
    writeExclusive({ root: required.dir, relative: path.relative(required.dir, path.join(memoryDir, match[3]!)), bytes: fs.readFileSync(path.join(required.root, file)), validatePath: required.validatePath });
  }
  return placed;
}
