import { buildDomainRegistrations, indexCatalogById, optionalString, requireInputRecord, type AgentToolSideEffect, type DerivedRiskByToolId, type ToolHandler, type ToolRegistration, type AgentToolDefinition } from "@jini-ai/core";
import { readInstalledAgentPluginIdentity, UNTESTED_PLUGIN_GUIDANCE, type PluginMaturity } from "./identity.js";
import { buildPluginMemoryRegistrations } from "./memory-tools.js";
import type { AgentPluginHostToolPorts, ApplyHostToolApprovalPolicy, HostGuidancePort, PluginToolGuidance } from "./ports.js";
import type { SkillFileResult } from "../skill-file-reader.js";

/**
 * @file Registers each installed, active Agent Plugin as one real ToolRegistry tool.
 *
 * One tool per plugin, with optional skill and file arguments, matches the composer's plugin chip and
 * prevents one multi-skill plugin from crowding native tools out of search results. search_tools
 * is the indexed discovery surface; a parallel capability index would make the agent choose which
 * one to query. Combining skill descriptions dilutes per-term BM25 scores, but keeps result slots
 * available for other tools. Every skill's summary must remain in the combined description so
 * searches can find vocabulary absent from the plugin's top-level name.
 *
 * Tool id scheme: agent_plugin_<pluginId>, with hyphens folded to underscores. A plugin bundles
 * skills and MCP servers; it is not itself a skill. The catalog's first-underscore source splitter
 * labels these as "agent", which is display-only metadata and has no FTS effect. FTS treats
 * underscores as separators and weights id more heavily than description, so the agent/plugin
 * words affect ranking. The install digest stays out of the id to avoid diluting that signal.
 * Multiple installed digests for one id are refused rather than chosen silently. The bundled
 * digest ledger may select the running build's published package when that digest is present;
 * operator installs or a ledger pointing to absent bytes still reach the ambiguity refusal.
 *
 * The optional skill enum documents available skills; ToolRegistry does not enforce schemas.
 * Omitted skill returns the eponymous skill, or the alphabetically-first skill when none matches,
 * plus availableSkills. Concatenating every skill would waste the caller's context. Descriptions
 * and responses identify the default choice. An unknown skill returns the default with a note
 * naming the rejected value and valid choices, so a typo remains recoverable.
 *
 * SECURITY: no absolute host path belongs in ids, descriptions, schemas or handler outputs.
 * packageRoot/skillPath are only local read arguments captured by reader capabilities; AgentPluginToolSource never exposes them.
 * Outputs contain plugin/skill names, guidance markdown and availability, never the source path.
 * The real-install tests assert that the temporary package root is absent from every public field.
 *
 * Dynamic registration is async because installed plugin ids require disk reads. It runs at
 * daemon boot through registerInstalledAgentPluginTools, outside the synchronous ToolContributor
 * seam. Static tools such as search_agent_plugin_local use that seam and read disk in their handlers.
 */
/** Local presentation helper; sibling formatting helpers have no shared contract to keep in sync. */
function humanize(value: string): string {
  return value
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** `agent_plugin_<pluginId>` — see this file's header, "Tool id scheme", for why `agent_plugin_` (an
 *  installed Agent Plugin, the packaging paradigm) is the correct prefix and not `skill_` (one thing
 *  a plugin bundles, not what this tool id names). */
function toAgentPluginToolId(pluginId: string): string {
  return `agent_plugin_${pluginId.replace(/-/g, "_")}`;
}

/** Falls back to the first real prose line when a skill has no (or no parseable) frontmatter — the
 *  reference plugin's own `web-compliance` skill is exactly this case: no frontmatter block at all,
 *  just an H1 followed by real prose. Skips every heading and blank line. */
function extractFallbackSummary(markdown: string): string | undefined {
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (line.length > 0 && !line.startsWith("#")) return line;
  }
  return undefined;
}

/** One skill's summary, for folding into its plugin's combined description — reuses the same
 *  frontmatter/fallback parsing the prior per-skill pilot used, just no longer wrapped into a
 *  standalone tool description of its own. */
export function summarizeSkillMarkdown(skillName: string, markdown: string, ports: Pick<AgentPluginHostToolPorts, "readFrontmatterField">): string {
  return (
    ports.readFrontmatterField({ markdown, key: "description" }) ?? extractFallbackSummary(markdown) ?? `${humanize(skillName)} guidance and reference material.`
  ).replace(/\s+/g, " ").trim();
}

/**
 * Builds this plugin tool's model-facing description — an operator SEARCH TARGET, not a card blurb.
 * Folds every skill's own summary in so the words an operator would plausibly type ("accessibility",
 * "shadcn component library", "review my UI for compliance") appear directly in indexed text, per
 * this file's header. Names the default skill (and, when there is no eponymous skill, why the
 * fallback was chosen) so a caller reading only the description already knows what a bare call
 * returns.
 *
 * Leads with a scoped "load guidance to use or apply..." clause rather than a bare noun phrase — a live test
 * found the model choosing a native verb-style tool (e.g. `theme_list`) over this plugin even when
 * this plugin's own tool ranked #1 in search for the same query, on prompts where both plausibly fit
 * ("make it look polished and professional"). The imperative opening is a controlled experiment
 * against that selection bias, not a search-ranking change — the skill-vocabulary tail below is
 * unchanged and still does the BM25 work.
 */
