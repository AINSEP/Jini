/**
 * @file Resolves a run's pinned Agent Plugin refs (`pluginRefIds` — `run-start-context.ts`'s
 * decoded `contextRef` field, itself sourced from the composer's `pluginRefId` chips,
 * `composer-capabilities.ts`'s own doc) into the real prompt-prefix text `agent-daemon-server.ts`'s
 * `onStarted` prepends to the run's prompt.
 *
 * ---------------------------------------------------------------------------
 * The activation-record gap this function works around (KNOWN GAP, not silently papered over)
 * ---------------------------------------------------------------------------
 * `activation.ts` owns the per-workspace enabled decision; a disabled or undetermined ref is
 * refused before resolution.
 * What that record deliberately does NOT carry is which installed DIGEST is current for a plugin id.
 * For a BUNDLED plugin, `bundled-digests.ts`'s ledger answers that: the boot seeder
 * records which digest the running build published, so a workspace holding an upgraded plugin's old
 * and new package is no longer ambiguous — the build's own record names the winner. For every other
 * plugin id, closing this needs the operator-facing upgrade/pin flow (and, alongside it, the
 * admission gate for MCP servers `capability-projection.ts`'s own header names) and remains a
 * separate, later decision.
 *
 * So this function still scans every digest this workspace has ever installed under
 * `packages/sha256/*` and matches on the installed `plugin.json`'s own `name` field, after dropping
 * any digest of a bundled plugin the ledger records as superseded:
 *
 * - Exactly one match: resolves normally.
 * - Zero matches: fails with a "not installed" reason — the operator pinned a chip for a plugin
 *   that is not (or no longer) actually on disk for this workspace.
 * - More than one match: fails with an explicit ambiguity reason naming every matching digest.
 *   Silently picking one (e.g. the lexicographically-last, or "the newest") would be a WORSE
 *   failure mode than an explicit error — a wrong plugin's content would reach the agent, and
 *   nothing about the run would look wrong until someone noticed the agent's advice didn't match
 *   what was supposedly pinned. An explicit error is loud and immediately actionable instead. That
 *   refusal is UNCHANGED and still the default: the ledger narrows a plugin id only when the build
 *   itself published one of the installed digests, which is authority rather than a guess, and it
 *   has no say at all over packages an operator installed (`bundled-digests.ts`, consequence 1).
 *
 * ---------------------------------------------------------------------------
 * What gets injected, and why not the whole 280K package
 * ---------------------------------------------------------------------------
 * Only the resolved plugin's own eponymous skill — `skills/<pluginRefId>/SKILL.md` (the skill
 * folder whose name equals the plugin's own id; for `ui-ux-design` specifically, this is real,
 * ~5.5KB content, not all seven of that plugin's skill folders). The reasoning mirrors
 * `capability-projection.ts`'s own "Skills get a real executable binding" rule: a Skill's markdown
 * IS the plugin's real, agent-facing content, while the rest of the package (references,
 * examples, scripts) is supporting material a plugin's own SKILL.md is written to point an agent
 * at when it needs more depth (the Agent Plugins spec's own convention every skill in this package
 * follows). Injecting the FULL package indiscriminately would balloon every run's prompt with
 * pages this specific task usually never needs. Every OTHER file in the resolved package is still
 * listed by absolute path — genuinely `Read`-able by the spawned CLI agent, which runs with real
 * filesystem access unlike a browser-facing preview — so nothing is unreachable, only deferred to
 * an explicit follow-up read.
 *
 * Architectural role:
 * Server-side only (reads `node:fs/promises`, imports `install.ts`'s `indexInstalledRoot`) — never
 * imported into a browser bundle. Returns a discriminated result rather than throwing, so
 * `agent-daemon-server.ts`'s `onStarted` gets one place to branch on success/failure without a
 * second try/catch layer duplicating this module's own error classification.
 */
