/**
 * @file `seedBundledAgentPlugins()` — installs the Agent Plugins that ship WITH the host into a
 * workspace's own package store, and records each one INACTIVE until an operator says otherwise
 * (except the few core paths depend on, `BUNDLED_AGENT_PLUGINS_SEEDED_ENABLED`, which seed active).
 *
 * ---------------------------------------------------------------------------
 * "Bundled but inactive", concretely
 * ---------------------------------------------------------------------------
 * Bundled: the package's real files are tracked in this repository under `content/agent-plugins/<id>/`
 * and copied into `dist/` by `npm run build`, exactly like `content/themes/`. A fresh install has them
 * without downloading anything.
 *
 * Inactive: seeding writes `{ enabled: false, origin: "bundled" }` into the workspace's activation
 * record (`activation.ts`) BEFORE the package can be read by anything, and the two places that
 * consume installed plugins both consult that record:
 *
 * - `tool-registrations.ts` — will not register its `agent_plugin_<id>` tool;
 * - `resolve-agent-plugin-refs.ts` — refuses to inject it even if a composer chip pins it by id.
 *
 * (A third surface, `capability-source.ts`'s `capability_search` discovery, was gated here too
 * until that tool pair was removed 2026-08-26 — see
 * `ADS-memory/knowledge/2026-08-26-removed-capability-search.md`.)
 *
 * So "inactive" means genuinely unexecutable, not merely unadvertised: its skills never reach a
 * prompt, and its tools and MCP servers are never registered.
 *
 * It does NOT mean hidden from the operator. The admin Agent Plugins screen lists every installed
 * plugin, with an inactive one's switch shown off, so a bundled plugin can be found and turned on
 * there (owner decision, 2026-09-13; before it, that screen's default tab listed only active ones).
 * Listing only READS the activation record, so the "absent means active" hazard described below is
 * unaffected.
 *
 * ---------------------------------------------------------------------------
 * Why it runs on every boot
 * ---------------------------------------------------------------------------
 * Seeding is idempotent twice over: `installAgentPlugin` short-circuits when the content digest is
 * already published, and `recordBundledAgentPluginIfAbsent` never overwrites an existing decision.
 * Re-running it therefore costs one directory walk and one hash, and buys two things a one-shot
 * first-run seed would not:
 *
 * 1. A product upgrade that ships a NEW bundled plugin, or a NEW VERSION of one, reaches existing
 *    workspaces without a migration step.
 *
 *    The second half of that claim was FALSE IN EFFECT until 2026-09-18, and the correction is the
 *    reason `bundled-digests.ts` exists. The package store is content-addressed and nothing retires
 *    an entry, so a revised bundled plugin installs ALONGSIDE its predecessor rather than replacing
 *    it — after which both consumption surfaces refused the plugin outright as ambiguous
 *    (`resolve-agent-plugin-refs.ts`'s "refusing to guess which one to use",
 *    `tool-registrations.ts`'s `poisonedPluginIds`). An upgrade did reach the workspace; it also
 *    silently broke the plugin. What makes the claim true now is the ledger this function writes
 *    below: the seed RECORDS which digest this build published, so the read side has the build's own
 *    answer to "which one" instead of a guess. The superseded bytes stay on disk — see
 *    `bundled-digests.ts`'s header for why nothing is deleted, and this file's own report for what
 *    an operator still has to prune by hand.
 * 2. Deleting `activations.json` re-creates the bundled plugin's DISABLED record. Without the
 *    re-run, deleting that file would silently promote every bundled plugin to active, because
 *    `isAgentPluginActive`'s "absent means active" default is what keeps operator-installed plugins
 *    working. The boot-time re-seed is what closes that direction.
 *
 *    A file that is PRESENT but unreadable is a different case from a deleted one, and is not
 *    treated the same way (t91 F1.1, 2026-09-16): seeding refuses outright rather than install
 *    around the fault, and every bundled plugin comes back `failed` with the recovery text
 *    `activation.ts`'s `AgentPluginActivationsUnreadableError` gives — see this file's header,
 *    "Failure isolation" below, and `activation.ts`'s own header, "Writers never rewrite what they
 *    could not read".
 *
 * ---------------------------------------------------------------------------
 * Failure isolation
 * ---------------------------------------------------------------------------
 * One unusable bundled package must never stop a workspace from booting or hide the others. Each is
 * seeded independently and its failure is captured into the returned report, not thrown. The caller
 * decides whether to log it; nothing here writes to the console, so this stays a pure-ish function
 * a test can assert on directly.
 *
 * Architectural role:
 * Composition over `bundled-source-archive.ts` (directory to archive), `install.ts`
 * (`installAgentPlugin`, where every extraction guarantee lives), and `activation.ts` (the record).
 * No guarantee of its own.
 */
