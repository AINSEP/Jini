/**
 * @file The types every Widgets tool handler factory shares, kept in a leaf of their own: the
 * handler modules (`tool-handlers.instances.ts`, `tool-handlers.areas.ts`) and the registration
 * table (`tool-registrations.ts`) all need them, and a handler module importing from the table
 * would be an import cycle.
 */
import type { ToolHandler } from "@jini-ai/core";
import type { EntryListPort, EntryRepoPort } from "../entries/index.js";
import type { WidgetsAuthorizeFn } from "./authorize-helper.js";
import type { EmbedServiceDeps } from "./embed-service.js";
import type { EntryRefsRepoPort, WidgetRegionBindingRepoPort } from "./ports.js";
import type { RegionAreaServiceDeps } from "./region-area-service.js";
import type { WidgetTrashDeps } from "./write-service.js";

/**
 * The exact slice of a host's route deps the Widgets tool handlers read, plus the two composers of
 * the write-path deps bags (`composeWriteDeps` for instance/embed writes and the Trash,
 * `composeRegionDeps` for region writes). They are functions, called by a handler when it runs,
 * because a host composes those bags from fields it may not have yet when the tool table is built
 * (a registry assembled for its descriptors only), and composing eagerly would fail there. Declared
 * structurally so this module carries no back-edge into a host's composition root.
 */
export interface WidgetsPackageToolDeps {
  authorize: WidgetsAuthorizeFn;
  workspaceId: string;
  idGen: { newId(): string };
  entryRepo: EntryRepoPort & EntryListPort;
  entryRefsRepo: EntryRefsRepoPort;
  widgetBindingRepo: WidgetRegionBindingRepoPort;
  composeWriteDeps: () => WidgetTrashDeps & EmbedServiceDeps;
  composeRegionDeps: () => RegionAreaServiceDeps;
  /**
   * Re-classifies a plugin save-hook refusal thrown inside any handler into the host's model-facing
   * refusal (the refusal class and its fixed wording are the host's). Applied to the whole handler
   * map once, so no save handler can be the one that forgot.
   */
  wrapHookRefusals: (handlers: Record<string, ToolHandler>) => Record<string, ToolHandler>;
}

/** Wraps a handler's domain call so a config/type/embed SHAPE rejection carries the tool's published schema. */
export type WidgetsSchemaGuard = <T>(required: { toolId: string; fn: () => Promise<T> }) => Promise<T>;

/**
 * What every handler factory receives. `withSchema` is passed in rather than imported because it
 * closes over the registration table's catalog index and shape predicate.
 */
export interface WidgetsHandlerArgs {
  deps: WidgetsPackageToolDeps;
  withSchema: WidgetsSchemaGuard;
}
