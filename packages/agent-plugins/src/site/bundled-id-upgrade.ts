/**
 * @file Bundled plugin publisher-ID upgrade: a host maintenance step with verified bundled replacements.
 *
 * A bundled package set can move to a new publisher id while its local name (the activation key) does
 * not change. The install admission then sees a different publisher in the same slot and refuses the
 * canonical package (`PLUGIN_ID_CONFLICT`). Without this step every existing site keeps its
 * pre-rename copy forever and logs one seed failure per plugin per boot. The host injects the rename
 * map (`renamed`: local id -> pre-rename and canonical publisher-qualified ids) and the held-reason
 * wording for a copy its own build did not install.
 *
 * The step runs just before seeding. For each renamed local id it moves the installed pre-rename
 * revision out of the live package root, but only when that revision is PROVABLY the one the host's
 * build shipped:
 * 1. its manifest declares exactly the pre-rename id, not some other publisher;
 * 2. its digest is the one the bundled-digest ledger recorded, i.e. the host build's own seed put it
 *    there (an upload or a different build's copy is not in the ledger);
 * 3. re-packing its files reproduces that digest, so nobody edited it after install;
 * 4. this build's bundled source really ships the canonical id, so seeding has a replacement.
 * Anything else is left exactly where it is and reported in plain words; the site keeps using it.
 *
 * Only the package bytes move. Activation is keyed by the short name and the plugin's `data/` and
 * `memory/` folders sit beside `package/`, so the owner's switch, settings, data and memory stay.
 * The moved copy is kept under `<workspace>/.bundled-id-upgrade/<id>/<digest>` (dot-prefixed, so the
 * package index never reads it as a plugin) and is put back when the replacement does not seed.
 */
import path from "node:path";
import type { FilesystemPort } from "../lifecycle/index.js";

/** Local id -> the pre-rename and canonical publisher-qualified ids. */
export type BundledPluginRenames = ReadonlyMap<string, { readonly from: string; readonly to: string }>;

/** Folder (inside the workspace root) holding moved pre-rename revisions. */
export const BUNDLED_ID_UPGRADE_BACKUP_DIRNAME = ".bundled-id-upgrade";

/** One installed revision, as the lifecycle owner indexes it. */
export interface InstalledRevision {
  readonly pluginId: string;
  readonly id?: string | undefined;
  readonly archiveDigest: string;
  readonly packageRoot: string;
}

/** The lifecycle reads and the one filesystem move this step needs, injected by the host's lifecycle binding. */
export interface BundledIdUpgradePort {
  readonly listInstalledPlugins: (required: { workspaceRoot: string }) => Promise<readonly InstalledRevision[]>;
  readonly readBundledAgentPluginDigests: (required: { workspaceRoot: string }) => Promise<ReadonlyMap<string, string>>;
  readonly packAgentPluginDirectory: (required: { sourceDir: string }) => Promise<{ readonly sha256: string }>;
  /** Raw `plugin.json` text of this build's bundled source for one local id. */
  readonly readBundledSourceManifest: (required: { pluginId: string }) => Promise<string>;
  readonly filesystem: Pick<FilesystemPort, "chmod" | "mkdir" | "rename" | "stat">;
}

/** A moved revision: where it lived and where its saved copy is now. */
export interface MovedRevision { readonly packageRoot: string; readonly savedAt: string }

export type BundledIdUpgradeOutcome =
  | { readonly status: "upgraded"; readonly pluginId: string; readonly to: string; readonly moved: readonly MovedRevision[] }
  | { readonly status: "held"; readonly pluginId: string; readonly to: string; readonly reason: string }
  | { readonly status: "restored"; readonly pluginId: string; readonly to: string; readonly moved: readonly MovedRevision[] };

/**
 * Moves every verified pre-rename bundled revision aside so seeding installs its canonical package.
 * @param required.renamed - The host's rename map (it owns which ids moved).
 * @returns One outcome per renamed plugin that still has a pre-rename revision installed; empty
 * (after one directory listing) once a site is upgraded.
 * @throws Nothing for a single plugin: its fault becomes a `held` outcome. Listing faults propagate
 * to the caller, which treats the whole step as optional.
 * @complexity O(r) revisions listed; O(f) file reads to re-pack each candidate revision.
 */
export async function upgradeRenamedBundledPlugins(
  required: {
    readonly workspaceRoot: string; readonly port: BundledIdUpgradePort; readonly renamed: BundledPluginRenames;
    /** Host wording for a revision whose digest the bundled ledger does not name (not installed by the host's own build). */
    readonly ledgerMismatchReason: string;
  },
  _optional: Record<string, never> = {},
): Promise<BundledIdUpgradeOutcome[]> {
  const { renamed } = required;
  const installed = await required.port.listInstalledPlugins({ workspaceRoot: required.workspaceRoot });
  const blocked = [...renamed].filter(([pluginId, ids]) => blockersOf({ installed, pluginId, to: ids.to }).length > 0);
  if (blocked.length === 0) return [];
  const ledger = await required.port.readBundledAgentPluginDigests({ workspaceRoot: required.workspaceRoot });
  const outcomes: BundledIdUpgradeOutcome[] = [];
  for (const [pluginId, ids] of blocked) {
    const outcome = await upgradeOne({ workspaceRoot: required.workspaceRoot, port: required.port, ledgerMismatchReason: required.ledgerMismatchReason, ledger, pluginId, ids, blockers: blockersOf({ installed, pluginId, to: ids.to }) })
      .catch((): BundledIdUpgradeOutcome => ({ status: "held", pluginId, to: ids.to, reason: "its installed copy could not be checked" }));
    if (outcome !== undefined) outcomes.push(outcome);
  }
  return outcomes;
}