import type { WorkspaceMigrationOwnership } from '../../core/persistent-state.js';
import { createPersistentStateModule } from "./persistent-state.js";
/** Extracted from the host plugin lifecycle. Effects are supplied per host context. */
import type { Dirent } from "node:fs";
import path from "node:path";
import { describeErrorForLog } from "@jini-ai/core";
import { AgentPluginInstallError, type AgentPluginInstallErrorCode } from "./install-errors.js";
import { createActivationModule } from "./activation.js";
import { createBundledDigestsModule } from "./bundled-digests.js";
import { createBundledSourceArchiveModule } from "./bundled-source-archive.js";
import type { PackAgentPluginDirectoryOptional } from "./bundled-source-archive.js";
import { createInstallModule } from "./install.js";
import type {  RetiredAgentPluginOutcome } from "./retire-bundled.js";
import { createRetireBundledModule } from "./retire-bundled.js";
import type { AgentPluginLifecyclePorts } from "./ports.js";
import type { AgentPluginLayout } from "@jini-ai/core/contracts/site/agent-plugins-lifecycle";

export type SeededAgentPluginOutcome =
  | {
      readonly pluginId: string;
      readonly status: "seeded";
      readonly archiveDigest: string;

      /** True when this boot wrote the initial record (disabled, or enabled for
       *  {@link BUNDLED_AGENT_PLUGINS_SEEDED_ENABLED}); false when a decision already existed and was
       *  preserved. */
  readonly activationRecorded: boolean;
    }
  | { readonly pluginId: string; readonly status: "failed"; readonly reason: string };

/** Host packing policy resolved independently for each source; failures use the existing seed report. */
export type PackingForSource = (
  required: { sourceDir: string; dirName: string },
  optional?: Record<string, never>,
) => PackAgentPluginDirectoryOptional | Promise<PackAgentPluginDirectoryOptional>;

export interface SeedBundledAgentPluginsOptional {
  readonly packing?: PackAgentPluginDirectoryOptional | PackingForSource;
  /** The caller holds this workspace's migration lock; the nested migration runs under it. */
  readonly ownership?: WorkspaceMigrationOwnership;
  /** Bundled ids a maintenance step refused to clear (id -> plain-words reason). Each is reported
   *  failed with that reason and never reaches install, so no alternate path can admit it. */
  readonly heldPluginIds?: ReadonlyMap<string, string>;
}

export interface SeedBundledAgentPluginsResult {
  /** Directory holding one subdirectory per bundled plugin. `deps.ts`'s `bundledAgentPluginsDir()`
   *  in production. */
  readonly sourceRoot: string;
  readonly outcomes: readonly SeededAgentPluginOutcome[];

  /** Why this boot could not record which digest it published for each plugin
   *  (`bundled-digests.ts`), or absent when it did. Reported rather than thrown, for the same
   *  failure-isolation reason every per-plugin failure is: a workspace whose ledger cannot be
   *  written still has every package installed and every activation decision intact — it only falls
   *  back to refusing a multi-digest plugin id, which is exactly the behaviour that predates the
   *  ledger. */
  readonly ledgerFailure?: (string) | undefined;

  /** One outcome per retired bundled plugin (`retire-bundled.ts`), run after seeding and the ledger so
   *  each successor's own record already exists. Empty when the activation pre-flight refused. */
  readonly retirements: readonly RetiredAgentPluginOutcome[];
}

export interface SeedBundledAgentPluginsRequired {

