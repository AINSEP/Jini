/**
 * @file The Widgets region and embed tools' handlers (`widgets_list_regions`, `widgets_get_region`,
 * `widgets_bind_region`, `widgets_set_region_placements`, `widgets_insert_embed`,
 * `widgets_remove_embed`, `widgets_reorder_embeds`) and the model-facing region view they return.
 * Split out of `tool-registrations.ts`, which keeps what both this file and
 * `tool-handlers.instances.ts` use (the deps type, the schema guard, the error mapping) and the
 * id -> handler table; see that file's header for the authorization shape these share.
 */
import { AGENT_TOOL_PRINCIPAL_KIND, isRecord, requireInputRecord, requireNumber, requireString, ToolInputError, type ToolHandler } from "@jini-ai/core";
import type { JsonObject } from "@jini-ai/core/primitives";
import { requireWidgetPermission } from "./authorize-helper.js";
import { insertWidgetEmbed, removeWidgetEmbed, reorderWidgetEmbeds } from "./embed-service.js";
import { parseWidgetAreaPayload, parseWidgetInstancePayload } from "./entry-payload.js";
import { WidgetAreaNotFoundError } from "./errors.js";
import { bindWidgetArea, mutateWidgetAreaPlacements } from "./region-area-service.js";
import type { WidgetsHandlerArgs, WidgetsPackageToolDeps } from "./tool-handlers.types.js";
import { WIDGET_AREA_CONTENT_TYPE, WIDGET_CONTENT_TYPE, type WidgetAreaEntry, type WidgetPlacementNode } from "./types.js";


/** What a Widgets region tool returns to the model — see {@link toWidgetAreaToolView}. `doc`/`workspaceId` are dropped: placements are returned separately, already resolved. */
interface WidgetAreaToolView {
  id: string;
  regionKey: string;
  version: number;
  updatedAt: string;
}

function toWidgetAreaToolView(area: Pick<WidgetAreaEntry, "id" | "regionKey" | "version" | "updatedAt">): WidgetAreaToolView {
  return { id: area.id, regionKey: area.regionKey, version: area.version, updatedAt: area.updatedAt };
}

/** Resolves one region placement's admin-facing view (widget title/type + broken flag) — mirrors the human region-read route's identical resolution. */
async function resolveWidgetPlacementView(deps: WidgetsPackageToolDeps, placement: WidgetPlacementNode) {
  const widget = await deps.entryRepo.findById({ workspaceId: deps.workspaceId, id: placement.widgetEntryId });
  const payload = widget && widget.type === WIDGET_CONTENT_TYPE ? parseWidgetInstancePayload({ fieldsJson: widget.fieldsJson }) : null;
  return {
    placementId: placement.placementId,
    widgetEntryId: placement.widgetEntryId,
    enabled: placement.enabled,
    ...((placement as WidgetPlacementNode & { content?: Record<string, unknown> }).content !== undefined ? { content: (placement as WidgetPlacementNode & { content?: Record<string, unknown> }).content } : {}),
    widgetTitle: widget?.title ?? null,
    widgetType: payload?.widgetType ?? null,
    broken: !widget || !payload || payload.status !== "active",
  };
}

function placementContent({ content }: { content: unknown }, _options: Record<string, never> = {}): { content?: JsonObject } {
  if (content === undefined) return {};
  if (typeof content !== 'object' || content === null || Array.isArray(content)) throw new ToolInputError({ message: 'placement content must be an object' });
  return { content: content as JsonObject };
}

