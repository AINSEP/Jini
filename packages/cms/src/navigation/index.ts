/**
 * @file Public surface (barrel) for the `navigation` library (ADR-029).
 *
 * A module's public contract is its `index.ts` (ADR-009 §1) — deep imports
 * from outside this directory should go through here.
 */
export type {
  NavTargetKind,
  ReservedNavTargetKind,
  NavTarget,
  NavEntryTarget,
  NavTermTarget,
  NavUrlTarget,
  NavRouteTarget,
  NavItemAttrs,
  NavItemNode,
  NavMenuDoc,
  NavMenuEntry,
  MenuStatus,
  NavLocationKey,
  NavLocationBindingRow,
  NavLocationDescriptor,
  ResolvedNavItem,
  ResolvedNav,
} from "./types.js";

export { NAV_MENU_CONTENT_TYPE, NAV_FIELD_NAMESPACE, NAV_DOC_TYPE } from "./types.js";

export type {
  NavLocationBindingRepoPort,
  NavResolveContext,
  NavTargetResolver,
  NavMenuReadModel,
  NavLocationRegistry,
} from "./ports.js";

export type {
  NavigationPermission,
  CreateMenuInput,
  UpdateMenuInput,
  AssignLocationInput,
  UnassignLocationInput,
  DeleteMenuInput,
  NavigationEventName,
  NavMenuChangedPayload,
  NavLocationChangedPayload,
  NavigationHookName,
  NavigationAiTool,
  NavWhereUsedResult,
} from "./contracts.js";

export {
  NAVIGATION_PERMISSIONS,
  NAVIGATION_EVENTS,
  NAVIGATION_HOOKS,
  NAVIGATION_AI_TOOLS,
} from "./contracts.js";

export { createNavMenuReadModel, type NavMenuReadModelDeps } from "./read-model.js";

/**
 * `MenuRepoPort` is navigation-owned (not part of the frozen `ports.ts` ADR surface — see
 * `repo.memory.ts`'s file header for why) but is a real public contract: a host's own SQLite
 * adapter implements it directly, the same way it implements `NavLocationBindingRepoPort`.
 */
export {
  InMemoryMenuRepo,
  InMemoryNavLocationBindingRepo,
  type MenuRepoPort,
} from "./repo.memory.js";

export {
  createMenu,
  updateMenuTree,
  assignLocation,
  deleteMenu,
  validateAndCloneTree,
  MenuNotFoundError,
  MenuValidationError,
  MenuConflictError,
  MenuLocationBoundError,
  DEFAULT_MAX_TREE_DEPTH,
  DEFAULT_MAX_ITEM_COUNT,
  type TreeValidationLimits,
  type CreateMenuDeps,
  type CreateMenuServiceInput,
  type CreateMenuRequired,
  type CreateMenuOptional,
  type UpdateMenuTreeDeps,
  type UpdateMenuTreeServiceInput,
  type UpdateMenuTreeRequired,
  type UpdateMenuTreeOptional,
  type AssignLocationDeps,
  type AssignLocationServiceInput,
  type AssignLocationRequired,
  type AssignLocationOptional,
  type DeleteMenuDeps,
  type DeleteMenuServiceInput,
  type DeleteMenuRequired,
  type DeleteMenuOptional,
} from "./menu-service.js";

export {
  resolveForLocation,
  resolveMenuDoc,
  type ResolveTargetHrefFn,
  type ResolvedTargetHref,
  type ResolveForLocationDeps,
  type ResolveForLocationServiceInput,
  type ResolveForLocationRequired,
  type ResolveForLocationOptional,
} from "./resolver.js";

export {
  rebuildNavLocationBindings,
  type RebuildNavLocationBindingsDeps,
  type RebuildNavLocationBindingsResult,
} from "./reconcile.js";

/** The agent-tool surface for this domain (see `agent-tools.ts` for what is deliberately omitted). */
export {
  menusAgentToolCatalog,
  type AgentToolDefinition as NavigationAgentToolDefinition,
  type AgentToolSideEffect as NavigationAgentToolSideEffect,
  type AgentToolActorClassRule as NavigationAgentToolActorClassRule,
} from "./agent-tools.js";

/**
 * The agent-tool wiring for this domain.
 *
 * `MenusToolDeps` is declared structurally rather than derived from any host's request-scoped
 * dependency bag, which is what lets a host satisfy it by passing whatever object it already has —
 * the shape is the contract, so no host type needs to be named here.
 */
export {
  buildMenusRegistrations,
  menusDerivedRisk,
  type MenusToolDeps,
} from "./tool-registrations.js";

/**
 * There is no wiring/composition export here, deliberately. Assembling a concrete `MenuRepoPort`/
 * `NavLocationBindingRepoPort` pair over a specific database handle would put one host's persistence
 * choice on this library's public contract and drag that host's schema into every consumer's
 * dependency closure. Hosts compose their own; this entry point exports the ports they compose
 * against.
 */
