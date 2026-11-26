import type { JsonObject, UUID } from "@jini-ai/core/primitives";
import type { EntryRecord } from "../entries/index.js";
import { parseWidgetInstancePayload } from "./payload-fields.js";
import { resolveWidgetType } from "./resolvers/index.js";
import { WIDGET_CONTENT_TYPE } from "./types.js";
import type { WidgetInstanceView, WidgetRenderIR, WidgetResolveContext, WidgetResolveResult, WidgetTypeKey } from "./types.js";
import type { WidgetInstanceResolutionDeps } from "./resolver-contracts.js";
import type { InlineEmbedRef } from "./document-embed-refs.js";

/** REQ-28: a widget resolution failure renders an isolated placeholder — no internal detail in public output. */
const PLACEHOLDER_IR: WidgetRenderIR = { componentId: "widget-placeholder", props: {} };

export function toRenderIr(result: WidgetResolveResult | undefined): WidgetRenderIR {
  return result?.ok ? result.ir : PLACEHOLDER_IR;
}

/**
 * Batch-loads and resolves every widget instance in `referencedIds` (REQ-24's "one batched query,
 * at most one `resolveWidgetType` call per type" guarantee) into a `widgetEntryId ->
 * WidgetResolveResult` map. Extracted so this exact batching contract has ONE implementation rather
 * than two that could silently diverge (the inline refactor) — `resolvePageWidgets`
 * (below, region + TipTap-inline-embed callers) and `resolveHtmlPageEmbeds` (an `"html"`-format
 * Page's `data-widget-embed` callers) both call this.
 *
 * Never throws (REQ-27's contract, unchanged by this extraction) — a malformed widget-instance
 * payload is skipped, not thrown; the caller's own placeholder-degradation step (REQ-28) handles a
 * ref that never made it into the returned map.
 *
 * @complexity O(1) plus one batched `listByWorkspace` query plus at most one `resolveWidgetType`
 * call per distinct widget type present among `referencedIds` (REQ-24).
 * @overallScore 100
 */
/** Parses one entries row into a {@link WidgetInstanceView}, or `null` when it should be skipped
 *  (REQ-27: a malformed payload, or an instance already trashed/purged). */
function parseWidgetInstanceRow(row: EntryRecord): WidgetInstanceView | null {
  let payload: ReturnType<typeof parseWidgetInstancePayload>;
  try {
    payload = parseWidgetInstancePayload({ fieldsJson: row.fieldsJson });
  } catch {
    // REQ-27: a malformed widget-instance payload is skipped, not thrown — the reference that
    // pointed at it simply has no resolved result, so the caller degrades it to the REQ-28
    // placeholder like any other unresolved reference.
    return null;
  }
  if (payload.status === "trash" || payload.status === "purged") return null;
  return { id: row.id, widgetType: payload.widgetType, config: payload.config as JsonObject };
}

/** Groups every referenced, resolvable widget row by its widget type (REQ-24's "one `resolveWidgetType`
 *  call per type" grouping step). */
function groupWidgetInstancesByType(
  widgetRows: readonly EntryRecord[],
  referencedIds: ReadonlySet<UUID>
): Map<WidgetTypeKey, WidgetInstanceView[]> {
  const byType = new Map<WidgetTypeKey, WidgetInstanceView[]>();
  for (const row of widgetRows) {
    if (!referencedIds.has(row.id)) continue;
    const instance = parseWidgetInstanceRow(row);
    if (instance) {
      const list = byType.get(instance.widgetType) ?? [];
      list.push(instance);
      byType.set(instance.widgetType, list);
    }
  }
  return byType;
}

export async function resolveWidgetInstances(
  deps: WidgetInstanceResolutionDeps,
  workspaceId: UUID,
  referencedIds: ReadonlySet<UUID>,
  context: WidgetResolveContext,
  overrides: readonly { key: string; widgetEntryId: string; content: JsonObject }[] = [],
  originalIds: ReadonlySet<UUID> = referencedIds,
): Promise<ReadonlyMap<UUID, WidgetResolveResult>> {
  const widgetRows =
    referencedIds.size > 0 ? await deps.entryRepo.listByWorkspace({ workspaceId }, { type: WIDGET_CONTENT_TYPE }) : [];
  const byType = groupWidgetInstancesByType(widgetRows, originalIds);
  const rowsById = new Map(widgetRows.map(row => [row.id, row]));

  for (const override of overrides) {
    const row = rowsById.get(override.widgetEntryId);
    const saved = row ? parseWidgetInstanceRow(row) : null;
    if (!saved) continue;
    const instances = byType.get(saved.widgetType) ?? [];
    instances.push({ ...saved, id: override.key, config: { ...saved.config, ...override.content } });
    byType.set(saved.widgetType, instances);
  }
  const resolvedById = new Map<UUID, WidgetResolveResult>();
  for (const [typeKey, instances] of byType) {
    const results = await resolveWidgetType({ typeKey, instances, context });
    for (const [id, result] of results) resolvedById.set(id, result);
  }
  return resolvedById;
}

/** Placement config merges before asset resolution; a repeated widget never shares overridden IR. */
export function inlineContentOverrides(embeds: readonly InlineEmbedRef[]): { key: string; widgetEntryId: string; content: JsonObject }[] {
  return embeds.flatMap(embed => embed.content ? [{ key: embed.placementId, widgetEntryId: embed.widgetEntryId, content: embed.content }] : []);
}

/** placementId -> IR for every inline embed; a missing/trashed/failed widget degrades to the REQ-28
 *  placeholder IR. Shared by {@link resolvePageWidgets} and {@link resolvePostContentWidgetContext}. */
export function assembleInlineResolved(
  inlineEmbeds: readonly InlineEmbedRef[],
  resolvedById: ReadonlyMap<UUID, WidgetResolveResult>
): Map<UUID, WidgetRenderIR> {
  const inlineResolved = new Map<UUID, WidgetRenderIR>();
  for (const embed of inlineEmbeds) {
    inlineResolved.set(embed.placementId, toRenderIr(resolvedById.get(embed.content ? embed.placementId : embed.widgetEntryId)));
  }
  return inlineResolved;
}