function buildPluginToolDescription(
  pluginId: string,
  skills: readonly AgentPluginSkillDetail[],
  defaultSkillName: string,
  defaultSkillReason: string | undefined,
  navigation: string | undefined,
): string {
  const humanPlugin = humanize(pluginId);
  const defaultNote = defaultSkillReason
    ? `Called with no argument, returns the '${defaultSkillName}' skill (${defaultSkillReason}).`
    : `Called with no argument, returns this plugin's own eponymous '${defaultSkillName}' skill.`;
  const details = skills.map((skill) => `${humanize(skill.name)} (${skill.name}) — ${skill.summary}`).join(" | ");
  return (
    `Load guidance to use or apply this plugin before making any design/implementation decision in its domain — ` +
    `${humanPlugin} guidance from the installed '${pluginId}' Agent Plugin, covering ${skills.length} ` +
    `skill${skills.length === 1 ? "" : "s"}: ${details} ${defaultNote} Pass the optional 'skill' argument ` +
    `to request a different one by name. Pass optional 'file' (for example 'references/foundations.md') ` +
    `relative to the chosen skill folder to read supporting text instead of SKILL.md. Every response lists ` +
    `readable supporting files and other skills with short descriptions; unknown or refused files return a recovery note.` +
    (navigation === undefined ? "" : ` ${navigation}`)
  );
}

/** One installed plugin's one skill, fully resolved for tool registration — no host paths, a deferred
 *  reader capability for supporting-file requests at call time. See this file's header, SECURITY. */
export interface AgentPluginSkillDetail {
  readonly name: string;
  readonly summary: string;
  readonly markdown: string;
  /** Deferred shared-reader capability; its closed-over host paths never enter model output. */
  readonly readFile?: (input: Record<string, never>, options?: { readonly file?: string }) => Promise<SkillFileResult>;
}

/** One installed Agent Plugin, fully resolved into a single tool-ready source. See this file's
 *  header, SECURITY. */
export interface AgentPluginToolSource {
  readonly maturity?: PluginMaturity | undefined;
  readonly id: string;
  readonly pluginId: string;
  /** The archive digest whose extracted bytes this source's skills were read from — carried so the
   *  per-call gate below can re-establish that THIS package is still installed, and so a
   *  registration is pinned to the exact install it was built from rather than to whatever happens
   *  to answer to the same plugin id later. A content hash, not a host path: it names no directory
   *  a caller does not already have to know, and `AgentPluginUninstallPreview.archiveDigests`
   *  already shows it to a human, so it does not weaken this file's SECURITY property above. */
  readonly archiveDigest: string;
  readonly description: string;
  readonly skills: readonly AgentPluginSkillDetail[];
  /** The skill name a no-argument (or unrecognized-argument) call returns — the plugin's own
   *  eponymous skill when one exists, otherwise a documented fallback (see this file's header). */
  readonly defaultSkillName: string;
  /** Set only when {@link defaultSkillName} is NOT the plugin's eponymous skill — the human-readable
   *  reason folded into both the description and every default-path handler response. */
  readonly defaultSkillReason?: string;
}

/** One installed plugin's manifest identity, as `listInstalledPlugins` returns it — the narrow
 *  slice {@link assertSingleDigestPerPlugin} needs, named separately so that guard doesn't have to
 *  import the whole `InstalledAgentPlugin` shape. */
interface InstalledPluginIdentity {
  readonly pluginId: string;
  readonly archiveDigest: string;
}

/**
 * Refuses loudly when the SAME plugin id is installed under two different archive digests —
 * mutates `digestByPluginId` as its record of "digest seen so far per plugin id". Split out of
 * {@link loadInstalledAgentPluginToolSources}'s loop so that loop is left with only the two things
 * it must do per plugin: check-and-record identity, then (if unique) resolve its tool source.
 *
 * @throws {Error} Caught per-plugin by {@link loadInstalledAgentPluginToolSources}'s own loop,
 * which logs it and skips only this one plugin — the throw itself stays the loud, correct signal
 * for this specific plugin's ambiguity; only where it is caught changed.
 */
function assertSingleDigestPerPlugin(digestByPluginId: Map<string, string>, plugin: InstalledPluginIdentity): void {
  const priorDigest = digestByPluginId.get(plugin.pluginId);
  if (priorDigest !== undefined && priorDigest !== plugin.archiveDigest) {
    throw new Error(
      `agent-plugin tools: '${plugin.pluginId}' is installed under more than one digest ` +
        `(${priorDigest} and ${plugin.archiveDigest}) — this module wires one tool id per installed plugin id ` +
        `with no digest in the id, so an operator must remove the stale install before this plugin can be wired as a tool`,
    );
  }
  digestByPluginId.set(plugin.pluginId, plugin.archiveDigest);
}