  /** The INSTANCE-level layout (`resolveAgentPluginLayout()`), not a pre-resolved workspace one —
   *  `installAgentPlugin` resolves `forWorkspace(workspaceId)` itself, atomically, and this
   *  function passes both through unchanged so that guarantee is not weakened in transit. See
   *  `install.ts`'s SECURITY note on `InstallAgentPluginRequired.layout`. */
  readonly layout: AgentPluginLayout;
  readonly workspaceId: string;

  readonly sourceRoot: string;
}

/**
 * Installs every bundled Agent Plugin into one workspace and records each inactive-by-default,
 * except {@link BUNDLED_AGENT_PLUGINS_SEEDED_ENABLED}.
 *
 * @returns A per-plugin report. An absent or unreadable `sourceRoot` yields an empty `outcomes`
 * list rather than an error: a build that shipped no bundled plugins is a legitimate configuration,
 * and a self-hosted operator who deleted the directory has made a choice this function should not
 * override by crashing.
 * @throws Nothing. Every per-plugin failure is captured into the report.
 * @complexity O(p) plugins, each O(f) files and O(b) bytes — all bounded by
 * `bundled-source-archive.ts`'s file cap and `install.ts`'s own byte caps.
 */
// The migration must finish before new installs, including bundled packages, are published.
// Rejected legacy entries are preserved in quarantine and count as handled. An incomplete run
// means a move/quarantine failed; a held lock also refuses seeding until migration can finish.
// ONE strict pre-flight read BEFORE any install — so a bundled package never lands on disk
// without the activation record that would keep it inactive (this file's header). Every bundled
// plugin is reported failed with the SAME reason, rather than attempting each one and hitting the
// identical fault p times.
// AFTER every install, never before: the ledger names digests, and a digest is only worth naming
// once its bytes are actually on disk for this workspace.
// AFTER seeding and the ledger: a retired plugin's successor is itself bundled, so its record and
// its ledger entry exist by now, and the retirement only has to decide whether to switch it on.
// A successor whose seed FAILED has neither; `retire-bundled.ts` then keeps the retired plugin
// rather than remove it in favour of a switch with no code behind it (its header, step 1a).
/**
 * Runs the layout migration that must precede seeding: the host's hook when it supplies one, else
 * the default persistent-state migration. A caller already holding the workspace migration lock
 * passes its ownership so the nested migration runs under it instead of reacquiring the lock.
 * @complexity O(1) here; the migration itself is O(installed plugins).
 */
function migrateBeforeSeeding(
  { ports, layout, workspaceId }: { ports: AgentPluginLifecyclePorts; layout: SeedBundledAgentPluginsRequired["layout"]; workspaceId: string },
  held: { ownership?: WorkspaceMigrationOwnership } = {},
) {
  return ports.migrateBeforeSeed
    ? ports.migrateBeforeSeed({ layout, workspaceId }, held)
    : createPersistentStateModule(ports).migrate({ workspaceRoot: layout.forWorkspace({ workspaceId }).root }, held);
}

async function seedBundledAgentPlugins({ ports, required }: {
  ports: AgentPluginLifecyclePorts;
  required: SeedBundledAgentPluginsRequired;
}, optional: SeedBundledAgentPluginsOptional = {}): Promise<SeedBundledAgentPluginsResult> {
  const { layout, workspaceId, sourceRoot } = required;

  const pluginDirNames = await listBundledPluginDirs({ ports, sourceRoot });
  try {
    const migration = await migrateBeforeSeeding({ ports, layout, workspaceId }, optional.ownership ? { ownership: optional.ownership } : {});
    if (!migration.complete) throw new Error('Legacy plugin layout migration has unfinished filesystem moves; see boot log');
  } catch (error) {
    const reason = describeSeedFailure({ err: error });
    return { sourceRoot, outcomes: pluginDirNames.map(pluginId => ({ pluginId, status: 'failed' as const, reason })), retirements: [] };
  }

  const refusal = await activationsRefusal({ ports, layout, workspaceId });
  if (refusal !== undefined) {
    return {
      sourceRoot,
      outcomes: pluginDirNames.map((dirName): SeededAgentPluginOutcome => ({ pluginId: dirName, status: "failed", reason: refusal })),
      retirements: [],
    };
  }

  const outcomes: SeededAgentPluginOutcome[] = [];
  for (const dirName of pluginDirNames) {
    const heldReason = optional.heldPluginIds?.get(dirName);
    if (heldReason !== undefined) { outcomes.push({ pluginId: dirName, status: "failed", reason: heldReason }); continue; }
    outcomes.push(await seedOne({
      ports,
      args: { layout, workspaceId, sourceDir: path.join(sourceRoot, dirName), dirName },
    }, { optional }));
  }

  const ledgerFailure = await recordSeededDigests({ ports, workspaceRoot: layout.forWorkspace({ workspaceId }).root, outcomes });

  const retirements = await createRetireBundledModule(ports).retireBundledAgentPlugins({ layout, workspaceId });

  return { sourceRoot, outcomes, retirements, ...(ledgerFailure !== undefined ? { ledgerFailure } : {}) };
}