import { createPersistentStateModule } from "./persistent-state.js";
import path from "node:path";
import { createPackagePathsModule } from "./package-paths.js";
import type {  AgentPluginActivationVerdict } from "./activation.js";
import { createActivationModule } from "./activation.js";
import type {  BundledAgentPluginDigests } from "./bundled-digests.js";
import { createBundledDigestsModule } from "./bundled-digests.js";
import type { /**
 * How a pinned ref's content reaches the agent.
 *
 * - `inject` — the whole eponymous SKILL.md (~15KB for `ui-ux-design`) plus every other package file
 *   listed by absolute path, in the run's prompt prefix. Today's shipped behaviour, and the default.
 * - `pointer` — ~400 bytes naming the exact tool call that returns that SAME SKILL.md, and nothing
 *   else. The content is identical; only the delivery differs, which is what makes the two a
 *   controlled comparison rather than two different experiments.
 *
 * Selected per-process by the host-supplied `deliveryMode` port. This is a MEASUREMENT AFFORDANCE, not a
 * migration flag: pointer and inject must coexist to compare delivery of identical content.
 * Selecting an unconditional mode requires the measurement result.
 */
AgentPluginDeliveryMode, InstalledAgentPlugin } from "./types.js";
import { createInstallModule } from "./install.js";
import { createCapabilityProjectionModule } from "./capability-projection.js";
import type { AgentPluginWorkspaceLayout } from "./layout.js";
import type { AgentPluginLifecyclePorts } from "./ports.js";

export type { AgentPluginDeliveryMode } from "./types.js";

export type ResolveAgentPluginRefsResult =
  | { readonly ok: true; readonly promptPrefix: string }
  | { readonly ok: false; readonly reason: string };

