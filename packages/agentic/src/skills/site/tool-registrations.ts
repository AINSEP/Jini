import { toolMetadata } from '@jini-ai/core/tool-metadata/skills';
import { buildSkillToolRegistrations as buildRegistrations, loadInstalledSkillToolSources as loadSources, type InstalledSkillToolPorts, type InstalledSkillToolSource, type SkillToolRegistrationHost } from "../tools/index.js";
import type { ToolRegistration } from "@jini-ai/core";

import { readSkillState } from "../install/index.js";
import { createLiveSkillRegistration, type SkillsRefreshRegistry } from "./live-registration.js";
import type { SkillLayout, SkillSiteHost } from "./layout.js";

/** The host's approval-policy applicator for installed guidance tools. */
type ApplyExtensionApprovalPolicy = SkillToolRegistrationHost["withExtensionApprovalPolicy"];

/**
 * @file Registers every installed standalone Agent Skill (`<site>/skills/ws/<workspaceId>/<dir>/
 * SKILL.md`) as ONE real tool in the `ToolRegistry` — the standalone-skill counterpart to
 * `src/features/agent-plugins/tool-registrations.ts`, structurally mirrored but deliberately NOT
 * built on top of it (owner decision, verbatim: "they are different things. there should be a
 * skills/ and a separate agent-plugins/ directory").
 *
 * ---------------------------------------------------------------------------
 * A Skill is not a Plugin — why that difference reaches this file
 * ---------------------------------------------------------------------------
 * Per the Agent Skills spec (agentskills.io): a skill is a folder — `SKILL.md` with YAML frontmatter
 * (at minimum `name` and `description`), then instructions, plus optional `references/`, `scripts/`,
 * `assets/`. "A single skill doesn't require a plugin wrapper." Loading is PROGRESSIVE DISCLOSURE:
 * discovery sees only `name`/`description`; the full body is read only once the task actually
 * matches. An Agent Plugin (agent-plugins.org, `src/features/agent-plugins/`) is a PACKAGE that
 * bundles multiple skills plus `mcp.json` plus client config — already implemented, and this file
 * does not modify it. Because a standalone skill is already the atomic unit (unlike a plugin, which
 * may bundle several skills under one id), this file is simpler than its agent-plugin counterpart in
 * one structural way worth naming up front: there is no "combined description across many skills" and
 * no optional `skill` argument to pick among them — one skill folder is one tool, full stop.
 *
 * ---------------------------------------------------------------------------
 * Tool id scheme: `skill_<sanitized name>`
 * ---------------------------------------------------------------------------
 * `agent-plugins/tool-registrations.ts`'s own header records that an earlier revision of THAT file
 * used `skill_<pluginId>` and that this was a category error the product owner caught — an Agent
 * Plugin is a packaging paradigm, not itself a skill. That same header explicitly names the
 * consequence: "`skill_` was wrong the moment this file started minting one tool per INSTALLED
 * PLUGIN... and it burned a prefix real standalone skill tools will need later." This file is that
 * later use. `plugin_` is not available either — it collides with the existing native
 * `plugins_list`/`plugins_set_enabled` tools (`features/plugin-runtime/`, an unrelated "plugin"
 * concept). `skill_` is free and is exactly the reserved prefix this feature claims.
 *
 * ---------------------------------------------------------------------------
 * Tool description = the skill's own frontmatter `description`, VERBATIM
 * ---------------------------------------------------------------------------
 * That is the whole point of progressive disclosure: `search_tools`' discovery pass must see what the
 * skill's own author wrote as the trigger condition ("Use when handling production incidents..."),
 * not a wrapper sentence this module invents. No combining, no humanizing, no folding in other
 * fields — unlike the agent-plugin tool's `buildPluginToolDescription`, which has to fold several
 * skills' vocabulary into one description because several skills share one tool there. Here, one
 * skill is one tool, so its own description already IS the correct indexed text.
 *
 * ---------------------------------------------------------------------------
 * The handler's output: full `SKILL.md` body, plus a pointer to the rest — never inlined
 * ---------------------------------------------------------------------------
 * A skill's optional `references/`, `scripts/`, `assets/` files are the second stage of progressive
 * disclosure: read only once the agent is actually doing the task and needs more than the top-level
 * instructions. Inlining their contents into every tool call would defeat that (and, for a skill like
 * this feature's own installed `incident-response` fixture, balloon a call that usually only needs
 * the top-level workflow). The handler instead returns each bundled file's path so the caller can
 * request it with this tool's optional `file` argument (Jini's shared skill-file reader) — the same
 * "list paths, do not inline" progressive disclosure run-start injection uses.
 *
 * Bundled files use `{ root: "site", path }` for direct fs_read_file calls. Files outside
 * the active site (an operator override) are omitted rather than advertising unreadable paths.
 *
 * ---------------------------------------------------------------------------
 * Bad-folder isolation: skip and warn, never throw — except for one real ambiguity
 * ---------------------------------------------------------------------------
 * A skill folder with no `SKILL.md`, or with frontmatter missing `name`/`description`, is skipped
 * with a `console.warn` naming the folder — never fatal to every OTHER folder in the same workspace,
 * mirroring `listInstalledPlugins`'s own per-digest failure isolation. The one case this file DOES
 * throw on on a valid-looking installed set is two DIFFERENT skill folders whose frontmatter `name`
 * collides (so both would mint the identical tool id) — not covered by the "skip a bad folder" rule
 * above, because neither folder is individually bad. This mirrors
 * `loadInstalledAgentPluginToolSources`'s own multi-digest ambiguity guard and the same
 * `resolveOnePluginRef` "more than one match" rule: silently registering only one of the two (e.g.
 * "whichever `readdir` returned first") would be a worse failure than a loud, actionable error,
 * because nothing about the resulting tool call would look wrong until someone noticed it always
 * answered from the folder they did not mean.
 *
 * Architectural role:
 * `loadInstalledSkillToolSources` is the only disk-reading half; `buildSkillToolRegistrations` is
 * pure and synchronous so a unit test exercises the registration/schema/handler shape without a real
 * filesystem, matching the same split `agent-plugins/tool-registrations.ts` keeps.
 */