export const widgetsListRegionsHandler = ({ deps }: WidgetsHandlerArgs): ToolHandler => async (ctx) => {
  await requireWidgetPermission({ authorize: deps.authorize, actor: { principalId: ctx.principal.id }, workspaceId: deps.workspaceId, permission: "widgets.read" });
  const bindings = await deps.widgetBindingRepo.listByWorkspace({ workspaceId: deps.workspaceId });
  const regions = await Promise.all(
    bindings.map(async (binding) => {
      const areaEntry = await deps.entryRepo.findById({ workspaceId: deps.workspaceId, id: binding.areaEntryId });
      const placementCount = areaEntry ? parseWidgetAreaPayload({ fieldsJson: areaEntry.fieldsJson }).doc.placements.length : 0;
      return { regionKey: binding.regionKey, areaEntryId: binding.areaEntryId, updatedAt: binding.updatedAt, placementCount };
    }),
  );
  return { regions };
};

export const widgetsGetRegionHandler = ({ deps }: WidgetsHandlerArgs): ToolHandler => async (ctx) => {
  const regionKey = requireString({ input: requireInputRecord({ input: ctx.input }), key: "regionKey" });
  await requireWidgetPermission({ authorize: deps.authorize, actor: { principalId: ctx.principal.id }, workspaceId: deps.workspaceId, permission: "widgets.read" });

  const binding = await deps.widgetBindingRepo.findByRegion({ workspaceId: deps.workspaceId, regionKey });
  if (!binding) throw new WidgetAreaNotFoundError({ message: `region '${regionKey}' is not bound` });
  const areaEntry = await deps.entryRepo.findById({ workspaceId: deps.workspaceId, id: binding.areaEntryId });
  if (!areaEntry || areaEntry.type !== WIDGET_AREA_CONTENT_TYPE) {
    throw new WidgetAreaNotFoundError({ message: `region area entry for '${regionKey}' was not found` });
  }
  const doc = parseWidgetAreaPayload({ fieldsJson: areaEntry.fieldsJson }).doc;
  const placements = await Promise.all(doc.placements.map((placement) => resolveWidgetPlacementView(deps, placement)));
  return { area: toWidgetAreaToolView({ id: areaEntry.id, regionKey, version: areaEntry.version, updatedAt: areaEntry.updatedAt }), placements };
};

export const widgetsBindRegionHandler = ({ deps }: WidgetsHandlerArgs): ToolHandler => async (ctx) => {
  const regionKey = requireString({ input: requireInputRecord({ input: ctx.input }), key: "regionKey" });
  // `bindWidgetArea` itself carries NO authorize() call (it is designed to double as a boot/theme-
  // activation seeding step, see its own doc comment) — the human region-bind route gates
  // inline before calling it, and this handler does the identical inline `widgets.place` check.
  await requireWidgetPermission({ authorize: deps.authorize, actor: { principalId: ctx.principal.id }, workspaceId: deps.workspaceId, permission: "widgets.place" });
  const { areaEntry } = await bindWidgetArea({
    deps: deps.composeRegionDeps(),
    input: { workspaceId: deps.workspaceId, regionKey },
  });
  return { area: toWidgetAreaToolView(areaEntry) };
};

export const widgetsSetRegionPlacementsHandler = ({ deps }: WidgetsHandlerArgs): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  const regionKey = requireString({ input: input, key: "regionKey" });
  const baseVersion = requireNumber({ input: input, key: "baseVersion" });
  if (!Array.isArray(input.placements)) throw new ToolInputError({ message: "'placements' (array) is required" });

  const seenIds = new Set<string>();
  const placements: WidgetPlacementNode[] = input.placements.map((value: unknown) => {
    const candidate = { value };
    if (!isRecord(candidate)) throw new ToolInputError({ message: "each placement must be an object" });
    const raw = candidate.value;
    const widgetEntryId = requireString({ input: raw, key: "widgetEntryId" });
    if (typeof raw.enabled !== "boolean") throw new ToolInputError({ message: "each placement's 'enabled' must be a boolean" });
    const placementId = typeof raw.placementId === "string" && raw.placementId.length > 0 ? raw.placementId : deps.idGen.newId();
    if (seenIds.has(placementId)) throw new ToolInputError({ message: `duplicate placementId '${placementId}'` });
    seenIds.add(placementId);
    return { placementId, widgetEntryId, enabled: raw.enabled, ...placementContent({ content: raw.content }) };
  });

  const binding = await deps.widgetBindingRepo.findByRegion({ workspaceId: deps.workspaceId, regionKey });
  if (!binding) throw new WidgetAreaNotFoundError({ message: `region '${regionKey}' is not bound` });

  const { areaEntry } = await mutateWidgetAreaPlacements({
    deps: deps.composeRegionDeps(),
    input: { workspaceId: deps.workspaceId, actor: { principalId: ctx.principal.id, kind: AGENT_TOOL_PRINCIPAL_KIND }, areaEntryId: binding.areaEntryId, baseVersion, placements },
  });
  return { area: toWidgetAreaToolView(areaEntry) };
};