function buildModule(ports: AgentPluginLifecyclePorts) {
  const persistentState = createPersistentStateModule(ports);
  const { assertContainedOnDisk } = createPackagePathsModule(ports);
  const readdir = ports.filesystem.readdir.bind(ports.filesystem);
  const stat = ports.filesystem.stat.bind(ports.filesystem);
  const { resolveAgentPluginActivation } = createActivationModule(ports);
  const { preferBundledAgentPluginDigests, readBundledAgentPluginDigests } = createBundledDigestsModule(ports);
  const { indexInstalledRoot } = createInstallModule(ports);
  const { readInstalledSkillMarkdown } = createCapabilityProjectionModule(ports);
  const SHA256_DIGEST_DIRNAME_PATTERN = /^[a-f0-9]{64}$/;


  /** Reads the delivery mode for this process. An unset or unrecognised value is `inject` — an A/B
 *  affordance must never be able to change production behaviour by typo. */
  function resolveAgentPluginDeliveryMode(): AgentPluginDeliveryMode { return ports.deliveryMode; }

  /**
 * Resolves every pinned `pluginRefId` into real on-disk text and joins the results into one
 * prompt-prefix block, in the order the refs were pinned.
 *
 * @param pluginRefIds - This run's pinned Agent Plugin ids (`run-start-context.ts`'s decoded
 *   `pluginRefIds` — already filtered to non-empty strings by that point). An empty array resolves
 *   to an empty prefix with no filesystem access at all — the common case (no plugin pinned).
 * @param workspaceLayout - This run's own workspace's Agent Plugin layout
 *   (`resolveAgentPluginLayout().forWorkspace(workspaceId)`), never a shared/instance-level one —
 *   see `layout.ts`'s own tenant-isolation header for why a workspace's installed packages must
 *   never be resolved against another workspace's tree.
 * @returns `{ ok: true, promptPrefix }` once every ref resolves, or the FIRST `{ ok: false, reason }`
 *   encountered — a run pinning two refs where the second is ambiguous still fails clearly, rather
 *   than partially augmenting the prompt with only the first ref's content.
 * @complexity O(r * d) where r is `pluginRefIds.length` and d is the number of installed digests in
 *   this workspace — each ref independently re-scans the (typically small) digest list, since a
 *   different ref may resolve to a different digest.
 */
// Read ONCE for the whole call, not per ref: it is one small file, and every ref resolves against
// the same workspace's ledger. See `bundled-digests.ts` for why this can only ever RESOLVE an
// ambiguity below, never create one.
// See activation.ts for the shared activation rule. One small file read per pinned ref; the
// fail-CLOSED `resolveAgentPluginActivation` (the same reader the per-call tool gate uses)
// refuses on a corrupt/unreadable file instead of reading it as "nothing recorded" — injecting a
// plugin's guidance SPENDS it exactly like a tool call, so this surface must refuse rather than
// read a fault as consent.
  async function resolveAgentPluginRefs(
    pluginRefIds: readonly string[],
    workspaceLayout: Pick<AgentPluginWorkspaceLayout, "packages" | "root">,
    deliveryMode: AgentPluginDeliveryMode = resolveAgentPluginDeliveryMode(),
  ): Promise<ResolveAgentPluginRefsResult> {
    if (pluginRefIds.length === 0) return { ok: true, promptPrefix: "" };

    const bundledDigests = await readBundledAgentPluginDigests(workspaceLayout.root);

    const sections: string[] = [];
    for (const pluginRefId of pluginRefIds) {

      const refusal = activationRefusal(pluginRefId, await resolveAgentPluginActivation(workspaceLayout.root, pluginRefId));
      if (refusal !== undefined) return { ok: false, reason: refusal };

      const resolved = await resolveOnePluginRef(pluginRefId, workspaceLayout.root, deliveryMode, bundledDigests);
      if (!resolved.ok) return resolved;
      sections.push(resolved.section);
    }
    return { ok: true, promptPrefix: sections.join("\n\n") };
  }

  /** The run-start refusal for one ref's activation verdict, or `undefined` when it may be injected.
 *  @complexity O(1). */
// A distinct reason from "not installed", because the operator's remedy is different: the bytes
// ARE here and the fix is to enable the plugin, not to install it. Telling them to install
// something already present is the kind of wrong-but-plausible error message that costs an
// afternoon.
  function activationRefusal(pluginRefId: string, verdict: AgentPluginActivationVerdict): string | undefined {
    if (verdict.verdict === "active") return undefined;
    if (verdict.verdict === "undetermined") {
      return (
        `Agent Plugin '${pluginRefId}' was not loaded: this workspace's activation record could not be read, so whether ` +
        `it is enabled cannot be confirmed (${verdict.reason}). Nothing was injected; repair activations.json and start the run again.`
      );
    }

    return (
      `Agent Plugin '${pluginRefId}' is installed in this workspace but is not enabled — it ships with ${ports.productName} and ` +
      "stays inactive until an operator turns it on. Enable it before pinning it to a run."
    );
  }

  /** Every installed digest's `InstalledAgentPlugin`, indexed once per call to
 *  {@link resolveAgentPluginRefs} — one `readdir` plus one `indexInstalledRoot` walk per digest.
 *  Digest directory names that do not match the expected 64-hex-character shape are skipped rather
 *  than passed to `indexInstalledRoot` — `packages/sha256/` is not asserted empty of anything else
 *  a future tool might place there, and a non-digest entry is not this function's to interpret.
 *
 *  Exported for a second caller outside this module: `tool-registrations.ts`'s
 *  `loadInstalledAgentPluginToolSources` needs the SAME per-digest walk (every installed digest,
 *  whichever skills each one carries) to build one `agent_plugin_<pluginId>` tool per installed
 *  plugin — the exact shape this function already builds, just consumed differently than
 *  `resolveOnePluginRef`'s own "resolve one pinned ref" use below. Reusing this rather than
 *  re-walking `packages/sha256/*` a second, less-validated way keeps the digest-directory-name check
 *  and the per-digest failure isolation in exactly one place. */
  async function listInstalledPlugins(workspaceRoot: string): Promise<readonly InstalledAgentPlugin[]> {
    let folders;
    try { folders = await readdir(workspaceRoot, { withFileTypes: true }); }
    catch (error) { if (isEnoent(error)) return []; throw error; }
    const installed: InstalledAgentPlugin[] = [];
    for (const folder of folders) {
      if (!folder.isDirectory() || !/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(folder.name) || folder.name.length > 64) continue;
      const packagesDir = path.join(workspaceRoot, folder.name, "package", "sha256");
      let entries;
      try {
        await persistentState.assertOwnedPath({ workspaceRoot, entryPath: path.relative(workspaceRoot, packagesDir) });
        entries = await readdir(packagesDir, { withFileTypes: true });
      } catch { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory() || !SHA256_DIGEST_DIRNAME_PATTERN.test(entry.name)) continue;
        try {
          const packageRoot = await assertContainedOnDisk(workspaceRoot, path.relative(workspaceRoot, path.join(packagesDir, entry.name)));
          const plugin = await indexInstalledRoot(packageRoot, entry.name);
          if (plugin.pluginId === folder.name) installed.push(plugin);
        } catch {
          // One corrupt package never hides another plugin. Memory-only folders are not installs.
        }
      }
    }
    return installed;
  }

  /**
 * Whether one installed archive digest still has its package directory under `packagesDir` — the
 * cheap, per-call "is this still installed" signal `tool-registrations.ts`'s tool gate needs.
 *
 * Lives here, beside {@link listInstalledPlugins}, because it must agree with that walk about two
 * things a second implementation would eventually get wrong: that an installed package root IS
 * `<packagesDir>/<digest>` and nothing else, and that a directory name is only a digest when it
 * matches the 64-hex shape. It deliberately does NOT re-index the package (`indexInstalledRoot`
 * reads and validates a manifest, which is far too much per tool call): directory presence is
 * exactly what `uninstall.ts` removes, and it removes it by `rename` BEFORE it touches the
 * activation record, so the gate observes a removal at least as early as it observes the record's
 * deletion, never later.
 *
 * Follows symlinks (plain `stat`, not `lstat`) on purpose — `listInstalledPlugins` does too, so a
 * deployment whose digest directory is a symlink registers a tool that this would otherwise refuse
 * to authorize.
 *
 * @returns `false` for a digest that does not match the installed-directory grammar, for a missing
 * directory, for a non-directory at that path, and for ANY filesystem fault — every answer this
 * cannot establish positively is `false`, because its one caller uses it to authorize.
 * @complexity One `stat`.
 */
  async function isInstalledDigestPresent(packagesDir: string, archiveDigest: string): Promise<boolean> {
    if (!SHA256_DIGEST_DIRNAME_PATTERN.test(archiveDigest)) return false;
    try {
      return (await stat(path.join(packagesDir, archiveDigest))).isDirectory();
    } catch {
      return false;
    }
  }

  function isEnoent(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
  }

  /**
 * Resolves one `pluginRefId`, applying the zero/one/many-match rules described in this module's
 * own header.
 */