/** Records which digest this boot published for each plugin that seeded successfully, and returns
 *  why it could not, rather than throwing — {@link seedBundledAgentPlugins}'s own contract is
 *  "@throws Nothing", and a ledger this boot failed to write costs the workspace nothing it had
 *  before the ledger existed.
 *  @complexity One file read and one atomic write. */
async function recordSeededDigests({ ports, workspaceRoot, outcomes }: {
  ports: AgentPluginLifecyclePorts;
  workspaceRoot: string;
  outcomes: readonly SeededAgentPluginOutcome[];
}): Promise<string | undefined> {
  try {
    await createBundledDigestsModule(ports).recordBundledAgentPluginDigests({
      workspaceRoot,
      seeded: outcomes.flatMap((outcome) =>
        outcome.status === "seeded" ? [{ pluginId: outcome.pluginId, archiveDigest: outcome.archiveDigest }] : [],
      ),
    });
    return undefined;
  } catch (error) {
    return describeErrorForLog({ err: error });
  }
}

/** Why nothing may be seeded into this workspace right now, or `undefined`. One strict read BEFORE
 *  any install, so a bundled package never lands on disk without the record that keeps it inactive.
 *  Catches everything (including `forWorkspace`'s own throw) to keep this function's own contract
 *  "@throws Nothing", matching {@link seedBundledAgentPlugins}'s own guarantee.
 *  @complexity One file read. */
async function activationsRefusal({ ports, layout, workspaceId }: {
  ports: AgentPluginLifecyclePorts;
  layout: AgentPluginLayout;
  workspaceId: string;
}): Promise<string | undefined> {
  try {
    await createActivationModule(ports).assertAgentPluginActivationsWritable(layout.forWorkspace({ workspaceId }).root);
    return undefined;
  } catch (error) {
    return describeErrorForLog({ err: error });
  }
}

// The plugin's OWN manifest name, not the directory name — `install.ts` reads the id from
// `plugin.json`, and every consumer keys activation off that same id. Using the folder name
// here would produce a record nothing ever consults if the two ever disagreed.
async function seedOne({ ports, args }: {
  ports: AgentPluginLifecyclePorts;
  args: {
  readonly layout: AgentPluginLayout;
  readonly workspaceId: string;
  readonly sourceDir: string;
  readonly dirName: string;
};
}, { optional = {} }: {
  optional?: SeedBundledAgentPluginsOptional;
} = {}): Promise<SeededAgentPluginOutcome> {
  try {
    const packing = typeof optional.packing === 'function'
      ? await optional.packing({ sourceDir: args.sourceDir, dirName: args.dirName }, {}) : optional.packing;
    const packed = await createBundledSourceArchiveModule(ports).packAgentPluginDirectory(args.sourceDir, packing);
    // No revision pruning here, not even of the digest the ledger recorded last boot: that digest
    // names the bytes this build once published, not what is on disk now, so an operator edit
    // under it would be deleted. Every same-name copy stays; the ledger selects this build's.
    const installed = await createInstallModule(ports).installAgentPlugin({
      archive: packed.bytes,
      expectedSha256: packed.sha256,
      archiveReader: packed.archiveReader ?? createBundledSourceArchiveModule(ports).createBundledSourceArchiveReader(),
      layout: args.layout,
      workspaceId: args.workspaceId,
    }, { pruneSupersededRevisions: false });

    const { recorded } = await createActivationModule(ports).recordBundledAgentPluginIfAbsent(
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
      reason: describeSeedFailure({ err: error }),
    };
  }
}

