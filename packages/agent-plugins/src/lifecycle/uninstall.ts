/**
 * @file `uninstallAgentPlugin()` — permanently removes one workspace's installed Agent Plugin: its
 * on-disk package(s) under `packages/sha256/*` for this `pluginId`, then its activation record.
 * `previewAgentPluginUninstall()` runs the same refusals without removing anything.
 *
 * `packages/plugins/src/host/uninstall.ts` already has this exact feature for the OTHER plugin family
 * (the host runtime-plugin format site/runtime plugins) — this is "the same feature, one family over", mirroring its
 * shape: the same `<Domain>NotFoundError`/`<Domain>NotUninstallableError` pair, thrown for the same
 * two reasons (unknown id; nothing an operator can actually remove). Two deliberate divergences from
 * that file, both because the underlying mechanics genuinely differ, not by oversight:
 *
 * 1. **No third `PluginEnabledError`-equivalent precondition.** Plugin-runtime refuses to uninstall a
 *    plugin that is enabled in ANY workspace, because its on-disk artifact is INSTANCE-WIDE — shared
 *    across every workspace via one `installDir` — so removing it while a DIFFERENT workspace still
 *    has it enabled would silently break that workspace's runtime. Agent Plugins have no such
 *    hazard: `layout.ts`'s own header (owner decision, tenant-grade isolation, 2026-08-12) states
 *    plainly that each workspace gets its own `ws/<workspaceId>/packages/sha256/` tree, and "Uninstall
 *    is `rm -rf ws/<workspaceId>/packages/sha256/<digest>/`, full stop" — there is no OTHER workspace
 *    for this operation to endanger. Whether the CALLING workspace has this plugin currently enabled
 *    is not gated on either: disabling first buys no safety here (unlike plugin-runtime, disabling
 *    would not protect anyone else's runtime), and gating on it would only add friction with no
 *    corresponding risk removed.
 *
 * 2. **Bundled is refused as UNINSTALLABLE, not as NOT-FOUND — and for a different reason than
 *    plugin-runtime's built-ins.** Plugin-runtime's `PluginNotUninstallableError` covers a `"built-in"`
 *    discovery record that was never written to `installDir` at all — there is nothing on disk to
 *    remove. A bundled Agent Plugin is NOT that case: `seed-bundled.ts` genuinely extracts it onto
 *    disk at boot, so it IS `listInstalledPlugins`-visible and this function's own "not found" check
 *    would pass. The refusal here is about PERMANENCE, not presence: `recordBundledAgentPluginIfAbsent`
 *    re-seeds both the package and its (absent-record-only) disabled activation entry on every boot
 *    (`activation.ts`'s header), so deleting the files now would appear to succeed and then silently
 *    reappear on the next restart — a worse outcome than refusing outright, because it would look like
 *    uninstall lied. `AgentPluginNotUninstallableError`'s message says this plainly and names the
 *    levers that DO work: `plugins_set_enabled` with family `agent-plugin` (the assistant's own tool
 *    since a1abe2bb, so the model can act on the refusal itself) or the Agent Plugins admin screen's
 *    switch. Either one turns a bundled plugin off, even though nothing can make the host stop shipping it.
 *
 * ---------------------------------------------------------------------------
 * Preview, then uninstall — both run the refusals
 * ---------------------------------------------------------------------------
 * `agent_plugins_uninstall` asks a human before it removes anything. A refusal has to come back
 * BEFORE that dialog, or a human is asked to confirm something that cannot happen, so the tool calls
 * `previewAgentPluginUninstall()` first. The preview carries only what a dialog may show (id,
 * versions, digests) — never `packageRoot`, which is a host path. After the answer the tool calls
 * `uninstallAgentPlugin()`, which runs both refusals again against the disk as it is then: the
 * dialog can stay open for minutes. The tool also passes the confirmed preview back in: if the
 * installed digests for the id are no longer exactly the previewed ones (an archive added or removed
 * meanwhile), `uninstallAgentPlugin()` removes nothing and throws `AgentPluginChangedSincePreviewError`,
 * which the tool reports as a result.
 *
 * ---------------------------------------------------------------------------
 * Tombstone vs. delete on the activation record — DELETE, settled
 * ---------------------------------------------------------------------------
 * See `activation.ts`'s `deleteAgentPluginActivation()` for the mechanism; the decision itself
 * belongs here, next to the only call site that makes it. A tombstone (leaving `enabled: false` on
 * disk after the bytes are gone) would invert `activation.ts`'s own stated rule — "absent means
 * active, because an operator's own install IS the consent" — the moment this same plugin id is ever
 * reinstalled: the fresh install would inherit a stale disabled flag about bytes that no longer exist,
 * which is a worse UX than starting over. Deleting the record makes a future reinstall of this id
 * begin exactly where a first-ever install begins.
 *
 * ---------------------------------------------------------------------------
 * Why this module resolves its own workspace layout, rather than accepting one
 * ---------------------------------------------------------------------------
 * Same SECURITY discipline `install.ts`'s `InstallAgentPluginRequired.layout` documents in full: this
 * takes the INSTANCE-level `AgentPluginLayout` plus one `workspaceId`, and calls
 * `layout.forWorkspace(workspaceId)` itself, exactly once per call, so the packages directory it scans
 * and the activation file it edits can never come from two different, hand-stitched sources that
 * quietly disagree about which workspace they belong to.
 *
 * ---------------------------------------------------------------------------
 * Why removal isn't a plain `fs.rm(recursive)`
 * ---------------------------------------------------------------------------
 * `install.ts`'s `freezeTree` chmods every published package directory to `0o555` (no write bit) —
 * that's what makes the package genuinely read-only after install. A plain recursive `rm` on a frozen
 * tree fails EACCES trying to unlink/rmdir inside it (the same fact `__tests__/fixtures/force-remove.ts`
 * exists to work around in tests). `removeFrozenPackageTree` below is that same "restore write
 * permission, then remove" logic as real production code — this is the first production caller that
 * ever needs to remove a package root that install-time freezing already made.
 *
 * ---------------------------------------------------------------------------
 * Why removal stages first — and why it stages NEXT TO the package, not under `staging/`
 * ---------------------------------------------------------------------------
 * Removing a multi-digest plugin is several irreversible `rm`s followed by one activation-record
 * write. Done directly, a failure anywhere after the first `rm` leaves an installation that is
 * half-deleted and an activation record describing bytes that no longer exist — recoverable by
 * nobody. So every package root is first `rename`d aside (cheap, atomic within one filesystem, and
 * reversible), the activation record is deleted, and only then are the renamed trees actually
 * removed. Any failure before that last step puts every renamed tree straight back.
 *
 * Renaming a frozen package root needs its write bit back FIRST. `install.ts`'s own publish comment
 * records the measured fact this depends on: on this filesystem renaming an already-`0o555`
 * directory fails EACCES — and, re-measured here, that holds even when the rename stays inside the
 * same parent, so there is no permission-free way to move a frozen tree. `stageForRemoval` therefore
 * restores the owner write bit on the package ROOT only (never its contents), renames, and — on any
 * failure, including a rollback — puts the exact original mode back, so a failed uninstall leaves a
 * tree that is still frozen. That briefly-writable window is the same "accidental same-process
 * write" surface `freezeTree`'s own header scopes itself to, not a security boundary.
 *
 * The staged name is a SIBLING inside the same `packages/sha256/` directory rather than
 * `<workspaceRoot>/staging/` (which install uses for its own transactions): same parent means the
 * rename is guaranteed to be within one filesystem, and therefore atomic, without depending on a
 * second directory existing. The names begin with a dot and carry a random suffix, so they can never
 * be mistaken for an installed digest (`resolve-agent-plugin-refs.ts` matches `^[a-f0-9]{64}$`) nor
 * collide with a concurrent uninstall. A crash between the rename and the final remove strands a
 * `.uninstalling-*` directory an operator can delete — strictly better than a half-deleted install.
 */
