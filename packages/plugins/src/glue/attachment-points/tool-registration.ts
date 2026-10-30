import type { GlueHostPort, GlueToolRegistration } from "../ports.js";

export interface GlueToolModuleContribution {
  readonly moduleId: string;
  readonly build: (required: Record<string, never>) => readonly GlueToolRegistration[];
}

export interface MergeGlueToolRegistrationsRequired {
  readonly coreToolIds: readonly string[];
  readonly glueModules: readonly GlueToolModuleContribution[];
  readonly hostPort: Pick<GlueHostPort, "registerTools">;
}

export type MergeGlueToolRegistrationsOptional = Record<string, never>;

export type GlueToolQuarantineReason = "THROW" | "DUPLICATE_TOOL_ID";

export interface GlueToolQuarantineEntry {
  readonly moduleId: string;
  readonly reason: GlueToolQuarantineReason;
  readonly detail: string;
}

export interface MergeGlueToolRegistrationsResult {
  readonly registeredModuleIds: readonly string[];
  readonly quarantined: readonly GlueToolQuarantineEntry[];
}

export function mergeGlueToolRegistrations(
  required: MergeGlueToolRegistrationsRequired,
  _optional: MergeGlueToolRegistrationsOptional = {}
): MergeGlueToolRegistrationsResult {
  const { coreToolIds, glueModules, hostPort } = required;
  const claimedToolIds = new Set<string>(coreToolIds);
  const registeredModuleIds: string[] = [];
  const quarantined: GlueToolQuarantineEntry[] = [];

  const quarantine = (moduleId: string, reason: GlueToolQuarantineReason, detail: string): void => {
    quarantined.push({ moduleId, reason, detail });
  };
  const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  // A module either registers all its tools or is quarantined with the reason; core ids and
  // earlier modules' ids are never shadowed.
  const registerModule = (module: (typeof glueModules)[number]): { reason: GlueToolQuarantineReason; detail: string } | undefined => {
    let registrations: readonly GlueToolRegistration[];
    try {
      registrations = module.build({});
    } catch (error) {
      return { reason: "THROW", detail: `registration build failed: ${messageOf(error)}` };
    }

    const moduleToolIds = new Set<string>();
    const duplicate = registrations.find((registration) => {
      if (claimedToolIds.has(registration.toolId) || moduleToolIds.has(registration.toolId)) return true;
      moduleToolIds.add(registration.toolId);
      return false;
    });
    if (duplicate) {
      return { reason: "DUPLICATE_TOOL_ID", detail: `tool id '${duplicate.toolId}' is already registered by core or an earlier glue module` };
    }

    try {
      hostPort.registerTools({ moduleId: module.moduleId, registrations });
    } catch (error) {
      return { reason: "THROW", detail: `host port registration failed: ${messageOf(error)}` };
    }

    for (const registration of registrations) claimedToolIds.add(registration.toolId);
    return undefined;
  };

  for (const module of glueModules) {
    const failure = registerModule(module);
    if (failure) quarantine(module.moduleId, failure.reason, failure.detail);
    else registeredModuleIds.push(module.moduleId);
  }

  return { registeredModuleIds, quarantined };
}
