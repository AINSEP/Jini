/**
 * @file `uninstallAgentPlugin()` — permanently removes one workspace's installed Agent Plugin: its
 * on-disk package(s) under `packages/sha256/*` for this `pluginId`, then its activation record.
 * `previewAgentPluginUninstall()` runs the same refusals without removing anything.
 *
 * `features/plugin-runtime/uninstall.ts` already has this exact feature for the OTHER plugin family
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
import type { InstalledAgentPlugin } from "./install.js";
import type { AgentPluginLayout } from "./layout.js";
import { createResolveAgentPluginRefsModule } from "./resolve-agent-plugin-refs.js";
import type { AgentPluginLifecyclePorts } from "./ports.js";

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

export interface UninstallAgentPluginRequired {
  readonly layout: AgentPluginLayout;
  readonly workspaceId: string;
  readonly pluginId: string;
}

export interface UninstallAgentPluginOptional {

  /** The preview a human confirmed. When given, the uninstall refuses, removing nothing, unless the digests it
   *  resolves now are exactly this preview's `archiveDigests`: a confirmation is consent to remove what was
   *  resolved for the dialog, not whatever the id names by the time the answer arrives (t91 F2.2). */
  readonly confirmedPreview?: (AgentPluginUninstallPreview) | undefined;
  /** Only the browser-confirmed choice may delete persistent state. Off by default. */
  readonly deleteMemory?: boolean | undefined;

  /** INTERNAL — `retire-bundled.ts` only, never an agent tool or HTTP route. Skips the bundled refusal
   *  (this file's header, item 2) and nothing else: that refusal exists because a bundled plugin is
   *  re-seeded on every boot, which stops being true once the host no longer ships its source
   *  (`RETIRED_BUNDLED_AGENT_PLUGINS`). The malformed-entry refusal still applies. */
  readonly retiredBundled?: (boolean) | undefined;
}

export interface UninstallAgentPluginResult {
  readonly pluginId: string;

  /** Every installed archive digest removed for this plugin id — normally exactly one. All matching
   *  digests are removed: uninstall's job is to make the plugin genuinely gone, so unlike the tool
   *  loader, which must pick ONE to serve, there is no "which one" question here. */
  readonly removedDigests: readonly string[];
}

/** What an uninstall of one plugin would remove, in a form safe to show a human: no host path. */
export interface AgentPluginUninstallPreview {
  readonly pluginId: string;

  /** Distinct manifest versions across the matching digests; empty when none declares one. */
  readonly versions: readonly string[];
  readonly archiveDigests: readonly string[];
}

/** A reversible staged package and its original permissions; shared by uninstall and replacement. */
/** One package root renamed aside, and what restoring it takes: the path it must go back to, and the
 *  mode it carried before staging unfroze its root directory. */
export interface StagedTree {
  readonly quarantined: string;
  readonly original: string;
  readonly originalMode: number;
}