/** Prefix for a staged (renamed-aside) package root. Leading dot plus a random suffix: never a
 *  valid installed-digest directory name, never colliding with a concurrent uninstall. */
import { createPersistentStateModule } from "./persistent-state.js";
/** Extracted from the host plugin lifecycle. Effects are supplied per host context. */
import type { Dirent } from "node:fs";
import path from "node:path";
import { createPackagePathsModule } from "./package-paths.js";
import { createActivationModule } from "./activation.js";
import { createResolveAgentPluginRefsModule } from "./resolve-agent-plugin-refs.js";
import { createAgentPluginUpdateStore, settleAgentPluginUpdateJournal } from "./update-store.js";
import type { AgentPluginLifecyclePorts } from "./ports.js";
import type { InstalledAgentPlugin, AgentPluginLayout } from "@jini-ai/core/contracts/site/agent-plugins-lifecycle";
import type { UninstallAgentPluginRequired, UninstallAgentPluginOptional, UninstallAgentPluginResult, AgentPluginUninstallPreview } from "@jini-ai/core/contracts/site/agent-plugins-lifecycle";

/** The plugin id has no installed package on disk for this workspace. */
export class AgentPluginNotFoundError extends Error {
  constructor({ message }: { readonly message: string }, optional: ErrorOptions = {}) { super(message, optional); }
}

