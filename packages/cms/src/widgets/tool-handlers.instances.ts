/**
 * @file The Widgets instance tools' handlers (`widgets_list_instances`, `widgets_get_instance`,
 * `widgets_create_instance`, `widgets_update_instance`, `widgets_trash_instance`) and the
 * model-facing view they return. Split out of `tool-registrations.ts`, which keeps what both this
 * file and `tool-handlers.areas.ts` use (the deps type, the schema guard, the error mapping) and
 * the id -> handler table; see that file's header for the authorization shape these share.
 */
import { AGENT_TOOL_PRINCIPAL_KIND, isRecord, requireInputRecord, requireNumber, requireObject, requireString, type ToolHandler } from "@jini-ai/core";
import { requireWidgetPermission } from "./authorize-helper.js";
import { WidgetInstanceNotFoundError } from "./errors.js";
import { getWidgetInstance, listWidgetInstances } from "./read-service.js";
import type { WidgetsHandlerArgs } from "./tool-handlers.types.js";
import { WIDGET_CONTENT_TYPE, type WidgetInstanceEntry, type WidgetTypeKey } from "./types.js";
import { toWhereUsedResponse } from "./where-used.js";
import { createWidgetInstance, trashWidgetInstance, updateWidgetInstance } from "./write-service.js";

/** What a Widgets instance tool returns to the model — see {@link toWidgetInstanceToolView}. */
interface WidgetInstanceToolView {
  id: string;
  slug: string;
  title: string;
  status: WidgetInstanceEntry["status"];
  widgetType: WidgetInstanceEntry["widgetType"];
  config: Record<string, unknown>;
  version: number;
}

/** Projects a `WidgetInstanceEntry` into an explicit model-facing shape — `config` is copied so a tool caller cannot mutate domain state through the returned object. */
function toWidgetInstanceToolView(instance: WidgetInstanceEntry): WidgetInstanceToolView {
  return {
    id: instance.id,
    slug: instance.slug,
    title: instance.title,
    status: instance.status,
    widgetType: instance.widgetType,
    config: { ...instance.config },
    version: instance.version,
  };
}

/** The plugin id recorded on an assistant-initiated trash, so a human's own trash from the admin
 *  screen (which leaves it unset) stays human-only. See `RemoveWidgetFn`'s `actor.pluginId`. */
const ASSISTANT_ACTOR_PLUGIN_ID = "assistant";

export const widgetsListInstancesHandler = ({ deps }: WidgetsHandlerArgs): ToolHandler => async (ctx) => {
  const candidate = { value: ctx.input };
  const input = isRecord(candidate) ? candidate.value : {};
  const { instances } = await listWidgetInstances({
    deps: { entryRepo: deps.entryRepo, authorize: deps.authorize, ...(deps.report ? { report: deps.report } : {}) },
    input: {
      workspaceId: deps.workspaceId,
      actor: { principalId: ctx.principal.id },
      ...(typeof input.widgetType === "string" ? { widgetType: input.widgetType } : {}),
      includeInactive: input.includeInactive === true,
    },
  });
  return { instances: instances.map(toWidgetInstanceToolView) };
};

export const widgetsGetInstanceHandler = ({ deps }: WidgetsHandlerArgs): ToolHandler => async (ctx) => {
  const widgetInstanceId = requireString({ input: requireInputRecord({ input: ctx.input }), key: "widgetInstanceId" });
  const { instance } = await getWidgetInstance({
    deps: { entryRepo: deps.entryRepo, authorize: deps.authorize, ...(deps.report ? { report: deps.report } : {}) },
    input: { workspaceId: deps.workspaceId, actor: { principalId: ctx.principal.id }, widgetInstanceId },
  });
  const refs = await deps.entryRefsRepo.findByTarget({ workspaceId: deps.workspaceId, targetKind: "entry", targetId: instance.id });
  return { instance: toWidgetInstanceToolView(instance), whereUsed: toWhereUsedResponse({ refs: refs }) };
};

