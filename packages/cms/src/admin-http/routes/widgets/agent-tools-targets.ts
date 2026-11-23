import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { WidgetTypeKey } from "../../../widgets/index.js";

/**
 * @file Body parsing shared by the `widgets.place` / `widgets.create` / `widgets.remove` AI tool
 * route specs: the placement `target` every one of them takes, and `widgets.create`'s whole body.
 */

export type PlaceTarget =
  | { readonly kind: "region"; readonly regionKey: string; readonly baseVersion: number }
  | { readonly kind: "embed"; readonly hostEntryId: string; readonly baseVersion: number };

/** The one 400 every tool answers for a body it cannot use, whichever field is wrong. */
const BAD_TARGET_ERROR = "target must be { kind: 'region', regionKey, baseVersion } or { kind: 'embed', hostEntryId, baseVersion }";

/** The resolved `target`, or `null` when it is missing, has no numeric `baseVersion`, or names
 *  neither a region nor an embed host. @complexity O(1). */
export function readWidgetToolTarget({ body }: { body: Record<string, unknown> }, _optional: Record<string, never> = {}): PlaceTarget | null {
  const target = body.target as Record<string, unknown> | undefined;
  if (!target || typeof target.baseVersion !== "number") return null;
  if (target.kind === "region" && typeof target.regionKey === "string") {
    return { kind: "region", regionKey: target.regionKey, baseVersion: target.baseVersion };
  }
  if (target.kind === "embed" && typeof target.hostEntryId === "string") {
    return { kind: "embed", hostEntryId: target.hostEntryId, baseVersion: target.baseVersion };
  }
  return null;
}

/** Refuses a tool body with the shared bad-target 400. @complexity O(1). */
export function rejectBadWidgetToolTarget(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): never {
  return rejectRoute({ status: 400, error: BAD_TARGET_ERROR, code: "VALIDATION_ERROR" });
}

/** This tool's validated body shape: a resolved `target` plus the new instance's fields.
 *  `widgetType` is cast, not validated, against the real `WidgetTypeKey` union here — same as the
 *  inline code this replaces, `createWidgetInstance` (`getWidgetTypeRegistration`) is what rejects
 *  an unregistered type at runtime, with its own `WidgetTypeUnregisteredError`. */
export type CreateToolInput = { target: PlaceTarget; widgetType: WidgetTypeKey; title: string; config: Record<string, unknown> };

/**
 * Parses+validates `widgets.create`'s body in one place — target resolution (via `readWidgetToolTarget`),
 * `widgetType`/`title` presence, and the `config` object-or-default normalization all collapse into
 * one null-means-invalid result instead of three separate inline checks.
 *
 * @complexity O(1).
 */
export function parseCreateToolInput({ body }: { body: Record<string, unknown> }, _optional: Record<string, never> = {}): CreateToolInput | null {
  const target = readWidgetToolTarget({ body });
  if (!target || typeof body.widgetType !== "string" || typeof body.title !== "string") return null;
  return {
    target,
    widgetType: body.widgetType as WidgetTypeKey,
    title: body.title,
    config: typeof body.config === "object" && body.config !== null ? (body.config as Record<string, unknown>) : {},
  };
}