/** The plugin is bundled with the host — see this file's header for why that is permanent, not merely
 *  "nothing to remove". */
export class AgentPluginNotUninstallableError extends Error {
  constructor({ message }: { readonly message: string }, optional: ErrorOptions = {}) { super(message, optional); }
}

/** The installed archives for this plugin id are no longer exactly the ones a confirmed preview listed —
 *  see `UninstallAgentPluginOptional.confirmedPreview`. Nothing was removed. */
export class AgentPluginChangedSincePreviewError extends Error {
  constructor({ message }: { readonly message: string }, optional: ErrorOptions = {}) { super(message, optional); }
}

/** A reversible staged package and its original permissions; shared by uninstall and replacement. */
/** One package root renamed aside, and what restoring it takes: the path it must go back to, and the
 *  mode it carried before staging unfroze its root directory. */
export interface StagedTree {
  readonly quarantined: string;
  readonly original: string;
  readonly originalMode: number;
}

/** The refusals both entry points share, plus what removal needs. Internal: `matches` carries host
 *  paths (`packageRoot`) and must not reach a preview. */
interface UninstallTargets {
  readonly workspaceRoot: string;

  /** `<workspaceRoot>/packages/sha256` — the parent every staged rename stays inside. */
  readonly packagesDir: string;
  readonly matches: readonly InstalledAgentPlugin[];
}

const STAGED_DIRNAME_PREFIX = ".uninstalling-";

/**
 * Reports what uninstalling `pluginId` would remove, without removing anything.
 *
 * @throws {AgentPluginNotFoundError} No installed package for `pluginId` exists in this workspace.
 * @throws {AgentPluginNotUninstallableError} The plugin's activation record has `origin: "bundled"`, or a malformed
 * entry for it (t91 R4).
 * @throws {AgentPluginActivationsUnreadableError} The activation record could not be read at all, so
 * whether it says "bundled" cannot be established — see `activation.ts`'s
 * `createActivationModule(ports).isAgentPluginRecordedAsBundled`.
 * @complexity O(d) in this workspace's installed-digest count (one `createResolveAgentPluginRefsModule(ports).listInstalledPlugins` walk).
 */
async function previewAgentPluginUninstall({ ports, required }: {
  ports: AgentPluginLifecyclePorts;
  required: UninstallAgentPluginRequired;
}): Promise<AgentPluginUninstallPreview> {
  const { matches } = await resolveUninstallTargets({ ports, required });
  const versions = [...new Set(matches.flatMap((plugin) => (plugin.version === undefined ? [] : [plugin.version])))];
  return { pluginId: required.pluginId, versions, archiveDigests: matches.map((plugin) => plugin.archiveDigest) };
}