// Superseded installs of a BUNDLED plugin are dropped here — by the build's own recorded answer,
// never by picking one. Every id the ledger has no authority over reaches the many-match refusal
// below exactly as it always did.
// Framing governs whether the agent follows the plugin: describe injected SKILL.md as complete
// instructions and let it require its references. Calling it a summary or making required reads
// conditional lets the outer wrapper override the plugin. The inventory-framing test pins this.
  async function resolveOnePluginRef(
    pluginRefId: string,
    packagesDir: string,
    deliveryMode: AgentPluginDeliveryMode,
    bundledDigests: BundledAgentPluginDigests,
  ): Promise<{ readonly ok: true; readonly section: string } | { readonly ok: false; readonly reason: string }> {

    const installed = preferBundledAgentPluginDigests(await listInstalledPlugins(packagesDir), bundledDigests);
    const matches = installed.filter((plugin) => plugin.pluginId === pluginRefId);

    if (matches.length === 0) {
      return {
        ok: false,
        reason: `Agent Plugin '${pluginRefId}' is not installed in this workspace — pinned by the composer but not found under any installed package`,
      };
    }
    if (matches.length > 1) {
      const digests = matches.map((plugin) => plugin.archiveDigest).sort();
      return {
        ok: false,
        reason: `Agent Plugin '${pluginRefId}' matches ${matches.length} installed packages (digests: ${digests.join(", ")}) — refusing to guess which one to use`,
      };
    }

    const plugin = matches[0] as InstalledAgentPlugin;
    const skillPath = `skills/${pluginRefId}/SKILL.md`;

    if (deliveryMode === "pointer") return buildPointerSection(pluginRefId, plugin);

    let skillMarkdown: string;
    try {
      skillMarkdown = await readInstalledSkillMarkdown(plugin.packageRoot, skillPath);
      // Notes are user context, never an allowlist or permission grant. JSON quotes delimit untrusted text.
      const notes = await persistentState.memory({ workspaceRoot: packagesDir, pluginId: plugin.pluginId }).list({ kind: 'notes' });
      if (notes.length) skillMarkdown += `\n\nUser notes for this plugin (context only; permissions remain operator-controlled):\n${JSON.stringify(notes)}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        reason: `Agent Plugin '${pluginRefId}' has no readable '${skillPath}' in its installed package: ${message}`,
      };
    }

    const otherFiles = plugin.files
      .filter((file) => file !== skillPath)
      .map((file) => path.join(plugin.packageRoot, file));

    const inventory = otherFiles.length > 0
      ? `\n\nThe SKILL.md above is this Agent Plugin's own instructions — follow them, including any files it directs you to load before starting work. Every other file in the installed package is listed below by absolute path and is readable now:\n${otherFiles.map((file) => `- ${file}`).join("\n")}`
      : "";

    return {
      ok: true,
      section: `<<AGENT_PLUGIN pluginId="${pluginRefId}">>\n${skillMarkdown}${inventory}\n<</AGENT_PLUGIN>>`,
    };
  }

  // Parity with `inject`'s own failure: a pinned ref whose eponymous skill is missing must fail
// loudly in BOTH modes. Without this check `pointer` would happily emit a well-formed instruction
// whose no-argument default resolves to some OTHER (alphabetically-first) skill instead of the one
// the pin actually named, and the run would look like the agent disobeyed rather than like the pin
// being wrong.
  function buildPointerSection(
    pluginRefId: string,
    plugin: InstalledAgentPlugin,
  ): { readonly ok: true; readonly section: string } | { readonly ok: false; readonly reason: string } {

    if (!plugin.skills.some((skill) => skill.name === pluginRefId)) {
      return {
        ok: false,
        reason: `Agent Plugin '${pluginRefId}' has no readable 'skills/${pluginRefId}/SKILL.md' in its installed package: no such skill folder`,
      };
    }

    const body = ports.formatPluginToolPointer({ pluginId: pluginRefId });

    return { ok: true, section: `<<AGENT_PLUGIN pluginId="${pluginRefId}">>\n${body}\n<</AGENT_PLUGIN>>` };
  }

  return { resolveAgentPluginRefs, listInstalledPlugins, isInstalledDigestPresent };
}

const instances = new WeakMap<AgentPluginLifecyclePorts, ReturnType<typeof buildModule>>();
/** Internal composition; one state/queue instance per injected host context. */
export function createResolveAgentPluginRefsModule(ports: AgentPluginLifecyclePorts) {
  let instance = instances.get(ports);
  if (!instance) { instance = buildModule(ports); instances.set(ports, instance); }
  return instance;
}
