import { toolMetadata } from "@jini-ai/core/tool-metadata/workspace";
import { withToolMetadata } from "@jini-ai/core";
/**
 * @file Workspace' agent-tool registrations, built by `@jini-ai/cms/workspace`.
 * This host seam binds metadata and model-facing errors to the assistant's domain catalog.
 * Contributors are installed explicitly at the composition root; importing a feature must not
 * register tools or create an assistant-to-feature runtime cycle.
 */
import type { ToolContributor } from "@jini-ai/core";
import {
  buildWorkspaceRegistrations,
  workspaceDerivedRisk,
  WorkspaceConflictError,
  WorkspaceLastRemainingError,
  WorkspaceNotFoundError,
  WorkspaceValidationError,
  type WorkspaceToolDeps,
} from "../index.js";

import { ForbiddenError } from "../../core/index.js";
import { forbiddenRule, withModelFacingRegistrationErrors, type ModelFacingErrorRule } from "@jini-ai/core/model-facing-tool-errors";
import { versionConflictRule } from "@jini-ai/core/optimistic-concurrency";

/**
 * Workspace's model-facing allowlist. `create.ts`/`update.ts`/`delete.ts` throw these
 * four classes from fixed text plus caller-supplied slugs/ids only (verified against every
 * `new X(...)` call site) — safe to publish verbatim. The current read throws
 * `WorkspaceNotFoundError` only for the missing boot-wired row (see `../tool-registrations.ts`),
 * so arbitrary repository errors retain the transport's redaction.
 */
const workspaceModelFacingRules = ({ readToolId }: { readToolId: string }): readonly ModelFacingErrorRule[] => [
  versionConflictRule({ readToolId }),
  { error: WorkspaceValidationError, code: "WORKSPACE_VALIDATION" },
  { error: WorkspaceConflictError, code: "WORKSPACE_CONFLICT" },
  { error: WorkspaceNotFoundError, code: "WORKSPACE_NOT_FOUND" },
  { error: WorkspaceLastRemainingError, code: "WORKSPACE_LAST_REMAINING" },
  forbiddenRule({ domainPrefix: "WORKSPACE", error: ForbiddenError }),
];

/**
 * Contributes Workspace's AI tools to the assistant's catalog — called once by
 * the host composition root's tool-catalog manifest (`installFirstPartyToolContributors()`), not by importing this
 * module. The host assistant's tool-registrations module no longer imports `buildWorkspaceRegistrations`/
 * `workspaceDerivedRisk` by name; this is the seam that replaced it.
 *
 * `build` wraps every registration with {@link withModelFacingRegistrationErrors}: every
 * workspace domain error still extends plain `Error`, so without this wrap each one reached the model
 * as a redacted `INTERNAL_ERROR` 500.
 * `satisfies` checks the shared contributor contract while preserving this builder's actual
 * workspace-only inputs; it needs no surface exchange store.
 * `readToolId` is the host's published read tool, named in version-conflict guidance.
 * @example contributeWorkspaceTools({ readToolId: "workspace_get" }).build({ authorize, workspaceId: "ws", workspaceRepo })
 */
export function contributeWorkspaceTools({ readToolId }: { readToolId: string }, _optional: Record<string, never> = {}) {
  return {
    domain: "workspace",
    build: (deps: WorkspaceToolDeps) => withModelFacingRegistrationErrors({ registrations: withToolMetadata({ registrations: buildWorkspaceRegistrations(deps, { readToolId }), metadata: toolMetadata }), rules: workspaceModelFacingRules({ readToolId }) }),
    risk: workspaceDerivedRisk,
  } satisfies ToolContributor<WorkspaceToolDeps, unknown>;
}
