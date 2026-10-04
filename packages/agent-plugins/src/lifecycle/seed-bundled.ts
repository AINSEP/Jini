import { createPersistentStateModule } from "./persistent-state.js";
/** Extracted from the host plugin lifecycle. Effects are supplied per host context. */
import type { Dirent } from "node:fs";
import path from "node:path";
import { createActivationModule } from "./activation.js";
import { createBundledDigestsModule } from "./bundled-digests.js";
import { createBundledSourceArchiveModule } from "./bundled-source-archive.js";
import { createInstallModule } from "./install.js";
import type { AgentPluginLayout } from "./layout.js";
import { type RetiredAgentPluginOutcome } from "./retire-bundled.js";
import { createRetireBundledModule } from "./retire-bundled.js";
import type { AgentPluginLifecyclePorts } from "./ports.js";

export type SeededAgentPluginOutcome =
  | {
      readonly pluginId: string;
      readonly status: "seeded";
      readonly archiveDigest: string;

      readonly activationRecorded: boolean;
    }
  | { readonly pluginId: string; readonly status: "failed"; readonly reason: string };

export interface SeedBundledAgentPluginsResult {
  readonly sourceRoot: string;
  readonly outcomes: readonly SeededAgentPluginOutcome[];

  readonly ledgerFailure?: (string) | undefined;

  readonly retirements: readonly RetiredAgentPluginOutcome[];
}

export interface SeedBundledAgentPluginsRequired {

  readonly layout: AgentPluginLayout;
  readonly workspaceId: string;

  readonly sourceRoot: string;
}

function buildModule(ports: AgentPluginLifecyclePorts) {
  const readdir = ports.filesystem.readdir.bind(ports.filesystem);
  const stat = ports.filesystem.stat.bind(ports.filesystem);
  const { assertAgentPluginActivationsWritable, recordBundledAgentPluginIfAbsent } = createActivationModule(ports);
  const { recordBundledAgentPluginDigests } = createBundledDigestsModule(ports);
  const { createBundledSourceArchiveReader, packAgentPluginDirectory } = createBundledSourceArchiveModule(ports);
  const { installAgentPlugin } = createInstallModule(ports);
  const { retireBundledAgentPlugins } = createRetireBundledModule(ports);
  async function seedBundledAgentPlugins(
    required: SeedBundledAgentPluginsRequired,
  ): Promise<SeedBundledAgentPluginsResult> {
    const { layout, workspaceId, sourceRoot } = required;

    const pluginDirNames = await listBundledPluginDirs(sourceRoot);
    try {
      const migration = await createPersistentStateModule(ports).migrate({ workspaceRoot: layout.forWorkspace({ workspaceId }).root });
      if (!migration.complete) throw new Error('Legacy plugin migration incomplete; see migration events');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { sourceRoot, outcomes: pluginDirNames.map(pluginId => ({ pluginId, status: 'failed' as const, reason })), retirements: [] };
    }

    const refusal = await activationsRefusal(layout, workspaceId);
    if (refusal !== undefined) {
      return {
        sourceRoot,
        outcomes: pluginDirNames.map((dirName): SeededAgentPluginOutcome => ({ pluginId: dirName, status: "failed", reason: refusal })),
        retirements: [],
      };
    }

    const outcomes: SeededAgentPluginOutcome[] = [];
    for (const dirName of pluginDirNames) {
      outcomes.push(await seedOne({ layout, workspaceId, sourceDir: path.join(sourceRoot, dirName), dirName }));
    }

    const ledgerFailure = await recordSeededDigests(layout.forWorkspace({ workspaceId }).root, outcomes);

    const retirements = await retireBundledAgentPlugins({ layout, workspaceId });

    return { sourceRoot, outcomes, retirements, ...(ledgerFailure !== undefined ? { ledgerFailure } : {}) };
  }

  async function recordSeededDigests(
    workspaceRoot: string,
    outcomes: readonly SeededAgentPluginOutcome[],
  ): Promise<string | undefined> {
    try {
      await recordBundledAgentPluginDigests({
        workspaceRoot,
        seeded: outcomes.flatMap((outcome) =>
          outcome.status === "seeded" ? [{ pluginId: outcome.pluginId, archiveDigest: outcome.archiveDigest }] : [],
        ),
      });
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  async function activationsRefusal(layout: AgentPluginLayout, workspaceId: string): Promise<string | undefined> {
    try {
      await assertAgentPluginActivationsWritable(layout.forWorkspace({ workspaceId }).root);
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  async function seedOne(args: {
    readonly layout: AgentPluginLayout;
    readonly workspaceId: string;
    readonly sourceDir: string;
    readonly dirName: string;
  }): Promise<SeededAgentPluginOutcome> {
    try {
      const packed = await packAgentPluginDirectory(args.sourceDir);
      const installed = await installAgentPlugin({
        archive: packed.bytes,
        expectedSha256: packed.sha256,
        archiveReader: createBundledSourceArchiveReader(),
        layout: args.layout,
        workspaceId: args.workspaceId,
      });

      const { recorded } = await recordBundledAgentPluginIfAbsent(
        { workspaceRoot: args.layout.forWorkspace({ workspaceId: args.workspaceId }).root, pluginId: installed.pluginId },
        { enabled: ports.seededEnabledPluginIds.has(installed.pluginId) },
      );

      return {
        pluginId: installed.pluginId,
        status: "seeded",
        archiveDigest: installed.archiveDigest,
        activationRecorded: recorded,
      };
    } catch (error) {
      return {
        pluginId: args.dirName,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function listBundledPluginDirs(sourceRoot: string): Promise<readonly string[]> {
    let entries: Dirent[];
    try {
      entries = await readdir(sourceRoot, { withFileTypes: true });
    } catch {
      return [];
    }

    const dirs: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      if (ports.retiredBundledPlugins.has(entry.name)) continue;
      try {
        const manifest = await stat(path.join(sourceRoot, entry.name, "plugin.json"));
        if (manifest.isFile()) dirs.push(entry.name);
      } catch {

      }
    }
    return dirs.sort();
  }

  return { seedBundledAgentPlugins };
}

const instances = new WeakMap<AgentPluginLifecyclePorts, ReturnType<typeof buildModule>>();
/** Internal composition; one state/queue instance per injected host context. */
export function createSeedBundledModule(ports: AgentPluginLifecyclePorts) {
  let instance = instances.get(ports);
  if (!instance) { instance = buildModule(ports); instances.set(ports, instance); }
  return instance;
}
