import type { ToolExecutionContext } from "@jini-ai/core";
import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  authorizeSkills, rejectSkillInputError, rejectSkillNotFound, skillActorId, skillToolIdParam,
  type SkillInputErrorTest, type SkillRoutePrincipal, type SkillToolSourceRef, type SkillToolSourcesLoadFn,
} from "./shared.js";

/** The one part of a skill's tool registration the preview calls: its read-only handler. */
export interface SkillPreviewRegistration { readonly handler: (required: ToolExecutionContext) => Promise<unknown> }

/**
 * Builds the tool registration of one discovered skill. Injected: the registration carries the
 * host's tool metadata and approval policy.
 */
export interface SkillPreviewRegistrations {
  // Method syntax on purpose: method parameters are checked bivariantly, so the host may bind a
  // builder typed on its own richer source type (the exact objects `loadSkillSources` returned).
  build(required: { source: SkillToolSourceRef }): SkillPreviewRegistration | undefined;
}

/** The deps this route reads. */
export interface SkillGuidanceRouteDeps {
  workspaceId: string;
  loadSkillSources: SkillToolSourcesLoadFn;
  skillRegistrations: SkillPreviewRegistrations;
  isSkillInputError: SkillInputErrorTest;
}

/** The preview's fixed execution/run id: a preview is not an assistant run. */
const PREVIEW_ID = "skill-preview";

/** The selected enabled skill's read-only handler payload; 404 when it is unknown or disabled. @complexity O(n) in installed skills. */
async function previewGuidance({ toolId, deps, principalId }: { toolId: string; deps: SkillGuidanceRouteDeps; principalId: string }, _optional: Record<string, never> = {}): Promise<unknown> {
  const sources = await deps.loadSkillSources({});
  const source = sources.find((candidate) => candidate.id === toolId);
  if (!source) rejectSkillNotFound();
  const registration = deps.skillRegistrations.build({ source });
  if (!registration) throw new Error("selected skill has no tool registration for preview");
  // The selected skill's read-only handler and the browser share exactly the same payload.
  return registration.handler({ executionId: PREVIEW_ID, principal: { id: principalId }, run: { id: PREVIEW_ID }, input: {}, signal: new AbortController().signal });
}

/** GET one enabled skill's guidance, exactly as the assistant would read it through the skill's tool. */
export const skillGuidanceRoute = defineJsonRoute<{ toolId: string }, unknown, SkillGuidanceRouteDeps, SkillRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/skills/:toolId/guidance",
  parse: (raw) => ok({ value: { toolId: skillToolIdParam(raw.params) } }),
  handle: async ({ input, deps, context, authorize }) => {
    await authorizeSkills({ authorize });
    const principalId = skillActorId({ context });
    try {
      return ok({ value: await previewGuidance({ toolId: input.toolId, deps, principalId }) });
    } catch (err) {
      return rejectSkillInputError({ err, isSkillInputError: deps.isSkillInputError });
    }
  },
});