/** Same-slot revisions that would make Jini refuse the canonical id. */
function blockersOf({ installed, pluginId, to }: { installed: readonly InstalledRevision[]; pluginId: string; to: string }): InstalledRevision[] {
  return installed.filter(revision => revision.pluginId === pluginId && revision.id !== to);
}

/** Verifies every blocker of one plugin, then moves them all, or none. `undefined`: this build does
 * not ship the canonical package, so seeding will not try it and nothing needs to move. */
async function upgradeOne(input: {
  readonly workspaceRoot: string; readonly port: BundledIdUpgradePort; readonly ledger: ReadonlyMap<string, string>; readonly ledgerMismatchReason: string;
  readonly pluginId: string; readonly ids: { readonly from: string; readonly to: string }; readonly blockers: readonly InstalledRevision[];
}): Promise<BundledIdUpgradeOutcome | undefined> {
  const { port, pluginId, ids } = input;
  if (await bundledSourceId({ port, pluginId }) !== ids.to) return undefined;
  for (const revision of input.blockers) {
    const reason = await unverifiedReason({ port, ledger: input.ledger, ledgerMismatchReason: input.ledgerMismatchReason, revision, from: ids.from });
    if (reason !== undefined) return { status: "held", pluginId, to: ids.to, reason };
  }
  const moved: MovedRevision[] = [];
  for (const revision of input.blockers) {
    const savedAt = path.join(input.workspaceRoot, BUNDLED_ID_UPGRADE_BACKUP_DIRNAME, pluginId, revision.archiveDigest);
    await moveFrozenTree({ filesystem: port.filesystem, from: revision.packageRoot, to: savedAt });
    moved.push({ packageRoot: revision.packageRoot, savedAt });
  }
  return { status: "upgraded", pluginId, to: ids.to, moved };
}

/** The qualified id this build's bundled source declares for one local id, if any. */
async function bundledSourceId({ port, pluginId }: { port: BundledIdUpgradePort; pluginId: string }): Promise<string | undefined> {
  let manifest: { extensions?: { jini?: { id?: unknown } } };
  try { manifest = JSON.parse(await port.readBundledSourceManifest({ pluginId })); } catch { return undefined; }
  const id = manifest.extensions?.jini?.id;
  return typeof id === "string" ? id : undefined;
}

/** Why one installed revision cannot be proven to be the pre-rename copy the host's build shipped. */
async function unverifiedReason({ port, ledger, ledgerMismatchReason, revision, from }: {
  port: BundledIdUpgradePort; ledger: ReadonlyMap<string, string>; ledgerMismatchReason: string; revision: InstalledRevision; from: string;
}): Promise<string | undefined> {
  if (revision.id !== from) return `its installed copy is published as '${revision.id ?? "an unnamed publisher"}', not '${from}'`;
  if (ledger.get(revision.pluginId) !== revision.archiveDigest) return ledgerMismatchReason;
  const repacked = await port.packAgentPluginDirectory({ sourceDir: revision.packageRoot });
  if (repacked.sha256 !== revision.archiveDigest) return "its installed files were changed after install";
  return undefined;
}

/** Puts back the revisions of every upgrade whose canonical package did not seed, so the site keeps
 * the copy it had rather than no copy at all. A failed put-back leaves the saved copy in place.
 * @complexity O(m) renames for m moved revisions. */
export async function restoreUnseededUpgrades(
  required: { readonly outcomes: readonly BundledIdUpgradeOutcome[]; readonly seededIds: ReadonlySet<string>; readonly filesystem: BundledIdUpgradePort["filesystem"] },
  _optional: Record<string, never> = {},
): Promise<BundledIdUpgradeOutcome[]> {
  const result: BundledIdUpgradeOutcome[] = [];
  for (const outcome of required.outcomes) {
    if (outcome.status !== "upgraded" || required.seededIds.has(outcome.pluginId)) { result.push(outcome); continue; }
    for (const revision of outcome.moved) {
      await moveFrozenTree({ filesystem: required.filesystem, from: revision.savedAt, to: revision.packageRoot }).catch(() => undefined);
    }
    result.push({ ...outcome, status: "restored" });
  }
  return result;
}

/** Renames a frozen (0o555) package tree: a directory move needs write permission on the directory
 * itself, so it is opened for the move and its original mode put back afterwards. */
async function moveFrozenTree({ filesystem, from, to }: { filesystem: BundledIdUpgradePort["filesystem"]; from: string; to: string }): Promise<void> {
  const mode = (await filesystem.stat(from)).mode & 0o777;
  await filesystem.mkdir(path.dirname(to), { recursive: true, mode: 0o700 });
  await filesystem.chmod(from, mode | 0o700);
  try {
    await filesystem.rename(from, to);
  } catch (error) {
    await filesystem.chmod(from, mode).catch(() => undefined);
    throw error;
  }
  await filesystem.chmod(to, mode).catch(() => undefined);
}