/** Reads and summarizes every one of one installed plugin's skills — the only `await`-per-item
 *  work in the whole load, isolated so the caller's loop has no nested `for` of its own. */
async function resolveSkillsForPlugin(plugin: {
  readonly packageRoot: string;
  readonly skills: readonly { readonly name: string; readonly skillPath: string }[];
}, ports: AgentPluginHostToolPorts): Promise<AgentPluginSkillDetail[]> {
  const skills: AgentPluginSkillDetail[] = [];
  for (const skill of plugin.skills) {
    const markdown = await ports.lifecycle.readInstalledSkillMarkdown({ packageRoot: plugin.packageRoot, skillPath: skill.skillPath });
    skills.push({ name: skill.name, summary: summarizeSkillMarkdown(skill.name, markdown, ports), markdown,
      readFile: (_input, options = {}) => ports.lifecycle.readInstalledSkillFile({ packageRoot: plugin.packageRoot, skillPath: skill.skillPath }, options),
    });
  }
  return skills;
}


/** Which skill a no-argument (or unrecognized-argument) call to this plugin's tool returns —
 *  the plugin's own eponymous skill when one exists, otherwise its alphabetically-first skill (see
 *  this file's header, "The optional `skill` argument"). A pure defaulting decision, isolated from
 *  the source-object construction that consumes it.
 *
 *  @param skills Never empty — every caller only reaches this after the plugin's own
 *  `skills.length === 0` short-circuit. */
function resolveDefaultSkill(
  skills: readonly AgentPluginSkillDetail[],
  pluginId: string,
): { readonly defaultSkillName: string; readonly defaultSkillReason?: string } {
  const eponymous = skills.find((skill) => skill.name === pluginId);
  if (eponymous) return { defaultSkillName: eponymous.name };

  // Guarded by every caller (`skills.length === 0` short-circuits first), so `skills[0]` is
  // always defined here.
  const fallbackSkill = skills[0] as AgentPluginSkillDetail;
  return {
    defaultSkillName: fallbackSkill.name,
    defaultSkillReason:
      `no eponymous skill folder ('skills/${pluginId}/SKILL.md') exists in this installed package — ` +
      `defaulting to its alphabetically-first skill`,
  };
}

/** Assembles one installed plugin's fully-resolved {@link AgentPluginToolSource} from its already
 *  fetched skills — pure construction, no I/O, so it's the composition {@link
 *  loadInstalledAgentPluginToolSources}'s loop reduces to a call. */
function buildToolSource(plugin: AgentPluginToolIdentity, skills: readonly AgentPluginSkillDetail[], ports: AgentPluginHostToolPorts): AgentPluginToolSource {
  const { pluginId, archiveDigest } = plugin;
  const { defaultSkillName, defaultSkillReason } = resolveDefaultSkill(skills, pluginId);
  return {
    id: toAgentPluginToolId(pluginId),
    pluginId,
    archiveDigest,
    maturity: plugin.maturity,
    description: buildPluginToolDescription(pluginId, skills, defaultSkillName, defaultSkillReason, ports.messages?.pluginToolNavigation) + (plugin.publisherId ? ` Plugin discovery: ${[plugin.publisherId, ...(plugin.keywords ?? []), ...(plugin.provides ?? [])].join(" ")}.` : ""),
    skills,
    defaultSkillName,
    ...(defaultSkillReason !== undefined ? { defaultSkillReason } : {}),
  };
}

/**
 * Loads every installed Agent Plugin for one workspace, resolved into one tool-ready source per
 * plugin. Per-plugin failures are isolated: a pluginId installed under more than one digest (a
 * genuine, actionable ambiguity — see this file's header for why the digest itself is not folded
 * into the id) — or any other per-plugin resolution failure, e.g. an unreadable SKILL.md — is
 * logged via `console.warn` and excluded from the returned array, but never aborts the whole load.
 * One bad plugin install must not take every other installed plugin's tool down with it.
 *
 * @complexity O(d * s) in installed-digest count times average skills-per-digest, dominated by
 * `listInstalledPlugins`'s own walk plus one `readInstalledSkillMarkdown` per skill.
 */
