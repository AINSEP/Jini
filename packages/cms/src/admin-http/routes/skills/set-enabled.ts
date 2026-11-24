import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { authorizeSkills, rejectSkillInput, rejectSkillInputError, skillToolIdParam, type SkillInputErrorTest, type SkillRoutePrincipal } from "./shared.js";

/** Writes one skill's enabled flag. Injected: the flag lives in the host's skill layout on disk. */
export type SkillSetEnabledFn = (required: { workspaceId: string; toolId: string; enabled: boolean }) => Promise<void>;

/** The deps this route reads. */
export interface SkillSetEnabledRouteDeps {
  workspaceId: string;
  setSkillEnabled: SkillSetEnabledFn;
  isSkillInputError: SkillInputErrorTest;
}

/** The body is exactly `{ enabled: boolean }`; a missing body is a validation error, not a crash. @complexity O(k) in the body keys. */
function enabledFlag({ body }: { body: unknown }, _optional: Record<string, never> = {}): boolean {
  const fields = body as Record<string, unknown> | undefined;
  if (!fields || typeof fields.enabled !== "boolean" || Object.keys(fields).some((key) => key !== "enabled")) {
    rejectSkillInput({ message: "enabled must be a boolean." });
  }
  return fields.enabled as boolean;
}

/** PATCH enable or disable one installed skill. The body is validated after authorization, as before. */
export const skillSetEnabledRoute = defineJsonRoute<{ toolId: string; body: unknown }, { updated: true }, SkillSetEnabledRouteDeps, SkillRoutePrincipal>({
  method: "patch",
  path: "/api/admin/v1/workspaces/:workspaceId/skills/:toolId",
  parse: (raw) => ok({ value: { toolId: skillToolIdParam(raw.params), body: raw.body } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeSkills({ authorize });
    const enabled = enabledFlag({ body: input.body });
    try {
      await deps.setSkillEnabled({ workspaceId: deps.workspaceId, toolId: input.toolId, enabled });
      return ok({ value: { updated: true as const } });
    } catch (err) {
      return rejectSkillInputError({ err, isSkillInputError: deps.isSkillInputError });
    }
  },
});
