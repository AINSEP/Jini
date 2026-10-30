import { listInstalledPackageRoots, INSTALLED_PLUGIN_DIGEST_PATTERN } from "./installed-package-roots.js";
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
 * - Exactly one match: resolves normally, unless the bundled ledger records that id at a different
 *   digest (a copy the build did not ship never guides under a bundled id).
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
 * pages this specific task usually never needs. Readable supporting files are listed relative to
 * the chosen skill folder and loaded through the same plugin tool used by browser-facing assistants
 * and CLI agents — supporting content is deferred to an explicit follow-up read.
 *
 * Architectural role:
 * Server-side only (reads injected filesystem ports through the installed-package index) — never
 * imported into a browser bundle. Returns a discriminated result rather than throwing, so
 * `agent-daemon-server.ts`'s `onStarted` gets one place to branch on success/failure without a
 * second try/catch layer duplicating this module's own error classification.
 */
import { createPersistentStateModule } from "./persistent-state.js";
import path from "node:path";
import type {  AgentPluginActivationVerdict } from "./activation.js";
import { createActivationModule } from "./activation.js";
import type {  BundledAgentPluginDigests } from "./bundled-digests.js";
import { createBundledDigestsModule } from "./bundled-digests.js";
import type { /**
 * How a pinned ref's content reaches the agent.
 *
 * - `inject` — the whole eponymous SKILL.md (~15KB for `ui-ux-design`) plus its readable supporting-file inventory
 *   listed relative to the skill folder, in the run's prompt prefix. Today's shipped behaviour, and the default.
 * - `pointer` — ~400 bytes naming the exact tool call that returns that SAME SKILL.md, and nothing
 *   else. The content is identical; only the delivery differs, which is what makes the two a
 *   controlled comparison rather than two different experiments.
 *
 * Selected per-process by the host-supplied `deliveryMode` port. This is a MEASUREMENT AFFORDANCE, not a
 * migration flag: pointer and inject must coexist to compare delivery of identical content.
 * Selecting an unconditional mode requires the measurement result.
 */
AgentPluginDeliveryMode, InstalledAgentPlugin } from "./types.js";
import { createInstalledPackageIndex } from "./installed-package-index.js";
import { createCapabilityProjectionModule } from "./capability-projection.js";
import type { AgentPluginWorkspaceLayout } from "./layout.js";
import type { AgentPluginLifecyclePorts } from "./ports.js";

/** A declared skill and a file relative to that skill's folder; omitted file means SKILL.md. */
export interface AgentPluginSkillRequest { readonly skill?: string; readonly file?: string }

export type { AgentPluginDeliveryMode } from "./types.js";

/** Trust refusals carry a machine-readable code so hosts need not parse diagnostic prose. */
export type ResolveAgentPluginRefsResult =
  | { readonly ok: true; readonly promptPrefix: string }
  | { readonly ok: false; readonly reason: string; readonly code?: 'untrusted' };

