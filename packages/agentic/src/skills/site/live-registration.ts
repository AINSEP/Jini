import { createLiveToolRegistration, createSkillRefreshMiddleware as createMiddleware } from "../install/index.js";
import { ToolInputError, type ToolRegistry, type ToolRegistration } from "@jini-ai/core";

/** Optional port attached by the skills registrar. Consumers need no feature imports. */
export type SkillsRefreshRegistry = ToolRegistry & { refreshInstalledSkills?: () => Promise<boolean> };

/** Live skill slots on the core registry (`createLiveToolRegistration` in `@jini-ai/agentic/skills/install`) with this product's inactive-skill wording. */
export function createLiveSkillRegistration(registry: ToolRegistry): (tools: readonly ToolRegistration[]) => boolean {
  return createLiveToolRegistration({ registry, inactiveError: () => new ToolInputError({ message: "This skill is no longer enabled or installed. Choose an installed skill." }) });
}

/** Refreshes skills before a daemon request reaches discovery/execution; failed reads fail closed. */
export function createSkillRefreshMiddleware(input: { registry: SkillsRefreshRegistry; onChanged: () => void }) {
  const middleware = createMiddleware({ registry: { refreshInstalledSkills: () => input.registry.refreshInstalledSkills?.() ?? Promise.resolve(false) } }, { onChanged: input.onChanged });
  return async (_req: unknown, _res: unknown, next: (error?: unknown) => void): Promise<void> => {
    await middleware({ next: (_required, optional) => next(optional?.error) });
  };
}
