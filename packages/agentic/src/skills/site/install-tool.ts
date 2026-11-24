import { toolMetadata } from '@jini-ai/core/tool-metadata/skills';
import { type AuthorizeFn } from "@jini-ai/core/contracts/events";
import {
  buildDomainRegistrations,
  indexCatalogById,
  requireInputRecord,
  ToolInputError,
  type AgentToolDefinition,
  type AgentToolSideEffect,
  type ToolRegistration,
} from "@jini-ai/core";

import type { ToolContributor } from "@jini-ai/core";
import { SkillInputError } from "../install/index.js";
import { commitSkillInstall, listManagedSkills, prepareSkillInstall } from "./install-service.js";

/**
 * @file `skills_install` — installs a standalone Agent Skill from a public GitHub URL, through the
 * SAME `install-service.ts` the admin Skills screen's "Add from GitHub" calls (`routes/skills/
 * manage.ts` -> `installSkill`, which is `prepareSkillInstall` + `commitSkillInstall`). Same
 * `admin.assistant.use` permission as that route.
 *
 * It fetches and validates first, then writes exactly those validated bytes (one fetch, pinned to one
 * commit). No confirmation card (owner 2026-10-07: ordinary installs run directly; trash/delete/publish ask; it shipped with
 * one in 444e9dfca and was dropped the same day) — the admin screen's own dialog is unchanged. Uploaded folders/ZIPs
 * are not a source here: the admin chat composer already installs a dropped skill through the Skills
 * screen's own upload path.
 */

export interface SkillsInstallToolDeps {
  readonly workspaceId: string;
  readonly skillLayout: import("./layout.js").SkillLayout;
  readonly siteBinding: { readonly dir: string };
  readonly authorize: AuthorizeFn;
  /** Test seam for the GitHub fetch; defaults to global `fetch` inside the service. */
  readonly skillFetch?: typeof fetch;
}

export const SKILLS_INSTALL_TOOL_ID = "skills_install";

export const catalog: AgentToolDefinition[] = [{
  name: SKILLS_INSTALL_TOOL_ID,
  description:
    "Installs a standalone Agent Skill (a folder with SKILL.md) from a public GitHub URL into this workspace. Use when the user asks to " +
    "install or add a skill from GitHub. The skill is fetched from api.github.com at one pinned commit and validated before anything is " +
    "written; the result names the skill, its source and commit. The installed skill is ON and becomes its own skill_<name> tool, found by search_tools. Refused if a skill with that name is " +
    "already installed. Installation runs no code. Does not install plugins, Agent Plugins or themes, and does not take local files.",
  sideEffects: "mutates-durable-state",
  authorization: { permission: "admin.assistant.use" },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["githubUrl"],
    properties: {
      githubUrl: {
        type: "string",
        minLength: 1,
        description: "HTTPS github.com repository URL, optionally ending in /tree/<ref>/<skill-folder>, e.g. https://github.com/owner/repo/tree/main/skills/my-skill.",
      },
    },
  },
}];

export const derivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map([
  // -> prepareSkillInstall (GitHub fetch, read-only) then commitSkillInstall: writes the skill folder
  //    under <site>/skills/ws/<workspaceId>/. Durable file writes; no code runs. The admin Skills
  //    screen's Remove is the inverse.
  [SKILLS_INSTALL_TOOL_ID, "mutates-durable-state"],
]);

/** Service refusals are input problems the model can relay; anything else propagates. */
async function asToolInput<T>({ work }: { work: () => Promise<T> }, _optional = {}): Promise<T> {
  try { return await work(); }
  catch (error) { if (error instanceof SkillInputError) { throw new ToolInputError({ message: error.message }); } throw error; }
}

/**
 * Order: authorize -> parse -> fetch+validate -> already-installed check -> write.
 * @complexity O(skill files + bytes).
 */
export function buildRegistrations(deps: SkillsInstallToolDeps): ToolRegistration[] {
  return buildDomainRegistrations({ metadata: toolMetadata,
    domain: "skills-install",
    catalogModule: "features/skills/install-tool.ts",
    catalog: indexCatalogById({ catalog }),
    derivedRisk,
    handlers: {
      [SKILLS_INSTALL_TOOL_ID]: async (ctx) => {
        await deps.skillLayout.host.requireToolPermission({ authorize: deps.authorize, workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "admin.assistant.use" }, { entityType: "skill" });
        const input = requireInputRecord({ input: ctx.input });
        if (typeof input.githubUrl !== "string" || !input.githubUrl.trim() || Object.keys(input).some((key) => key !== "githubUrl")) {
          throw new ToolInputError({ message: "githubUrl (an https://github.com/... URL) is the only, required argument." });
        }
        const githubUrl = input.githubUrl.trim();
        const prepared = await asToolInput({ work: () => prepareSkillInstall({ workspaceId: deps.workspaceId, githubUrl, skillLayout: deps.skillLayout }, deps.skillFetch ? { fetchImpl: deps.skillFetch } : {}) });
        if ((await listManagedSkills(deps)).some((skill) => skill.toolId === prepared.toolId)) {
          throw new ToolInputError({ message: `Skill '${prepared.name}' is already installed. Remove it from the Skills screen before installing another version.` });
        }
        ctx.signal.throwIfAborted();
        const skill = await asToolInput({ work: () => commitSkillInstall({ ...deps, workspaceId: deps.workspaceId, prepared }) });
        return { installed: true, skill, note: `Installed the ${skill.name} skill; it is on. Its tool ${skill.toolId} is picked up by the next search_tools call.` };
      },
    },
  });
}

/** Contributes `skills_install` as its own domain. */
export function contributeSkillsInstallTools(): ToolContributor<SkillsInstallToolDeps, unknown> {
  return { domain: "skills-install", build: buildRegistrations, risk: derivedRisk };
}