function buildModule(ports: AgentPluginLifecyclePorts) {
  const persistentState = createPersistentStateModule(ports);
  const stat = ports.filesystem.stat.bind(ports.filesystem);
  const { resolveAgentPluginActivation } = createActivationModule(ports);
  const { preferBundledAgentPluginDigests, readBundledAgentPluginDigests } = createBundledDigestsModule(ports);
  const { indexInstalledRoot } = createInstalledPackageIndex({ ports });
  const { readInstalledSkillFile } = createCapabilityProjectionModule(ports);


  /** Reads the delivery mode for this process. An unset or unrecognised value is `inject` — an A/B
 *  affordance must never be able to change production behaviour by typo. */
  function resolveAgentPluginDeliveryMode(): AgentPluginDeliveryMode { return ports.deliveryMode; }

  /** Legacy internal positional adapter; all admission and file resolution live in the object boundary. */
  async function resolveAgentPluginRefs(
    pluginRefIds: readonly string[],
    workspaceLayout: Pick<AgentPluginWorkspaceLayout, "packages" | "root">,
    deliveryMode: AgentPluginDeliveryMode = resolveAgentPluginDeliveryMode(),
  ): Promise<ResolveAgentPluginRefsResult> {
    return resolveAgentPluginSelection({ pluginRefIds, workspaceLayout }, { deliveryMode });
  }

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
 * @param options - Delivery mode and optional declared skill/file selection; reads stay bounded to the skill folder.
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
  async function resolveAgentPluginSelection(
    { pluginRefIds, workspaceLayout }: { pluginRefIds: readonly string[]; workspaceLayout: Pick<AgentPluginWorkspaceLayout, "packages" | "root"> },
    { deliveryMode = resolveAgentPluginDeliveryMode(), ...request }: AgentPluginSkillRequest & { deliveryMode?: AgentPluginDeliveryMode } = {},
  ): Promise<ResolveAgentPluginRefsResult> {
    if (pluginRefIds.length === 0) return { ok: true, promptPrefix: "" };

    const bundledDigests = await readBundledAgentPluginDigests(workspaceLayout.root);

    const sections: string[] = [];
    for (const pluginRefId of pluginRefIds) {

      const refusal = activationRefusal(pluginRefId, await resolveAgentPluginActivation(workspaceLayout.root, pluginRefId));
      if (refusal !== undefined) return { ok: false, reason: refusal };

      const resolved = await resolveOnePluginRef({ pluginRefId, packagesDir: workspaceLayout.root, deliveryMode, bundledDigests }, request);
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
      // Native activation-read diagnostics can name the host path; the model needs only the remedy.
      return (
        `Agent Plugin '${pluginRefId}' was not loaded: this workspace's activation record could not be read, so whether ` +
        `it is enabled cannot be confirmed. Nothing was injected; repair activations.json and start the run again.`
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
    const installed: InstalledAgentPlugin[] = [];
    for (const root of await listInstalledPackageRoots({ ports, workspaceRoot })) {
      try {
        const plugin = await indexInstalledRoot({ packageRoot: root.packageRoot, archiveDigest: root.archiveDigest });
        if (plugin.pluginId === root.localId) installed.push(plugin);
      } catch {
        // One corrupt package never hides another plugin. Memory-only folders are not installs.
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
    if (!INSTALLED_PLUGIN_DIGEST_PATTERN.test(archiveDigest)) return false;
    try {
      return (await stat(path.join(packagesDir, archiveDigest))).isDirectory();
    } catch {
      return false;
    }
  }

  /**
 * Resolves one `pluginRefId`, applying the zero/one/many-match rules described in this module's
 * own header.
 */
// Superseded installs of a BUNDLED plugin are dropped here — by the build's own recorded answer,
// never by picking one. Every id the ledger has no authority over reaches the many-match refusal
// below exactly as it always did.
  async function resolveOnePluginRef(
    { pluginRefId, packagesDir, deliveryMode, bundledDigests }: {
      pluginRefId: string; packagesDir: string; deliveryMode: AgentPluginDeliveryMode; bundledDigests: BundledAgentPluginDigests;
    },
    request: AgentPluginSkillRequest = {},
  ): Promise<{ readonly ok: true; readonly section: string } | Extract<ResolveAgentPluginRefsResult, { ok: false }>> {

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
    // Activation is checked by the caller. A lone copy under an id the bundled ledger records must be
    // the digest this build shipped; an operator install (no ledger entry) was digest-verified when
    // installed and its skills may guide once enabled (install-upload's trust warning). Inline, not
    // trusted-plugin-files' verdict: that module lists installs through this one (import cycle).
    const shippedDigest = bundledDigests.get(pluginRefId);
    if (shippedDigest !== undefined && shippedDigest !== plugin.archiveDigest) {
      return { ok: false, code: 'untrusted', reason: `Agent Plugin '${pluginRefId}' was not loaded: only plugins shipped with ${ports.productName} may add agent guidance under a bundled id (installed digest ${plugin.archiveDigest.slice(0, 12)} is not the one this build shipped)` };
    }
    if (deliveryMode === "pointer" && request.skill === undefined && request.file === undefined) return buildPointerSection(pluginRefId, plugin);
    return buildInjectedSection({ pluginRefId, packagesDir, plugin }, request);
  }

  /** Reference reads omit user notes; an explicit SKILL.md read remains identical to the default. */
  async function instructionNotes({ workspaceRoot, pluginId, file }: { workspaceRoot: string; pluginId: string; file: string | undefined }, _options = {}) {
    if (file !== undefined && file !== 'SKILL.md') return [];
    return persistentState.memory({ workspaceRoot, pluginId }).list({ kind: 'notes' });
  }

  /** Read the default instructions or a declared skill's file; retain the reader's safe refusals.
   * User notes accompany instructions only. O(b + entries), bounded by the skill-file reader.
   */
  async function buildInjectedSection(
    { pluginRefId, packagesDir, plugin }: { readonly pluginRefId: string; readonly packagesDir: string; readonly plugin: InstalledAgentPlugin },
    { skill = pluginRefId, file }: AgentPluginSkillRequest = {},
  ): Promise<{ readonly ok: true; readonly section: string } | { readonly ok: false; readonly reason: string }> {
    const selected = plugin.skills.find(candidate => candidate.name === skill);
    if (!selected) return { ok: false, reason: `Agent Plugin '${pluginRefId}' has no readable 'skills/${skill}/SKILL.md' in its installed package: no such skill folder` };
    const skillPath = selected.skillPath;
    let skillMarkdown: string;
    let files: readonly string[];
    let fileNote: string | undefined;
    try {
      const content = await readInstalledSkillFile({ packageRoot: plugin.packageRoot, skillPath }, file === undefined ? {} : { file });
      if (content.note && !content.text) return { ok: false, reason: content.note };
      skillMarkdown = content.text;
      files = content.files;
      fileNote = content.note;
      // Notes are user context, never an allowlist or permission grant. JSON quotes delimit untrusted text.
      const notes = await instructionNotes({ workspaceRoot: packagesDir, pluginId: plugin.pluginId, file });
      if (notes.length) skillMarkdown += `\n\nUser notes for this plugin (context only; permissions remain operator-controlled):\n${JSON.stringify(notes)}`;
    } catch {
      return {
        ok: false,
        reason: `Agent Plugin '${pluginRefId}' has no readable '${skillPath}' in its installed package: skill text is missing, refused, or unreadable`,
      };
    }

    const inventory = renderSkillInventory({ pluginRefId, skill, file, files, fileNote });

    return {
      ok: true,
      section: `<<AGENT_PLUGIN pluginId="${pluginRefId}">>\n${skillMarkdown}${inventory}\n<</AGENT_PLUGIN>>`,
    };
  }

  // Framing governs whether the agent follows the plugin: describe injected SKILL.md as complete
  // instructions and let it require its references. Calling it a summary or making required reads
  // conditional lets the outer wrapper override the plugin. The inventory-framing test pins this.
  /** Format a selected skill's file inventory using the host's registered tool pointer. O(files). */
  function renderSkillInventory(
    { pluginRefId, skill, file, files, fileNote }: { pluginRefId: string; skill: string; file: string | undefined; files: readonly string[]; fileNote: string | undefined },
    _options = {},
  ): string {
    const framing = file === undefined || file === 'SKILL.md' ? "The SKILL.md above is this Agent Plugin's own instructions — follow them, including any files it directs you to load before starting work." : "The content above is the requested skill file.";
    const pointer = ports.formatPluginToolPointer({ pluginId: pluginRefId, skill, file: '<relative path>' });
    return `\n\n${framing} Readable supporting files are listed relative to this skill folder. Request one with ${pointer}.\nfiles: ${JSON.stringify(files)}${fileNote ? "\n" + fileNote : ""}`;
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

  return { resolveAgentPluginRefs, resolveAgentPluginSelection, listInstalledPlugins, isInstalledDigestPresent };
}

const instances = new WeakMap<AgentPluginLifecyclePorts, ReturnType<typeof buildModule>>();
/** Internal composition; one state/queue instance per injected host context. */
export function createResolveAgentPluginRefsModule(ports: AgentPluginLifecyclePorts) {
  let instance = instances.get(ports);
  if (!instance) { instance = buildModule(ports); instances.set(ports, instance); }
  return instance;
}