/** This product's loader effects for `@jini-ai/agentic/skills/tools`: its frontmatter reader, the contained
 *  agent-plugins file reader, its install-state file, and console warnings for skipped folders. */
const skillToolPorts = (host: SkillSiteHost): InstalledSkillToolPorts => ({
  readFrontmatterField: host.readFrontmatterField,
  createFileReader: host.createFileReader,
  isEnabled: async ({ directory }) => (await readSkillState({ directory, stateFileName: host.stateFileName, filesystem: host.filesystem })).enabled,
  report: ({ message }) => console.warn(message),
});

/** Installed skills of one workspace under this site's skill layout; see `loadInstalledSkillToolSources` in `@jini-ai/agentic/skills/tools`. */
export async function loadInstalledSkillToolSources(ctx: {
  readonly includeDisabled?: boolean;
  readonly workspaceId: string;
  readonly skillLayout: SkillLayout;
  readonly siteBinding: { readonly dir: string };
}, _optional = {}): Promise<readonly InstalledSkillToolSource[]> {
  const workspaceRoot = ctx.skillLayout.forWorkspace({ workspaceId: ctx.workspaceId }).root;
  return loadSources({ workspaceRoot, siteDir: ctx.siteBinding.dir, ports: skillToolPorts(ctx.skillLayout.host) },
    ctx.includeDisabled === undefined ? {} : { includeDisabled: ctx.includeDisabled });
}

/** Skill tools with this product's metadata, `admin.assistant.use` permission and `site` file root;
 *  see `buildSkillToolRegistrations` in `@jini-ai/agentic/skills/tools`. */
export function buildSkillToolRegistrations(
  { sources, withExtensionApprovalPolicy }: { sources: readonly InstalledSkillToolSource[]; withExtensionApprovalPolicy: ApplyExtensionApprovalPolicy },
  _optional = {},
): ToolRegistration[] {
  return buildRegistrations({ sources, host: { metadata: toolMetadata, permission: "admin.assistant.use",
    catalogModule: "features/skills/tool-registrations.ts", fileRoot: "site", withExtensionApprovalPolicy } });
}

/**
 * Composition-root entry point: loads every installed standalone Agent Skill for one workspace and
 * registers each as a real tool directly on `registry` — the same `registry.register(registration)`
 * call `agent-daemon-server.ts`'s own top-level loops make for every other domain, just awaited
 * first. Mirrors `agent-plugins/tool-registrations.ts`'s own `registerInstalledAgentPluginTools`.
 */
const liveRegistrations = new WeakMap<object, (tools: readonly ToolRegistration[]) => boolean>();

export async function registerInstalledSkillTools(
  { registry, ctx }: {
    registry: Pick<SkillsRefreshRegistry, "register"> & Partial<Pick<SkillsRefreshRegistry, "has" | "list" | "refreshInstalledSkills">>;
    ctx: { readonly workspaceId: string; readonly skillLayout: SkillLayout; readonly siteBinding: { readonly dir: string }; readonly withExtensionApprovalPolicy: ApplyExtensionApprovalPolicy };
  },
  _optional = {},
): Promise<void> {
  if (!registry.has || !registry.list) {
    for (const registration of buildSkillToolRegistrations({ sources: await loadInstalledSkillToolSources(ctx), withExtensionApprovalPolicy: ctx.withExtensionApprovalPolicy })) registry.register(registration);
    return;
  }
  let replace = liveRegistrations.get(registry);
  if (!replace) {
    replace = createLiveSkillRegistration(registry as SkillsRefreshRegistry);
    liveRegistrations.set(registry, replace);
    // Single-flight disk reads prevent an older snapshot from overwriting a newer one.
    let pending: Promise<boolean> | undefined;
    const apply = replace;
    registry.refreshInstalledSkills = () => {
      if (!pending) pending = loadInstalledSkillToolSources(ctx)
        .then(sources => apply(buildSkillToolRegistrations({ sources, withExtensionApprovalPolicy: ctx.withExtensionApprovalPolicy })))
        .finally(() => { pending = undefined; });
      return pending;
    };
  }
  if (!registry.refreshInstalledSkills) throw new Error("Skill registry has no refresh operation");
  await registry.refreshInstalledSkills();
}