function buildModule(ports: AgentPluginLifecyclePorts) {
  const randomUUID = () => ports.ids.newId();
  const { assertContainedOnDisk } = createPackagePathsModule(ports);
  const rmdir = ports.filesystem.rmdir.bind(ports.filesystem);
  const chmod = ports.filesystem.chmod.bind(ports.filesystem);
  const readdir = ports.filesystem.readdir.bind(ports.filesystem);
  const rename = ports.filesystem.rename.bind(ports.filesystem);
  const rm = ports.filesystem.rm.bind(ports.filesystem);
  const stat = ports.filesystem.stat.bind(ports.filesystem);
  const { deleteAgentPluginActivation, isAgentPluginRecordedAsBundled, resolveAgentPluginActivation } = createActivationModule(ports);
  const { listInstalledPlugins } = createResolveAgentPluginRefsModule(ports);
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
 * `isAgentPluginRecordedAsBundled`.
 * @complexity O(d) in this workspace's installed-digest count (one `listInstalledPlugins` walk).
 */
  async function previewAgentPluginUninstall(required: UninstallAgentPluginRequired): Promise<AgentPluginUninstallPreview> {
    const { matches } = await resolveUninstallTargets(required);
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
 * @complexity O(d) in this workspace's installed-digest count (one `listInstalledPlugins` walk) plus
 * O(f) in the total file count under the matching digest(s) being removed.
 */
  async function uninstallAgentPlugin(required: UninstallAgentPluginRequired, optional: UninstallAgentPluginOptional = {}): Promise<UninstallAgentPluginResult> {
    const workspaceRoot = required.layout.forWorkspace({ workspaceId: required.workspaceId }).root;
    return createPersistentStateModule(ports).withPluginLock({ workspaceRoot, pluginId: required.pluginId,
      run: () => uninstallAgentPluginUnlocked(required, optional) });
  }

  // Reversible work first — see this file's header, "Why removal stages first". Nothing on this
// side of the try is destructive: every step up to and including the activation-record delete can
// be undone by renaming the staged trees back where they came from.
// Past this point the live state is already settled: the packages are no longer reachable under
// any installed-digest name and the activation record is gone. These removes are the only
// irreversible step, and nothing observable depends on them finishing.
// Remove only empty package ancestors: a concurrently-installed digest must never be deleted.
// No package may have appeared since this uninstall's preview. Preserve it on a race.
  async function uninstallAgentPluginUnlocked(
    required: UninstallAgentPluginRequired,
    optional: UninstallAgentPluginOptional = {},
  ): Promise<UninstallAgentPluginResult> {
    const { workspaceRoot, packagesDir, matches } = await resolveUninstallTargets(required, optional.retiredBundled === true);
    assertUnchangedSincePreview(required.pluginId, optional.confirmedPreview, matches);
    if (optional.deleteMemory && (!optional.confirmedPreview || optional.confirmedPreview.pluginId !== required.pluginId)) {
      throw new Error('Deleting plugin memory requires a confirmed preview for this plugin');
    }

    const staged: StagedTree[] = [];
    try {
      for (const plugin of matches) {
        staged.push(await stageForRemoval(packagesDir, plugin.packageRoot));
      }
      await deleteAgentPluginActivation({ workspaceRoot, pluginId: required.pluginId });
    } catch (error) {
      throw await restoreStagedTrees(staged, error);
    }

    for (const tree of staged) {
      await removeFrozenPackageTree(tree.quarantined);
    }

    for (const directory of [packagesDir, path.dirname(packagesDir)]) {
      try { await rmdir(directory); } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || !['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(String(error.code))) throw error;
      }
    }
    if (optional.deleteMemory) {
      const pluginRoot = required.layout.forWorkspace({ workspaceId: required.workspaceId }).pluginRootDir({ pluginId: required.pluginId });
      await assertContainedOnDisk(workspaceRoot, path.relative(workspaceRoot, pluginRoot));
      if ((await listInstalledPlugins(workspaceRoot)).some(plugin => plugin.pluginId === required.pluginId)) throw new Error('Plugin was reinstalled during uninstall; persistent memory was kept');
      await rm(pluginRoot, { recursive: true, force: true });
    }
    return { pluginId: required.pluginId, removedDigests: matches.map((plugin) => plugin.archiveDigest) };
  }

  /**
 * Refuses when the digests resolved now are not exactly the set a confirmed preview listed — an archive added
 * OR removed for this id while the dialog was open. Runs in the same call that stages the removal, so it opens
 * no new check-then-act gap of its own.
 *
 * @throws {AgentPluginChangedSincePreviewError} The two digest sets differ.
 * @complexity O(d log d) in the digest count.
 */
  function assertUnchangedSincePreview(
    pluginId: string,
    confirmedPreview: AgentPluginUninstallPreview | undefined,
    matches: readonly InstalledAgentPlugin[],
  ): void {
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
 * all (see this file's header) — and re-freezes it if the rename fails, so a package this function
 * could not stage is left exactly as it found it.
 *
 * @complexity One `stat`, one or two `chmod`s, one `rename`.
 */
  async function stageForRemoval(packagesDir: string, packageRoot: string): Promise<StagedTree> {
    const quarantined = path.join(packagesDir, `${STAGED_DIRNAME_PREFIX}${randomUUID()}`);
    const originalMode = (await stat(packageRoot)).mode & 0o777;

    await chmod(packageRoot, originalMode | 0o700);
    try {
      await rename(packageRoot, quarantined);
    } catch (error) {
      await chmod(packageRoot, originalMode).catch(() => undefined);
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
  async function restoreStagedTrees(staged: readonly StagedTree[], cause: unknown): Promise<unknown> {
    const stranded: string[] = [];
    for (const tree of [...staged].reverse()) {
      try {
        await rename(tree.quarantined, tree.original);
        await chmod(tree.original, tree.originalMode).catch(() => undefined);
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
  async function resolveUninstallTargets(required: UninstallAgentPluginRequired, retiredBundled = false): Promise<UninstallTargets> {
    const { layout, workspaceId, pluginId } = required;

    const workspaceLayout = layout.forWorkspace({ workspaceId });

    const installed = await listInstalledPlugins(workspaceLayout.root);
    const matches = installed.filter((plugin) => plugin.pluginId === pluginId);
    if (matches.length === 0) {
      throw new AgentPluginNotFoundError({ message: `Agent Plugin '${pluginId}' is not installed in this workspace — nothing to uninstall` });
    }

    if (!retiredBundled && (await isAgentPluginRecordedAsBundled(workspaceLayout.root, pluginId))) {
      throw new AgentPluginNotUninstallableError({ message: bundledRefusalMessage(pluginId) });
    }

    if ((await resolveAgentPluginActivation(workspaceLayout.root, pluginId)).verdict === "undetermined") {
      throw new AgentPluginNotUninstallableError({ message: malformedEntryRefusalMessage(pluginId) });
    }

    return { workspaceRoot: workspaceLayout.root, packagesDir: workspaceLayout.pluginPackagesDir({ pluginId }), matches };
  }

  /** Names the levers that do work for a bundled plugin — see this file's header, item 2. */
  function bundledRefusalMessage(pluginId: string): string {
    return (
      `Agent Plugin '${pluginId}' is bundled with ${ports.productName} and cannot be uninstalled — it is re-seeded on every boot ` +
      "(seed-bundled.ts), so removing its files now would silently reappear on the next restart. To stop it being " +
      (ports.formatBundledUninstallRecovery?.({ pluginId }, {}) ?? "used, disable it through the host's activation control.")
    );
  }

  /** Path-free: says why provenance is unknown and what repairs it. Does not suggest toggling the plugin, which would
 *  rewrite a garbled bundled entry as `operator-installed`. */
  function malformedEntryRefusalMessage(pluginId: string): string {
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
 * recursive `rm` cannot work here: `install.ts`'s `freezeTree` leaves every directory `0o555`).
 * Deliberately not shared code with that test fixture: the fixture is intentionally test-only and
 * this is the first production need for the same operation, not a refactor opportunity forced by it.
 *
 * @complexity O(f) in the file/directory count under `root`.
 */
  async function removeFrozenPackageTree(root: string): Promise<void> {
    await makeTreeWritable(root);
    await rm(root, { recursive: true, force: true });
  }

  async function makeTreeWritable(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    await chmod(dir, 0o700).catch(() => undefined);
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await makeTreeWritable(absolute);
      } else {
        await chmod(absolute, 0o600).catch(() => undefined);
      }
    }
  }

  return { previewAgentPluginUninstall, uninstallAgentPlugin, stageForRemoval, restoreStagedTrees, removeFrozenPackageTree };
}

const instances = new WeakMap<AgentPluginLifecyclePorts, ReturnType<typeof buildModule>>();
/** Internal composition; one state/queue instance per injected host context. */
export function createUninstallModule(ports: AgentPluginLifecyclePorts) {
  let instance = instances.get(ports);
  if (!instance) { instance = buildModule(ports); instances.set(ports, instance); }
  return instance;
}