export async function loadInstalledAgentPluginToolSources(ctx: {
  readonly workspaceId: string;
  readonly ports: AgentPluginHostToolPorts;
}, _optional = {}): Promise<readonly AgentPluginToolSource[]> {
  const { lifecycle, activations: activationPort } = ctx.ports;
  const workspaceLayout = ctx.ports.layout.forWorkspace({ workspaceId: ctx.workspaceId });
  // Superseded installs of a BUNDLED plugin are dropped BEFORE the ambiguity guard below ever sees
  // them, by the build's own recorded answer rather than by picking one — see `bundled-digests.ts`.
  // An id that ledger has no authority over still reaches `assertSingleDigestPerPlugin` unchanged.
  const installed = lifecycle.preferBundledAgentPluginDigests({
    installed: await lifecycle.listInstalledPlugins({ workspaceRoot: workspaceLayout.root }),
    bundled: await lifecycle.readBundledAgentPluginDigests({ workspaceRoot: workspaceLayout.root }),
  });

  // Filter inactive plugins through the shared lifecycle owner
  // BEFORE the ambiguity check below on purpose: two installed digests of a plugin nobody has
  // enabled is not an operator-actionable error, and throwing on it would let a dormant, disabled
  // package break tool registration for every OTHER plugin in the workspace.
  const activations = await activationPort.readAgentPluginActivations({ workspaceRoot: workspaceLayout.root });
  const active = activationPort.filterActiveAgentPlugins({ activations: activations, items: installed, pluginIdOf: ({ item: plugin }) => plugin.pluginId });

  const digestByPluginId = new Map<string, string>();
  // Keyed by pluginId (not a plain array) so a LATER conflicting digest can retract an EARLIER
  // digest's already-resolved source for the same plugin — `assertSingleDigestPerPlugin` only
  // throws on the second digest it sees for a given id, so a plain per-iteration push would let
  // ambiguity silently keep whichever digest happened to resolve first, which is exactly the
  // "silently picking one" outcome this file's header says the ambiguity guard must refuse.
  const sourceByPluginId = new Map<string, AgentPluginToolSource>();
  const poisonedPluginIds = new Set<string>();

  for (const plugin of active) {
    if (poisonedPluginIds.has(plugin.pluginId)) continue; // already ruled ambiguous; stays excluded

    try {
      assertSingleDigestPerPlugin(digestByPluginId, plugin);
      // Empty skills leave nothing this plugin's tool could ever return.
      if (plugin.skills.length > 0) {
        const skills = await resolveSkillsForPlugin(plugin, ctx.ports);
        const identity = await readInstalledAgentPluginIdentity({ plugin });
        sourceByPluginId.set(plugin.pluginId, buildToolSource({ ...plugin, maturity: identity.maturity, publisherId: identity.id, keywords: identity.keywords, provides: identity.provides }, skills, ctx.ports));
      }
    } catch (error) {
      // Isolated per plugin so one bad install (digest ambiguity, an unreadable SKILL.md, ...)
      // cannot take every OTHER installed plugin's tool down with it — see this file's header,
      // "The install DIGEST is deliberately NOT part of the id", for why the digest-ambiguity case
      // itself is still a genuine, actionable refusal, just scoped to this one plugin now.
      sourceByPluginId.delete(plugin.pluginId);
      poisonedPluginIds.add(plugin.pluginId);
      console.warn(`[agent-plugins] '${plugin.pluginId}': ${error instanceof Error ? error.message : String(error)} — skipped`);
    }
  }
  return [...sourceByPluginId.values()];
}

/** This module's own risk classification: every plugin tool is a pure read of already-installed,
 *  already-validated local content — no domain call, no write path. */
export function agentPluginToolDerivedRisk({ sources }: { readonly sources: readonly AgentPluginToolSource[] }, _optional: Record<string, never> = {}): DerivedRiskByToolId {
  return new Map<string, AgentToolSideEffect>(sources.map((source) => [source.id, "none"]));
}

/** `inputSchema` for one plugin's tool: optional `file` and `skill` strings, the skill `enum` documenting
 *  every valid value for THIS installed plugin. Documentation only — `@jini-ai/core`'s
 *  `ToolRegistry` never parses or validates `inputSchema`, so an unrecognized value can never be
 *  rejected before it reaches {@link readSkillArgument} / {@link buildPluginToolResult}, which
 *  handle it gracefully rather than relying on schema enforcement that does not exist. */
function buildPluginInputSchema(source: AgentPluginToolSource): Record<string, unknown> {
  const skillNames = source.skills.map((skill) => skill.name);
  return {
    type: "object",
    additionalProperties: false,
    required: [],
    properties: {
      file: {
        type: "string",
        description: "Optional supporting text file relative to the chosen skill folder, e.g. references/foundations.md. Omit to read SKILL.md. Use paths from files in the previous result. Unknown, unsafe, binary or over-256-KiB files return a note and valid files.",
      },
      skill: {
        type: "string",
        enum: skillNames,
        description:
          `Optional. Request one specific skill's full guidance instead of the default overview. One of: ` +
          `${skillNames.join(", ")}. Defaults to '${source.defaultSkillName}' when omitted; an unrecognized ` +
          `value falls back to that same default and reports the valid values instead of failing.`,
      },
    },
  };
}

/** Reads optional `skill` and `file` arguments off `ctx.input`, refusing any OTHER field (mirrors
 *  `requireNoInput`'s "reject a populated-but-wrong shape" discipline for the fields this tool
 *  does accept) but never rejecting a `skill` value merely because it does not name a real skill —
 *  see this file's header on why an unrecognized value is a graceful fallback, not a thrown error. */
