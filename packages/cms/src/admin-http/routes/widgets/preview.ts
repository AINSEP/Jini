import { defineJsonRoute, ok, type JsonRouteAuthorize, type JsonRouteSpec } from "@jini-ai/core/contracts/server";
import { rejectRoute, RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import type { JsonObject } from "@jini-ai/core/primitives";
import { isNonArrayRecord } from "@jini-ai/core/records";

/**
 * @file `POST /api/admin/v1/workspaces/:workspaceId/widgets/preview` — render an unsaved widget
 * config through the public widget pipeline, never persisting it.
 *
 * The rendering (registry validation, resolver dispatch, theme document) is the host's adapter,
 * injected as `renderPreview`; the widget error ladder is the host's too (`mapWidgetError`). Every
 * answer — the workspace 404, the 401 and every refusal included — carries `Cache-Control: no-store`
 * (`responseHeaders`), as the hand-written route set it before any gate.
 */

/** The unsaved widget a preview renders. */
export interface WidgetPreviewInput { widgetType: string; content: JsonObject }

/** The preview answer: the widget fragment and the themed document that wraps it. */
export interface WidgetPreviewOutput { html: string; document: string }

/** The host's preview renderer (validates the config against the registered type, then renders). */
export type WidgetPreviewRenderFn = (required: { input: WidgetPreviewInput }, optional?: Record<string, never>) => Promise<WidgetPreviewOutput>;

/** The host's widget error ladder: a known widget/domain error's `{ status, body }`, or `undefined`
 *  for anything else (which the mount answers as its redacted 500). */
export type WidgetErrorMapFn = (required: { error: unknown }, optional?: Record<string, never>) => { status: number; body: unknown } | undefined;

/** The deps this route reads. */
export interface WidgetPreviewRouteDeps {
  workspaceId: string;
  renderPreview: WidgetPreviewRenderFn;
  mapWidgetError: WidgetErrorMapFn;
}

/** The principal fields this route reads: only its presence. */
export interface WidgetPreviewPrincipal { id: string }

/** Set on every preview answer, before any gate: a preview is per-operator draft output. */
export const WIDGET_PREVIEW_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({ "Cache-Control": "no-store" });

/** The raw JSON body; read in `handle`, after the session and permission checks (the hand-written order). */
export interface WidgetPreviewRawInput { body: unknown }

type WidgetPreviewSpec = JsonRouteSpec<WidgetPreviewRawInput, WidgetPreviewOutput, WidgetPreviewRouteDeps, WidgetPreviewPrincipal> & { responseHeaders: Readonly<Record<string, string>> };

/** UTF-8 byte length without Node's `Buffer`, so the spec stays universal. @complexity O(n). */
function utf8ByteLength({ text }: { text: string }, _optional: Record<string, never> = {}): number {
  return new TextEncoder().encode(text).byteLength;
}

/** A JSON object config, bounded before entering the registry's own type-specific validation.
 * @complexity O(n) for the serialized request size (at most 128 KiB).
 */
export function parseWidgetPreviewBody({ raw }: { raw: unknown }, _optional: Record<string, never> = {}): WidgetPreviewInput | null {
  if (!isNonArrayRecord({ value: raw })) return null;
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).some(key => key !== 'widgetType' && key !== 'content')) return null;
  if (typeof body.widgetType !== 'string' || body.widgetType.length > 100) return null;
  if (typeof body.content !== 'object' || body.content === null || Array.isArray(body.content)) return null;
  if (utf8ByteLength({ text: JSON.stringify(body) }) > 131072) return null;
  return { widgetType: body.widgetType, content: body.content as JsonObject };
}

/** `widgets.read` on the `widget` type, no entity id. A mount without an authorizer is a wiring bug.
 * @complexity O(1) plus the injected authorizer. */
async function authorizePreview({ authorize }: { authorize: JsonRouteAuthorize | undefined }, _optional: Record<string, never> = {}): Promise<void> {
  if (!authorize) throw new Error("widget preview route has no authorizer");
  await authorize({ permission: "widgets.read", entityType: "widget" });
}

/** Permission, body, render — inside one ladder, as the hand-written route's `try` held all three.
 * @complexity O(n) in the body size plus the injected renderer. */
async function previewOrRefuse({ body, deps, authorize }: { body: unknown; deps: WidgetPreviewRouteDeps; authorize: JsonRouteAuthorize | undefined }, _optional: Record<string, never> = {}): Promise<WidgetPreviewOutput> {
  try {
    await authorizePreview({ authorize });
    const input = parseWidgetPreviewBody({ raw: body });
    if (!input) rejectRoute({ status: 400, error: "widgetType and content are required", code: "VALIDATION_ERROR" });
    return await deps.renderPreview({ input });
  } catch (error) {
    const mapped = deps.mapWidgetError({ error });
    if (mapped) throw new RouteRefusalError(mapped);
    throw error;
  }
}

/**
 * Admin middleware authenticates this route, just like saved-widget routes. This local guard
 * also fails closed for direct invocation (the mount defers a missing session to here); the
 * permission check precedes body validation and rendering.
 */
const previewSpec = defineJsonRoute<WidgetPreviewRawInput, WidgetPreviewOutput, WidgetPreviewRouteDeps, WidgetPreviewPrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/widgets/preview",
  parse: (raw) => ok({ value: { body: raw.body } }),
  handle: async ({ input, deps, context, authorize }) => {
    if (!context) throw new RouteRefusalError({ status: 401, body: { error: "authentication required" } });
    return ok({ value: await previewOrRefuse({ body: input.body, deps, authorize }) });
  },
});

/** The preview spec, with its no-store header on every answer. */
export const widgetPreviewRoute: WidgetPreviewSpec = { ...previewSpec, responseHeaders: WIDGET_PREVIEW_RESPONSE_HEADERS };
