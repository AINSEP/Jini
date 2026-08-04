/**
 * @file Public surface (barrel) for the `workspace` library.
 *
 * A module's public contract is its `index.ts` (module-boundary convention) — deep imports from
 * outside this directory should go through here.
 */
export {
  createWorkspace,
  validateWorkspaceNameAndSlug,
  WorkspaceConflictError,
  WorkspaceLastRemainingError,
  WorkspaceNotFoundError,
  WorkspaceValidationError,
  type CreateWorkspaceDeps,
  type CreateWorkspaceInput,
  type CreateWorkspaceRequired,
  type CreateWorkspaceOptional,
  type WorkspaceRecord,
  type WorkspaceRepoPort,
} from "./create.js";

export {
  updateWorkspace,
  type UpdateWorkspaceDeps,
  type UpdateWorkspaceInput,
  type UpdateWorkspaceRequired,
} from "./update.js";

export {
  deleteWorkspace,
  type DeleteWorkspaceDeps,
  type DeleteWorkspaceInput,
  type DeleteWorkspaceRequired,
} from "./delete.js";

export { InMemoryWorkspaceRepo } from "./repo.memory.js";

/** The agent-tool surface for this domain (see `agent-tools.ts` for what is deliberately omitted). */
export {
  getWorkspaceAgentToolCatalog,
  type AgentToolDefinition as WorkspaceAgentToolDefinition,
  type AgentToolSideEffect as WorkspaceAgentToolSideEffect,
  type AgentToolActorClassRule as WorkspaceAgentToolActorClassRule,
} from "./agent-tools.js";

/**
 * The agent-tool wiring for this domain.
 *
 * `WorkspaceToolDeps` is declared structurally rather than derived from any host's request-scoped
 * dependency bag, which is what lets a host satisfy it by passing whatever object it already has —
 * the shape is the contract, so no host type needs to be named here.
 */
export {
  buildWorkspaceRegistrations,
  workspaceDerivedRisk,
  type WorkspaceToolDeps,
} from "./tool-registrations.js";

/**
 * There is no SQLite adapter export here, deliberately. A concrete `WorkspaceRepoPort` over a
 * specific database handle names that host's schema, which would put one host's persistence choice
 * on this library's public contract and drag its schema into every consumer's dependency closure.
 * Hosts compose their own; this entry point exports the port they compose against.
 */