function readSkillArgument(rawInput: unknown): { skill?: string; file?: string } {
  if (rawInput === undefined) return {};
  const input = requireInputRecord({ input: rawInput });
  const unexpectedKeys = Object.keys(input).filter((key) => key !== "skill" && key !== "file");
  if (unexpectedKeys.length > 0) {
    throw new Error(`this tool accepts only optional 'skill' and 'file' arguments — unexpected field(s): ${unexpectedKeys.join(", ")}`);
  }
  const skill = optionalString({ input, key: "skill" });
  const file = optionalString({ input, key: "file" });
  return { ...(skill !== undefined ? { skill } : {}), ...(file !== undefined ? { file } : {}) };
}

/**
 * Resolves one plugin tool's response for a given (possibly absent, possibly unrecognized)
 * requested skill name and optional supporting file. Disk access stays behind the shared-reader capability.
 *
 * - A recognized `requestedSkill` returns exactly that skill.
 * - `undefined` (argument omitted) returns {@link AgentPluginToolSource.defaultSkillName}.
 * - An unrecognized, non-empty `requestedSkill` ALSO returns the default skill, plus a `note`
 *   naming the value that was not recognized and listing every valid one — never a thrown error.
 *
 * Every response additionally carries `files` and `availableSkills`: every other skill name and description this plugin has, so
 * a model that got the default (or a specific skill) still knows what else it can ask for next.
 */
async function buildPluginToolResult(source: AgentPluginToolSource, input: { skill?: string; file?: string }): Promise<Record<string, unknown>> {
  const { selected, requestedSkill, match, fallback } = selectPluginSkill({ source, input });
  const content = await readPluginSkillGuidance({ selected }, input);
  const notes = [content.note];
  if (requestedSkill !== undefined && !match) {
    // Reflect only a simple name; a caller-supplied absolute path must never appear in a note.
    const label = /^[a-z0-9-]+$/.test(requestedSkill) ? ` '${requestedSkill}'` : "";
    notes.push(`Unrecognized skill${label} for the '${source.pluginId}' plugin — showing the default skill '${fallback.name}' instead. Valid values: ${source.skills.map(skill => skill.name).join(", ")}.`);
  }
  if (input.file !== undefined && !selected.readFile) notes.push("File request refused: no supporting-file reader is available. Valid supporting files: (none).");
  return {
    pluginId: source.pluginId,
    ...(source.maturity ? { maturity: source.maturity } : {}),
    skillName: selected.name,
    // Any maturity flag ("untested" or "soon") means not tested end to end: caution before keys/actions.
    guidance: source.maturity ? `${UNTESTED_PLUGIN_GUIDANCE}\n\n${content.guidance}` : content.guidance,
    files: content.files,
    // Keep the availability list short without removing vocabulary from the indexed description.
    availableSkills: source.skills.filter(skill => skill.name !== selected.name).map(skill => ({ name: skill.name, description: skill.summary.slice(0, 320) })),
    ...(notes.some(Boolean) ? { note: notes.filter(Boolean).join(" ") } : {}),
  };
}