/** Safe, fixed boot-log copy per install error code. `AgentPluginInstallError.message` is written for
 *  the installing caller and can embed a local path (`PUBLISH_FAILED` names the publish target), so the
 *  log carries this copy instead; `Record` makes a newly added code a compile error until it has copy. */
const SAFE_INSTALL_FAILURE_COPY: Record<AgentPluginInstallErrorCode, string> = {
  PLUGIN_ID_CONFLICT: "The plugin id is already installed from different contents.",
  ARCHIVE_TOO_LARGE: "The plugin archive is too large.",
  DIGEST_MISMATCH: "The plugin archive does not match its expected digest.",
  TOO_MANY_ENTRIES: "The plugin archive has too many entries.",
  UNSAFE_ENTRY_PATH: "The plugin archive has an unsafe entry path.",
  SYMLINK_ENTRY_REJECTED: "The plugin archive contains a symbolic link.",
  UNSUPPORTED_ENTRY_KIND: "The plugin archive contains an unsupported entry.",
  DUPLICATE_ENTRY: "The plugin archive has a duplicate entry.",
  FILE_TOO_LARGE: "The plugin archive has a file that is too large.",
  DECOMPRESSION_BOMB: "The plugin archive expands beyond its safe limit.",
  TOTAL_SIZE_EXCEEDED: "The plugin archive expands beyond its total size limit.",
  MANIFEST_MISSING: "The plugin manifest is missing.",
  MANIFEST_INVALID: "The plugin manifest is invalid.",
  PUBLISH_FAILED: "The plugin package could not be published.",
};

/** The reason a bundled plugin failed to seed, for the boot log. An install error logs its code with
 *  fixed safe copy for that code (never its message, which can carry a local path); the core describer
 *  has no vocabulary for this class and would print a bare "Error". Everything else keeps the core
 *  describer's class-only line. @complexity O(1). */
function describeSeedFailure({ err }: { err: unknown }, _optional = {}): string {
  if (err instanceof AgentPluginInstallError) return `${err.code}: ${SAFE_INSTALL_FAILURE_COPY[err.code] ?? "The plugin could not be installed."}`;
  return describeErrorForLog({ err });
}

/**
 * Lists the subdirectories of `sourceRoot` that actually look like Agent Plugin packages (they hold
 * a `plugin.json` at their own root, which is where `indexInstalledRoot` looks for it).
 *
 * Filtering here rather than letting the installer reject them keeps a stray `README.md` or an
 * editor's scratch directory from showing up in the report as a failed plugin.
 *
 * @complexity O(d) in the subdirectory count.
 */
// A retired id is never seeded, even from a stale build that still carries its directory —
// otherwise every boot would reinstall it only for `retire-bundled.ts` to remove it again.
async function listBundledPluginDirs({ ports, sourceRoot }: {
  ports: AgentPluginLifecyclePorts;
  sourceRoot: string;
}): Promise<readonly string[]> {
  let entries: Dirent[];
  try {
    entries = await ports.filesystem.readdir(sourceRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const dirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || ports.retiredBundledPlugins.has(entry.name)) continue;
    try {
      const manifest = await ports.filesystem.stat(path.join(sourceRoot, entry.name, "plugin.json"));
      if (manifest.isFile()) dirs.push(entry.name);
    } catch {
      // No plugin.json: not a package. Silently skipped — see this function's own doc.
    }
  }
  return dirs.sort();
}

function buildModule(ports: AgentPluginLifecyclePorts) {
  return {
    seedBundledAgentPlugins: (required: SeedBundledAgentPluginsRequired, optional: SeedBundledAgentPluginsOptional = {}) => seedBundledAgentPlugins({ ports, required }, optional),
  };
}

const instances = new WeakMap<AgentPluginLifecyclePorts, ReturnType<typeof buildModule>>();
/** Internal composition; one state/queue instance per injected host context. */
export function createSeedBundledModule(ports: AgentPluginLifecyclePorts, _optional: Record<string, never> = {}) {
  let instance = instances.get(ports);
  if (!instance) { instance = buildModule(ports); instances.set(ports, instance); }
  return instance;
}