/**
 * Uninstalls one workspace's installed Agent Plugin: removes every installed archive digest for
 * `pluginId` under this workspace's own `packages/sha256/`, then deletes its activation record.
 *
 * @throws {AgentPluginNotFoundError} No installed package for `pluginId` exists in this workspace.
 * @throws {AgentPluginNotUninstallableError} The plugin's activation record has `origin: "bundled"`, or a malformed
 * entry for it (t91 R4).
 * @throws {AgentPluginActivationsUnreadableError} The activation record could not be read — refused
 * before anything is staged, so nothing is removed.
 * @throws {AgentPluginChangedSincePreviewError} `optional.confirmedPreview` was given and the installed digests differ from it.
 * @throws Whatever the filesystem raised, after every staged tree has been put back — or, if a tree
 * could not be put back, an error naming the staged paths an operator must recover by hand.
 * @complexity O(d) in this workspace's installed-digest count (one `createResolveAgentPluginRefsModule(ports).listInstalledPlugins` walk) plus
 * O(f) in the total file count under the matching digest(s) being removed.
 */
async function uninstallAgentPlugin({ ports, required }: {
  ports: AgentPluginLifecyclePorts;
  required: UninstallAgentPluginRequired;
}, optional: UninstallAgentPluginOptional = {}): Promise<UninstallAgentPluginResult> {
  const workspaceRoot = required.layout.forWorkspace({ workspaceId: required.workspaceId }).root;
  return createPersistentStateModule(ports).withPluginLock({ workspaceRoot, pluginId: required.pluginId,
    run: () => uninstallAgentPluginUnlocked({ ports, required }, optional) });
}

async function uninstallAgentPluginUnlocked({ ports, required }: {
  ports: AgentPluginLifecyclePorts;
  required: UninstallAgentPluginRequired;
}, optional: UninstallAgentPluginOptional = {}): Promise<UninstallAgentPluginResult> {
  const { workspaceRoot, packagesDir, matches } = await resolveUninstallTargets({ ports, required }, { retiredBundled: optional.retiredBundled === true });
  assertUnchangedSincePreview({ pluginId: required.pluginId, confirmedPreview: optional.confirmedPreview, matches });
  assertMemoryDeletionConfirmed(required, optional);
  // An unfinished update journal would make boot recovery resurrect the old revision over this
  // uninstall, so it refuses (PLUGIN_UPDATE_PENDING) until a boot recovers it. The store resolves
  // paths from this call's own layout, like every other path here.
  const updates = createAgentPluginUpdateStore({ ports: { ...ports, layout: required.layout }, workspaceId: required.workspaceId, pluginId: required.pluginId });
  await settleAgentPluginUpdateJournal({ store: updates });

  const staged = await stageAndDeleteActivation(ports, { workspaceRoot, packagesDir, pluginId: required.pluginId, matches });

  // Past this point the live state is already settled: the packages are no longer reachable under
  // any installed-digest name and the activation record is gone. These removes are the only
  // irreversible step, and nothing observable depends on them finishing.
  for (const tree of staged) {
    await removeFrozenPackageTree({ ports, root: tree.quarantined });
  }

  await removeEmptyPackageAncestors(ports, { packagesDir });
  if (optional.deleteMemory) await deletePersistentMemory(ports, { ...required, workspaceRoot });
  return { pluginId: required.pluginId, removedDigests: matches.map((plugin) => plugin.archiveDigest) };
}

function assertMemoryDeletionConfirmed(required: UninstallAgentPluginRequired, optional: UninstallAgentPluginOptional): void {
  if (optional.deleteMemory && optional.confirmedPreview?.pluginId !== required.pluginId) {
    throw new Error('Deleting plugin memory requires a confirmed preview for this plugin');
  }
}

/** Reversible work first — see this file's header, "Why removal stages first". Nothing in here is
 *  destructive: every step up to and including the activation-record delete can be undone by
 *  renaming the staged trees back where they came from. */