/**
 * ===========================================================================================
 * REVOCATION — the activation gate has to run AGAIN, per call, or a disable never lands
 * ===========================================================================================
 *
 * {@link loadInstalledAgentPluginToolSources}'s own ACTIVATION GATE runs exactly once, because
 * `registerInstalledAgentPluginTools` runs exactly once: inside `agent-daemon-server.ts`'s
 * `start()`. `@jini-ai/core`'s `ToolRegistry` is append-only BY DESIGN — its own header calls that
 * out ("unregister is not exposed; ... tools are registered once at composition time") — so nothing
 * anywhere can take a registration back out of a daemon that is already running.
 *
 * Boot-only activation checks would retain a disabled plugin's guidance until restart, even
 * while admin/tool responses report successful revocation. Invocation must re-read activation
 * just as run-start reference injection and discovery do.
 *
 * The gate therefore moves to where the capability is actually spent — the invocation itself. This
 * is not "a filter bolted onto the read path": `@jini-ai/core`'s `authorizeToolInvocation` consults
 * a registration's `ToolPolicy` BEFORE it will hand the handler back to `ToolExecutor`, and the
 * handler is unreachable by any other route, so a policy check here is the single sink for running
 * one of these tools, not one of several. A revoked plugin's call ends as `denied` without the
 * handler ever being entered, and the daemon's own audit record says so.
 *
 * ---------------------------------------------------------------------------
 * Activation and installation must both remain valid
 * ---------------------------------------------------------------------------
 * Gating on the activation record alone would re-admit an uninstalled plugin.
 * Uninstall deletes the record and isAgentPluginActive treats an absent record as active, so
 * disable-then-uninstall can otherwise flip deny back to allow. Absence means "nobody recorded
 * a decision", which is only consent while the operator's own install is still standing behind it.
 * Once the package is gone, there is no install left to imply anything.
 *
 * So the gate asks BOTH halves, and authorizes only when both answer positively:
 *
 * 1. **Still activated** — via `activation.ts`'s `resolveAgentPluginActivation`, the fail-CLOSED
 *    reader added for this call site. `absent record` still means active (that rule is untouched),
 *    but an activations file that cannot be read, parsed, or shape-checked — or that holds a
 *    malformed record for THIS plugin — is `undetermined` and denies, rather than being laundered
 *    into "nothing recorded, therefore permitted". This is the one place that diverges from the
 *    other two gate surfaces' fail-OPEN read, and only on FAULTS, never on what "active" means: a
 *    corrupt byte must not hide an operator's plugins from discovery, and equally must not hand out
 *    a capability nobody can confirm was granted. Here the divergence also buys the error surface
 *    `activation.ts`'s header says fail-closed lacks — a denied call is recorded as `denied` in the
 *    daemon's audit trail, and the gate logs the reason.
 * 2. **Still installed** — via `resolve-agent-plugin-refs.ts`'s `isInstalledDigestPresent`, one
 *    `stat` of the exact `archiveDigest` this registration's guidance was read from. Not
 *    `listInstalledPlugins` (which walks and re-indexes every digest directory, far too much per
 *    call) and not a stored `packageRoot` (a host path this file's SECURITY section keeps off
 *    `AgentPluginToolSource` entirely) — the digest is a content identifier, and the module that
 *    owns the `<packages>/<digest>` layout derives the path from it.
 *
 * Checked in that ORDER, deliberately, because it is what makes the pair safe against a concurrent
 * uninstall: `uninstall.ts` renames the package aside FIRST and deletes the record SECOND, so the
 * gate reads them in the opposite order. An interleaving that sees the record already deleted
 * ("active") therefore cannot also see the package still present — the rename strictly preceded the
 * delete it just observed. Reading installation first would leave exactly that window open.
 *
 * Pinning to the DIGEST rather than the plugin id has a second, deliberate effect: uninstalling a
 * plugin and reinstalling the same id from a different archive does not silently re-admit the boot
 * registration, whose handler still holds the OLD package's guidance in memory. It stays denied
 * until the restart `UNINSTALL_RESTART_NOTE` already tells the operator about.
 *
 * Consequences worth stating rather than discovering later:
 * - Revocation is immediate and reversible in BOTH directions for a tool that was registered at
 *   boot. It is NOT symmetric for one that was not: enabling a plugin that was disabled when the
 *   daemon started still needs a restart, because there is no registration to re-admit. That is the
 *   asymmetry `plugin-runtime/tool-registrations.ts`'s `restartNoteFor` reports to the model.
 * - The tool stays VISIBLE. `registry.list()` and `search_tools`' one-shot FTS snapshot
 *   (`agent-daemon-server.ts`) are both append-only too, so a revoked plugin's tool can still be
 *   found and attempted; it just cannot run. Hiding it needs a registry mutation API that does not
 *   exist, and a visible-but-refusing tool is the safe direction of that pair.
 * - Every failure mode of both halves denies: a missing package directory, a non-directory at that
 *   path, a digest that does not match the installed-directory grammar, an EACCES/EIO on either
 *   read, a torn or hand-edited activations file. There is no input to either check for which "I
 *   could not tell" comes back as `allow`.
 */

/** The identity of the exact installed package ONE registration was built from. Both fields are
 *  content identifiers — a manifest-declared plugin name and an archive digest — never host paths,
 *  so this stays inside this file's SECURITY property above. */
export interface AgentPluginToolIdentity {
  readonly maturity?: PluginMaturity | undefined;
  readonly publisherId?: string;
  readonly keywords?: readonly string[];
  readonly provides?: readonly string[];
  readonly pluginId: string;
  readonly archiveDigest: string;
}

export interface AgentPluginToolGate {
  /** Whether this exact installed package may still run: re-reads the activation record AND
   *  re-confirms the package is still on disk, answering `false` unless both say yes. */
  isCallable(plugin: AgentPluginToolIdentity): Promise<boolean>;
}

/**
 * The production gate: one small `activations.json` read plus one `stat` per tool call, both against
 * the same `forWorkspace()` layout every other path in this feature goes through.
 *
 * Deliberately NOT cached. Both facts change when a human toggles or uninstalls a plugin, and the
 * whole point of this gate is that such an act is observed by the very next call; a cache would
 * reintroduce the staleness window the gate exists to close, to save two sub-millisecond reads on a
 * human-paced call.
 *
 * @param ctx.workspaceId - The tenant whose record and packages are consulted. Never an
 * instance-level path.
 * @returns A gate whose answer is established fresh per call, and which denies on any fault.
 * @complexity O(p) per call in the recorded plugin count, plus one small file read and one `stat`.
 */
