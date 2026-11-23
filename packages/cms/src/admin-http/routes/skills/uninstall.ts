import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { authorizeSkills, rejectSkillInputError, skillToolIdParam, type SkillInputErrorTest, type SkillRoutePrincipal } from "./shared.js";

/** Removes one installed skill. Injected: removal deletes its folder from the host's skill layout. */
export type SkillUninstallFn = (required: { workspaceId: string; toolId: string }) => Promise<void>;

/** The deps this route reads. */
export interface SkillUninstallRouteDeps {
  workspaceId: string;
  uninstallSkill: SkillUninstallFn;
  isSkillInputError: SkillInputErrorTest;
}

/** DELETE one installed skill. */
export const skillUninstallRoute = defineJsonRoute<{ toolId: string }, { removed: true }, SkillUninstallRouteDeps, SkillRoutePrincipal>({
  method: "delete",
  path: "/api/admin/v1/workspaces/:workspaceId/skills/:toolId",
  parse: (raw) => ok({ value: { toolId: skillToolIdParam(raw.params) } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeSkills({ authorize });
    try {
      await deps.uninstallSkill({ workspaceId: deps.workspaceId, toolId: input.toolId });
      return ok({ value: { removed: true as const } });
    } catch (err) {
      return rejectSkillInputError({ err, isSkillInputError: deps.isSkillInputError });
    }
  },
});
