/**
 * @file Workspace's half of the cross-domain agent-tool wiring split: maps the wireable subset of
 * `agent-tools.ts`'s four catalog entries onto the current-workspace read and the narrow rename
 * write, as `ToolRegistration`s.
 *
 * Risk framing: this is the highest-stakes domain wired so far — `create` and `delete` are
 * deliberately excluded, each with its reason recorded on {@link UNWIRED_WORKSPACE_TOOL_IDS}; see
 * `./agent-tools.ts`'s own file header for the full reasoning. Only a plain rename (`update`) is
 * wired, alongside a read.
 *
 * Authorization shape: neither `updateWorkspace` (`update.ts`) nor a direct `workspaceRepo.findById`
 * read calls `authorize()` internally — a host's admin routes gate inline — so both handlers here
 * call the kit's `requireToolPermission` themselves, mirroring those routes' identical
 * `workspace.manage` check.
 */
import type { AuthorizeFn } from "../core/commands/command.js";
import {
  buildDomainRegistrations,
  indexCatalogById,
  optionalString,
  requireInputRecord,
  requireNoInput,
  requireToolPermission,
  type AgentToolSideEffect,
  type DerivedRiskByToolId,
  type ToolHandler,
  type ToolRegistration,
} from "../core/tools/registration-kit.js";
import { getWorkspaceAgentToolCatalog } from "./agent-tools.js";
import { updateWorkspace } from "./update.js";
import type { WorkspaceRepoPort } from "./create.js";

const CATALOG_BY_ID = indexCatalogById(getWorkspaceAgentToolCatalog());

/**
 * The exact slice of a host's route-deps bag Workspace's tool handlers read. Declared structurally
 * (rather than importing any host's `RouteDeps`) so this module carries no back-edge into a
 * composition root. A host satisfies this structurally by passing its existing deps object;
 * nothing there changes.
 */
export interface WorkspaceToolDeps {
  authorize: AuthorizeFn;
  workspaceId: string;
  workspaceRepo: WorkspaceRepoPort;
}

/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls. See `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration — and note that the two excluded tools appear NOWHERE here, which is
 * itself the strongest of the guards: an unclassified id cannot be wired at all.
 */
export const workspaceDerivedRisk: DerivedRiskByToolId = new Map<string, AgentToolSideEffect>([
  // -> routeDeps.workspaceRepo.findById(): one read, no domain function of its own (mirrors a
  //    host's own admin workspace-get route making the same direct repo call).
  ["workspace_get", "none"],
  // -> updateWorkspace (update.ts) -> repo.findById + repo.findBySlug + repo.update: validates,
  //    checks slug uniqueness excluding the row itself, writes. No domain event enqueued (matches
  //    update.ts's own header: REQ-04 doesn't ask for one).
  ["workspace_update", "mutates-durable-state"],
]);

/** Workspace catalog entries this pass does not wire, and why — see `./agent-tools.ts`'s own per-entry comments for the full reasoning. */
const UNWIRED_WORKSPACE_TOOL_IDS = new Set([
  // EXCLUDED BY DESIGN: inserts a row no other route can ever address (every workspace route
  // resolves strictly against the boot-wired `workspaceId`) — zero utility, non-zero
  // orphaned-row/clutter surface.
  "workspace_create",
  // EXCLUDED BY DESIGN: INV-03-guarded to always refuse today, but the lever removes the only
  // addressable workspace scope the moment that guard's precondition ever changes — whole-scope,
  // no per-domain undo, same exclusion class as a forward database migration or a backup restore.
  "workspace_delete",
]);

export function buildWorkspaceRegistrations(routeDeps: WorkspaceToolDeps): ToolRegistration[] {
  const handlers: Record<string, ToolHandler> = {
    workspace_get: async (ctx) => {
      requireNoInput(ctx.input);
      await requireToolPermission(routeDeps, { principalId: ctx.principal.id, permission: "workspace.manage", entityType: "workspace" });

      const workspace = await routeDeps.workspaceRepo.findById(routeDeps.workspaceId);
      if (!workspace) {
        // Defensive: the boot-wired workspaceId always resolves to a real row by construction.
        // Not an expected runtime path.
        throw new Error(`workspace '${routeDeps.workspaceId}' was not found`);
      }
      return { workspace };
    },

    workspace_update: async (ctx) => {
      const input = requireInputRecord(ctx.input);
      await requireToolPermission(routeDeps, { principalId: ctx.principal.id, permission: "workspace.manage", entityType: "workspace" });

      // WorkspaceValidationError/WorkspaceConflictError/WorkspaceNotFoundError (all real `Error`
      // subclasses, see `create.ts`) propagate as-is — a `ToolExecutor` treats any thrown error as
      // a failed execution, matching every other domain's handler convention of not rewrapping
      // typed domain errors before letting them surface.
      const { workspace } = await updateWorkspace({
        deps: { repo: routeDeps.workspaceRepo },
        input: {
          id: routeDeps.workspaceId,
          name: optionalString(input, "name"),
          slug: optionalString(input, "slug"),
        },
      });
      return { workspace };
    },
  };

  return buildDomainRegistrations({
    domain: "workspace",
    catalogModule: "workspace/agent-tools.ts",
    catalog: CATALOG_BY_ID,
    handlers,
    derivedRisk: workspaceDerivedRisk,
    unwiredToolIds: UNWIRED_WORKSPACE_TOOL_IDS,
  });
}