export function createAgentPluginToolGate(ctx: { readonly workspaceId: string; readonly ports: AgentPluginHostToolPorts }, _optional = {}): AgentPluginToolGate {
  const { lifecycle, activations } = ctx.ports;
  const workspaceLayout = ctx.ports.layout.forWorkspace({ workspaceId: ctx.workspaceId });
  return {
    async isCallable(plugin: AgentPluginToolIdentity): Promise<boolean> {
      // Activation FIRST, installation SECOND — the reverse of uninstall's own order. See the
      // REVOCATION note above for why that ordering is what closes the concurrent-uninstall window.
      const activation = await activations.resolveAgentPluginActivation({ workspaceRoot: workspaceLayout.root, pluginId: plugin.pluginId });
      if (activation.verdict === "undetermined") {
        // The error surface fail-CLOSED is supposed to lack: an operator whose activations file is
        // damaged gets a denial they can see the cause of, next to the daemon's own `denied` record.
        console.warn(
          `[agent-plugins] '${plugin.pluginId}': tool call denied — activation could not be established (${activation.reason})`,
        );
        return false;
      }
      if (activation.verdict !== "active") return false;

      return lifecycle.isInstalledDigestPresent({ packagesDir: workspaceLayout.pluginPackagesDir({ pluginId: plugin.pluginId }), archiveDigest: plugin.archiveDigest });
    },
  };
}

/**
 * Wraps one registration's policy so the plugin's CURRENT activation AND installation are both
 * re-established before its handler can be reached, then defers to the policy
 * `buildDomainRegistrations` already attached.
 *
 * Deferring rather than replacing matters: the kit's policy is a deliberate pass-through today
 * (each tool's permission is evaluated at its own chokepoint), and a future kit that puts something
 * real there must not be silently dropped by this wrapper.
 *
 * @complexity O(1) plus the gate's own two reads.
 */
function withToolGate(registration: ToolRegistration, gate: AgentPluginToolGate, plugin: AgentPluginToolIdentity): ToolRegistration {
  const inner = registration.policy;
  return {
    ...registration,
    policy: {
      async authorize(authCtx) {
        if (!(await gate.isCallable(plugin))) return "deny";
        return inner.authorize(authCtx);
      },
    },
  };
}

/**
 * Turns already-resolved plugin sources into real `ToolRegistration`s — pure and synchronous, unlike
 * {@link loadInstalledAgentPluginToolSources}, so this is the half a unit test exercises without
 * touching disk. Uses the SAME `buildDomainRegistrations` gate every other domain's
 * `tool-registrations.ts` uses (catalog/risk cross-check, `inputSchema` presence, drift tripwire) —
 * not a parallel mechanism.
 *
 * `gate` is required, not optional, and is applied HERE rather than by the caller for the
 * reason this file's REVOCATION note above gives: a gate a call site has to remember to attach is a
 * gate some future call site will register tools without. Every registration this function can
 * produce carries it. The build itself stays synchronous and touches no disk — the gate reads only
 * when a call is actually authorized.
 *
 * @param sources - Already-resolved, already-activation-filtered plugin sources.
 * @param gate - The per-call revocation gate (see {@link createAgentPluginToolGate}).
 * @complexity O(n) in source count; each source's gate reads are deferred to invocation.
 */
export function buildAgentPluginToolRegistrations(
  { sources, gate, withExtensionApprovalPolicy, ports }: { sources: readonly AgentPluginToolSource[]; gate: AgentPluginToolGate; withExtensionApprovalPolicy: ApplyHostToolApprovalPolicy; ports: Pick<AgentPluginHostToolPorts, "permissions" | "metadata"> },
  _optional: Record<string, never> = {},
): ToolRegistration[] {
  const catalog: AgentToolDefinition[] = sources.map((source) => ({
    name: source.id,
    description: source.description,
    sideEffects: "none",
    authorization: { permission: ports.permissions.use },
    inputSchema: buildPluginInputSchema(source),
  }));

  const handlers: Record<string, ToolHandler> = {};
  const identityByToolId = new Map<string, AgentPluginToolIdentity>();
  for (const source of sources) {
    handlers[source.id] = async (ctx) => buildPluginToolResult(source, readSkillArgument(ctx.input));
    identityByToolId.set(source.id, { pluginId: source.pluginId, archiveDigest: source.archiveDigest });
  }

  const registrations = buildDomainRegistrations({ ...(ports.metadata ? { metadata: ports.metadata } : {}),
    domain: "agent-plugin-skill",
    catalogModule: "lifecycle/host-tools/skill-tool.ts",
    catalog: indexCatalogById({ catalog: catalog }),
    handlers,
    derivedRisk: agentPluginToolDerivedRisk({ sources }),
  });

  return registrations.map((registration) => {
    const identity = identityByToolId.get(registration.descriptor.id);
    // Unreachable via this function — every registration comes from `handlers`, whose keys are the
    // same `source.id`s the map was built from. Guarded rather than asserted with `!` so a future
    // kit that synthesized an extra registration would be REFUSED rather than silently ungated.
    if (identity === undefined) {
      throw new Error(
        `tool-registrations: '${registration.descriptor.id}' has no owning Agent Plugin, so its activation could not be gated`,
      );
    }
    return withExtensionApprovalPolicy({ registration: withToolGate(registration, gate, identity), family: 'installed-guidance' });
  });
}