async function stageAndDeleteActivation(ports: AgentPluginLifecyclePorts, required: {
  readonly workspaceRoot: string;
  readonly packagesDir: string;
  readonly pluginId: string;
  readonly matches: readonly InstalledAgentPlugin[];
}): Promise<readonly StagedTree[]> {
  const staged: StagedTree[] = [];
  try {
    for (const plugin of required.matches) {
      staged.push(await stageForRemoval({ ports, packagesDir: required.packagesDir, packageRoot: plugin.packageRoot }));
    }
    await createActivationModule(ports).deleteAgentPluginActivation({ workspaceRoot: required.workspaceRoot, pluginId: required.pluginId });
  } catch (error) {
    throw await restoreStagedTrees({ ports, staged, cause: error });
  }
  return staged;
}

/** Remove only empty package ancestors: a concurrently-installed digest must never be deleted. */
async function removeEmptyPackageAncestors(ports: AgentPluginLifecyclePorts, required: { readonly packagesDir: string }): Promise<void> {
  for (const directory of [required.packagesDir, path.dirname(required.packagesDir)]) {
    try { await ports.filesystem.rmdir(directory); } catch (error) {
      if (!isAncestorStillInUse(error)) throw error;
    }
  }
}

function isAncestorStillInUse(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && ['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(String(error.code));
}

/** No package may have appeared since this uninstall's preview. Preserve it on a race. */
async function deletePersistentMemory(ports: AgentPluginLifecyclePorts, required: UninstallAgentPluginRequired & { readonly workspaceRoot: string }): Promise<void> {
  const { workspaceRoot, pluginId } = required;
  const pluginRoot = required.layout.forWorkspace({ workspaceId: required.workspaceId }).pluginRootDir({ pluginId });
  await createPackagePathsModule(ports).assertContainedOnDisk(workspaceRoot, path.relative(workspaceRoot, pluginRoot));
  if ((await createResolveAgentPluginRefsModule(ports).listInstalledPlugins(workspaceRoot)).some(plugin => plugin.pluginId === pluginId)) throw new Error('Plugin was reinstalled during uninstall; persistent memory was kept');
  await ports.filesystem.rm(pluginRoot, { recursive: true, force: true });
}

/**
 * Refuses when the digests resolved now are not exactly the set a confirmed preview listed — an archive added
 * OR removed for this id while the dialog was open. Runs in the same call that stages the removal, so it opens
 * no new check-then-act gap of its own.
 *
 * @throws {AgentPluginChangedSincePreviewError} The two digest sets differ.
 * @complexity O(d log d) in the digest count.
 */
function assertUnchangedSincePreview({ pluginId, confirmedPreview, matches }: {
  pluginId: string;
  confirmedPreview: AgentPluginUninstallPreview | undefined;
  matches: readonly InstalledAgentPlugin[];
}): void {
  if (confirmedPreview === undefined) return;
  const previewed = [...confirmedPreview.archiveDigests].sort();
  const installedNow = matches.map((plugin) => plugin.archiveDigest).sort();
  if (previewed.join(",") === installedNow.join(",")) return;
  throw new AgentPluginChangedSincePreviewError({ message: `Agent Plugin '${pluginId}' changed after its uninstall was previewed (previewed archive digests: ${previewed.join(", ")}; ` +
      `installed now: ${installedNow.join(", ")}) — nothing was removed` });
}

/**
 * Renames one package root aside, inside its own parent directory, so removing it becomes
 * reversible. Unfreezes the root directory itself first — a frozen directory cannot be renamed at
 * all (see this file's header) — and re-freezes it if the ports.filesystem.rename fails, so a package this function
 * could not stage is left exactly as it found it.
 *
 * @complexity One `ports.filesystem.stat`, one or two `ports.filesystem.chmod`s, one `ports.filesystem.rename`.
 */
async function stageForRemoval({ ports, packagesDir, packageRoot }: {
  ports: AgentPluginLifecyclePorts;
  packagesDir: string;
  packageRoot: string;
}, optional: { quarantined?: string } = {}): Promise<StagedTree> {
  // Updates choose a journaled destination outside packages/sha256; uninstall keeps its sibling
  // destination and same-filesystem guarantee documented above. Both retain the same move owner.
  const quarantined = optional.quarantined ?? path.join(packagesDir, `${STAGED_DIRNAME_PREFIX}${(() => ports.ids.newId())()}`);
  const originalMode = (await ports.filesystem.stat(packageRoot)).mode & 0o777;

  await ports.filesystem.chmod(packageRoot, originalMode | 0o700);
  try {
    await ports.filesystem.rename(packageRoot, quarantined);
  } catch (error) {
    await ports.filesystem.chmod(packageRoot, originalMode).catch(() => undefined);
    throw error;
  }

  return { quarantined, original: packageRoot, originalMode };
}

/**
 * Puts every staged tree back, newest first, and returns the error `uninstallAgentPlugin` should
 * throw: `cause` when everything was restored, or — when some tree could not be — an error naming
 * the staged paths, since those directories hold the only remaining copy of that package.
 *
 * @complexity O(s) renames in the staged-tree count.
 */
async function restoreStagedTrees({ ports, staged, cause }: {
  ports: AgentPluginLifecyclePorts;
  staged: readonly StagedTree[];
  cause: unknown;
}): Promise<unknown> {
  const stranded: string[] = [];
  for (const tree of [...staged].reverse()) {
    try {
      await ports.filesystem.rename(tree.quarantined, tree.original);
      await ports.filesystem.chmod(tree.original, tree.originalMode).catch(() => undefined);
    } catch {
      stranded.push(tree.quarantined);
    }
  }
  if (stranded.length === 0) return cause;

  const reason = cause instanceof Error ? cause.message : String(cause);
  return new Error(
    `Agent Plugin uninstall failed (${reason}) and ${stranded.length} package tree(s) could not be put back. ` +
      `They still hold the package bytes and were left in place for recovery: ${stranded.join(", ")}`,
    { cause },
  );
}

/**
 * Finds `pluginId`'s installed digests in this workspace and applies both refusals.
 *
 * @throws {AgentPluginNotFoundError} No match on disk.
 * @throws {AgentPluginNotUninstallableError} The activation record says `origin: "bundled"`, or holds a malformed
 * entry for this plugin.
 * @throws {AgentPluginActivationsUnreadableError} The activation record exists but could not be
 * read, so whether it says `origin: "bundled"` cannot be established.
 * @complexity O(d) in the installed-digest count.
 */
// The one call that turns (instance layout, workspaceId) into real, internally-consistent
// packages/root paths — see this file's header, "Why this module resolves its own workspace
// layout". `forWorkspace` itself still throws for a syntactically invalid `workspaceId`.
// The bundled read above answers `false` for a present-but-malformed entry (a non-object, a non-boolean
// `enabled`), which says nothing about provenance. The gate reads that entry as `undetermined` and denies; an
// uninstall does the same rather than remove what may be a bundled plugin the next boot re-seeds (t91 R4). A
// file that became unreadable between the two reads also lands here, and is refused the same way.
async function resolveUninstallTargets({ ports, required }: {
  ports: AgentPluginLifecyclePorts;
  required: UninstallAgentPluginRequired;
}, { retiredBundled = false }: { retiredBundled?: boolean } = {}): Promise<UninstallTargets> {
  const { layout, workspaceId, pluginId } = required;

  const workspaceLayout = layout.forWorkspace({ workspaceId });

  const installed = await createResolveAgentPluginRefsModule(ports).listInstalledPlugins(workspaceLayout.root);
  const matches = installed.filter((plugin) => plugin.pluginId === pluginId);
  if (matches.length === 0) {
    throw new AgentPluginNotFoundError({ message: `Agent Plugin '${pluginId}' is not installed in this workspace — nothing to uninstall` });
  }

  if (!retiredBundled && (await createActivationModule(ports).isAgentPluginRecordedAsBundled(workspaceLayout.root, pluginId))) {
    throw new AgentPluginNotUninstallableError({ message: bundledRefusalMessage({ ports, pluginId }) });
  }

  if ((await createActivationModule(ports).resolveAgentPluginActivation(workspaceLayout.root, pluginId)).verdict === "undetermined") {
    throw new AgentPluginNotUninstallableError({ message: malformedEntryRefusalMessage({ ports, pluginId }) });
  }

  return { workspaceRoot: workspaceLayout.root, packagesDir: workspaceLayout.pluginPackagesDir({ pluginId }), matches };
}

/** Names the levers that do work for a bundled plugin — see this file's header, item 2. */
function bundledRefusalMessage({ ports, pluginId }: {
  ports: AgentPluginLifecyclePorts;
  pluginId: string;
}): string {
  return (
    `Agent Plugin '${pluginId}' is bundled with ${ports.productName} and cannot be uninstalled — it is re-seeded on every boot ` +
    "(seed-bundled.ts), so removing its files now would silently reappear on the next restart. To stop it being " +
    (ports.formatBundledUninstallRecovery?.({ pluginId }, {}) ?? "used, disable it through the host's activation control.")
  );
}

/** Path-free: says why provenance is unknown and what repairs it. Does not suggest toggling the plugin, which would
 *  rewrite a garbled bundled entry as `operator-installed`. */
function malformedEntryRefusalMessage({ ports, pluginId }: {
  ports: AgentPluginLifecyclePorts;
  pluginId: string;
}): string {
  return (
    `Agent Plugin '${pluginId}' cannot be uninstalled: its entry in this workspace's activation record is malformed, so ` +
    `whether it is bundled with ${ports.productName} (and would be re-seeded on the next boot) cannot be established. Nothing was ` +
    "removed. Tell the user an operator has to repair that entry in activations.json first; until then this " +
    "plugin's tool calls and plugin-pinned runs are refused."
  );
}

/**
 * Restores write permission through `root`'s whole tree, then removes it — the production
 * counterpart of `__tests__/fixtures/force-remove.ts` (that file's own header explains why a plain
 * recursive `ports.filesystem.rm` cannot work here: `install.ts`'s `freezeTree` leaves every directory `0o555`).
 * Deliberately not shared code with that test fixture: the fixture is intentionally test-only and
 * this is the first production need for the same operation, not a refactor opportunity forced by it.
 *
 * @complexity O(f) in the file/directory count under `root`.
 */
async function removeFrozenPackageTree({ ports, root }: { ports: AgentPluginLifecyclePorts; root: string }): Promise<void> {
  await makeTreeWritable({ ports, dir: root });
  await ports.filesystem.rm(root, { recursive: true, force: true });
}

async function makeTreeWritable({ ports, dir }: { ports: AgentPluginLifecyclePorts; dir: string }): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await ports.filesystem.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  await ports.filesystem.chmod(dir, 0o700).catch(() => undefined);
  for (const entry of entries) {
    // Dirents are lstat-typed: a link is removed by `ports.filesystem.rm`, never followed, since ports.filesystem.chmod through it
    // would change the mode of whatever it points at, even outside the package.
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await makeTreeWritable({ ports, dir: absolute });
    } else {
      await ports.filesystem.chmod(absolute, 0o600).catch(() => undefined);
    }
  }
}

function buildModule(ports: AgentPluginLifecyclePorts) {
  return {
    previewAgentPluginUninstall: (required: UninstallAgentPluginRequired) => previewAgentPluginUninstall({ ports, required }),
    uninstallAgentPlugin: (required: UninstallAgentPluginRequired, optional: UninstallAgentPluginOptional = {}) => uninstallAgentPlugin({ ports, required }, optional),
    stageForRemoval: (packagesDir: string, packageRoot: string, optional: { quarantined?: string } = {}) => stageForRemoval({ ports, packagesDir, packageRoot }, optional),
    restoreStagedTrees: (staged: readonly StagedTree[], cause: unknown) => restoreStagedTrees({ ports, staged, cause }),
    removeFrozenPackageTree: (root: string) => removeFrozenPackageTree({ ports, root }),
  };
}

const instances = new WeakMap<AgentPluginLifecyclePorts, ReturnType<typeof buildModule>>();
/** Internal composition; one state/queue instance per injected host context. */
export function createUninstallModule(ports: AgentPluginLifecyclePorts, _optional: Record<string, never> = {}) {
  let instance = instances.get(ports);
  if (!instance) { instance = buildModule(ports); instances.set(ports, instance); }
  return instance;
}