export const widgetsCreateInstanceHandler = ({ deps, withSchema }: WidgetsHandlerArgs): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  return withSchema({ toolId: "widgets_create_instance", fn: async () => {
    const { instance } = await createWidgetInstance({
      deps: deps.composeWriteDeps(),
      input: {
        workspaceId: deps.workspaceId,
        actor: { principalId: ctx.principal.id, kind: AGENT_TOOL_PRINCIPAL_KIND },
        widgetType: requireString({ input: input, key: "widgetType" }) as WidgetTypeKey,
        title: requireString({ input: input, key: "title" }),
        config: requireObject({ input: input, key: "config" }),
        ...(typeof input.slug === "string" ? { slug: input.slug } : {}),
      },
    });
    return { instance: toWidgetInstanceToolView(instance) };
  } });
};

export const widgetsUpdateInstanceHandler = ({ deps, withSchema }: WidgetsHandlerArgs): ToolHandler => async (ctx) => {
  const input = requireInputRecord({ input: ctx.input });
  return withSchema({ toolId: "widgets_update_instance", fn: async () => {
    const { instance } = await updateWidgetInstance({
      deps: deps.composeWriteDeps(),
      input: {
        workspaceId: deps.workspaceId,
        actor: { principalId: ctx.principal.id, kind: AGENT_TOOL_PRINCIPAL_KIND },
        widgetInstanceId: requireString({ input: input, key: "widgetInstanceId" }),
        baseVersion: requireNumber({ input: input, key: "baseVersion" }),
        config: requireObject({ input: input, key: "config" }),
      },
    });
    return { instance: toWidgetInstanceToolView(instance) };
  } });
};

/**
 * The trash: a reversible move to the Trash, run without a confirmation card of its own (a host's
 * confirmation policy, if any, wraps the whole tool). The read before it gates on `widgets.read`,
 * deferring `widgets.delete` to the write itself — the same split the post delete tool uses for
 * `content.read`/`content.write`. `trashWidgetInstance` re-reads the row and derives
 * `expectedVersion` from that fresh read INSIDE itself, right before moving it to the Trash, so no
 * separate staleness re-check is needed here.
 *
 * The read does not go through `getWidgetInstance`: that function calls `toWidgetInstanceEntry`,
 * which `JSON.parse`s `fields_json`, so a widget whose payload is corrupt (e.g. `fields_json =
 * "{not json"`) would throw here before the move ever ran, making exactly the rows a user most
 * wants gone untrashable. It reads the raw `EntryRecord` (`title`/`slug`/`version`/`type`) instead,
 * the same column-only rule `TrashAdapter` implementations already follow (see `ports.ts`'s file
 * header).
 */
export const widgetsTrashInstanceHandler = ({ deps }: WidgetsHandlerArgs): ToolHandler => async (ctx) => {
  const widgetInstanceId = requireString({ input: requireInputRecord({ input: ctx.input }), key: "widgetInstanceId" });

  await requireWidgetPermission({
    authorize: deps.authorize,
    actor: { principalId: ctx.principal.id },
    workspaceId: deps.workspaceId,
    permission: "widgets.read",
  });
  const entry = await deps.entryRepo.findById({ workspaceId: deps.workspaceId, id: widgetInstanceId });
  if (!entry || entry.type !== WIDGET_CONTENT_TYPE) {
    throw new WidgetInstanceNotFoundError({ message: `widget instance '${widgetInstanceId}' was not found` });
  }

  ctx.signal.throwIfAborted();
  const { version } = await trashWidgetInstance({
    deps: deps.composeWriteDeps(),
    input: {
      workspaceId: deps.workspaceId,
      actor: { principalId: ctx.principal.id, pluginId: ASSISTANT_ACTOR_PLUGIN_ID },
      widgetInstanceId,
    },
  });
  // The row itself is unchanged apart from its Trash marker; no `toWidgetInstanceToolView` here
  // (see this handler's own header) — a corrupt payload must still be reportable as trashed.
  return { trashed: true, cancelled: false, widgetInstanceId, title: entry.title, slug: entry.slug, version: version ?? entry.version };

};