/**
 * Composition-root entry point: loads every installed plugin for one workspace and registers each
 * as a real tool directly on `registry` — the same `registry.register(registration)` call
 * `agent-daemon-server.ts`'s own top-level loops make for `buildAssistantToolRegistrations`'s output,
 * just awaited first. See this file's header for why this is a standalone async function rather than
 * a `ToolContributor`, and why it is not (yet) called from that live boot sequence.
 *
 * Registers with the REAL gate, so every tool this puts into the daemon's registry stops answering
 * the moment its plugin is switched off OR uninstalled — see the REVOCATION note above
 * {@link createAgentPluginToolGate}.
 *
 * Each guidance answer carries the host's overlay for that plugin (`optional.hostGuidance`): its
 * `GUIDANCE.md` after any maturity notice, and its `host/` files. Without that port the plugin's own
 * guidance is returned as is.
 */
export async function registerInstalledAgentPluginTools(
  ctx: { readonly registry: { register: (registration: ToolRegistration) => void }; readonly workspaceId: string; readonly ports: AgentPluginHostToolPorts; readonly withExtensionApprovalPolicy: ApplyHostToolApprovalPolicy },
  optional: { readonly hostGuidance?: HostGuidancePort } = {},
): Promise<void> {
  const { registry, ports } = ctx;
  const { hostGuidance } = optional;
  const sources = await loadInstalledAgentPluginToolSources(ctx);
  const gate = createAgentPluginToolGate(ctx);
  for (const registration of buildAgentPluginToolRegistrations({ sources, gate, withExtensionApprovalPolicy: ctx.withExtensionApprovalPolicy, ports })) {
    const handler = registration.handler;
    // Runs after the gate authorized the call, so a disabled plugin never reaches its overlay.
    // A `host/` file is the host's, never the plugin's: the plugin answers its default, the host the file.
    registry.register({ ...registration, handler: async (execution, executionOptional) => {
      const hostFile = requestedHostPluginFile(execution.input, hostGuidance);
      const pluginExecution = hostFile === undefined ? execution : { ...execution, input: withoutFileArgument(execution.input) };
      const result = await handler(pluginExecution, executionOptional) as PluginToolGuidance & { maturity?: PluginMaturity };
      const delivered = hostGuidance === undefined ? { guidance: result.guidance } : await hostGuidance.deliver({ result, ...(hostFile !== undefined ? { file: hostFile } : {}) },
        { ...(result.maturity ? { notice: UNTESTED_PLUGIN_GUIDANCE } : {}) });
      return { ...result, ...delivered, guidance: await ports.memory.appendNotes({ workspaceId: ctx.workspaceId,
        pluginId: result.pluginId, guidance: delivered.guidance,
      }) };
    } });
  }
  for (const registration of buildPluginMemoryRegistrations({ sources, workspaceId: ctx.workspaceId, ports, gate, withExtensionApprovalPolicy: ctx.withExtensionApprovalPolicy })) registry.register(registration);
}

/** The `host/` file a plugin tool call names, if any; any other input is the handler's to validate. */
function requestedHostPluginFile(input: unknown, hostGuidance: HostGuidancePort | undefined): string | undefined {
  const file = typeof input === "object" && input !== null ? (input as { file?: unknown }).file : undefined;
  return typeof file === "string" && hostGuidance?.isFileRequest({ file }) === true ? file : undefined;
}

/** The same input minus `file`, so the plugin's own skill/field validation still runs. */
function withoutFileArgument(input: unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([key]) => key !== "file"));
}


function selectPluginSkill(
  { source, input }: { source: AgentPluginToolSource; input: { skill?: string } },
  _optional: Record<string, never> = {},
) {
  const requestedSkill = input.skill;
  const match = source.skills.find(skill => skill.name === requestedSkill);
  const fallback = source.skills.find(skill => skill.name === source.defaultSkillName);
  if (!fallback) {
    // Cannot happen in practice: `defaultSkillName` is always chosen FROM `source.skills` in
    // `loadInstalledAgentPluginToolSources`. Guarded rather than asserted with `!` so a future bug
    // here fails loudly with an actionable message instead of a null-dereference.
    throw new Error(`agent-plugin tool '${source.id}': default skill '${source.defaultSkillName}' missing from its own skill list`);
  }

  return { selected: match ?? fallback, requestedSkill, match, fallback };
}

async function readPluginSkillGuidance(
  { selected }: { selected: AgentPluginSkillDetail },
  optional: { file?: string } = {},
) {
  const fileOptions = optional.file !== undefined ? { file: optional.file } : {};
  const content = selected.readFile ? await selected.readFile({}, fileOptions) : undefined;
  // An unknown/refused file keeps the skill's instructions available, like unknown-skill recovery.
  return {
    guidance: content && !(content.note && !content.text) ? content.text : selected.markdown,
    files: content?.files ?? [],
    note: content?.note,
  };
}