export const widgetsInsertEmbedHandler = ({ deps, withSchema }: WidgetsHandlerArgs): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  return withSchema({ toolId: "widgets_insert_embed", fn: async () => {
    const { entry, placementId } = await insertWidgetEmbed({
      deps: deps.composeWriteDeps(),
      input: {
        workspaceId: deps.workspaceId,
        actor: { principalId: ctx.principal.id, kind: AGENT_TOOL_PRINCIPAL_KIND },
        hostEntryId: requireString({ input: input, key: "hostEntryId" }),
        baseVersion: requireNumber({ input: input, key: "baseVersion" }),
        widgetEntryId: requireString({ input: input, key: "widgetEntryId" }),
      },
    });
    return { entryId: entry.id, entryVersion: entry.version, placementId };
  } });
};

export const widgetsRemoveEmbedHandler = ({ deps }: WidgetsHandlerArgs): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  const { entry } = await removeWidgetEmbed({
    deps: deps.composeWriteDeps(),
    input: {
      workspaceId: deps.workspaceId,
      actor: { principalId: ctx.principal.id, kind: AGENT_TOOL_PRINCIPAL_KIND },
      hostEntryId: requireString({ input: input, key: "hostEntryId" }),
      baseVersion: requireNumber({ input: input, key: "baseVersion" }),
      placementId: requireString({ input: input, key: "placementId" }),
    },
  });
  return { entryId: entry.id, entryVersion: entry.version };
};

export const widgetsReorderEmbedsHandler = ({ deps, withSchema }: WidgetsHandlerArgs): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  // The `orderedWidgetEntryIds` shape check used to run BEFORE this `withSchemaOnRejection` call
  // even started — a bare `Error` thrown there still reaches `ToolExecutor` as `errorKind:
  // 'internal'` regardless of where it is thrown (that classification reads `instanceof
  // ToolInputError`, not call-stack position), but it also never got this tool's own schema
  // decoration a rejection caught INSIDE the wrap gets from `isWidgetsShapeRejection`. Moved
  // inside so this validator is unremarkable among this handler's other shape checks rather than
  // the one exception that bypasses the wrap every sibling rejection goes through.
  return withSchema({ toolId: "widgets_reorder_embeds", fn: async () => {
    if (!Array.isArray(input.orderedWidgetEntryIds) || !input.orderedWidgetEntryIds.every((id: unknown) => typeof id === "string" && id.length > 0)) {
      throw new ToolInputError({ message: "'orderedWidgetEntryIds' (non-empty string array) is required" });
    }
    const { entry } = await reorderWidgetEmbeds({
      deps: deps.composeWriteDeps(),
      input: {
        workspaceId: deps.workspaceId,
        actor: { principalId: ctx.principal.id, kind: AGENT_TOOL_PRINCIPAL_KIND },
        hostEntryId: requireString({ input: input, key: "hostEntryId" }),
        baseVersion: requireNumber({ input: input, key: "baseVersion" }),
        orderedWidgetEntryIds: input.orderedWidgetEntryIds as string[],
      },
    });
    return { entryId: entry.id, entryVersion: entry.version };
  } });
};
