import type { JsonObject } from "@jini-ai/core/primitives";
import { validateWidgetConfig } from "../config-validation.js";
import { WidgetConfigValidationError, WidgetTypeUnregisteredError } from "../errors.js";
import { findWidgetTypeRegistration } from "../registry.js";
import { resolveWidgetType } from "../resolvers/index.js";
import type { WidgetRenderIR } from "../types.js";

/**
 * @file The product-neutral half of a widget PREVIEW: registry lookup, config validation, resolver
 * dispatch for the one unsaved instance, and the IR the preview renders. The host keeps what is
 * its own: the active-theme choice, the document wrapped around the fragment and the preview copy.
 */

/** The unsaved widget a preview resolves. */
export interface WidgetPreviewResolveInput { widgetType: string; content: JsonObject }

/** The id the single unsaved instance carries through the resolver. */
const PREVIEW_INSTANCE_ID = "unsaved-widget-preview";

/** What a preview renders when its resolution failed or answered nothing, as the public pipeline does. */
const PLACEHOLDER_IR: WidgetRenderIR = { componentId: "widget-placeholder", props: {} };

/**
 * Never persists a widget. Resolves the unsaved instance through the registry's own resolver and
 * answers the IR to render: the resolved one, or the public placeholder when resolution failed.
 * @throws {WidgetTypeUnregisteredError} when `widgetType` is not registered.
 * @throws {WidgetConfigValidationError} when `content` fails the type's registered schema.
 * @complexity One bounded widget resolution.
 */
export async function resolveWidgetPreviewIr(
  { input, workspaceId }: { input: WidgetPreviewResolveInput; workspaceId: string },
  { resolve = resolveWidgetType }: { resolve?: typeof resolveWidgetType } = {},
): Promise<WidgetRenderIR> {
  const registration = findWidgetTypeRegistration({ raw: input.widgetType });
  if (!registration) throw new WidgetTypeUnregisteredError({ message: "widget type is unregistered", widgetType: input.widgetType });
  const validation = validateWidgetConfig({ schema: registration.configSchema, config: input.content });
  if (!validation.valid) throw new WidgetConfigValidationError({ message: "widget config is invalid", fieldErrors: validation.fieldErrors });
  const resolved = await resolve({
    typeKey: registration.typeKey,
    instances: [{ id: PREVIEW_INSTANCE_ID, widgetType: registration.typeKey, config: input.content }],
    // Match public resolver semantics. Authentication lives at the HTTP boundary.
    context: { workspaceId, preview: false },
  });
  const result = resolved.get(PREVIEW_INSTANCE_ID);
  return result?.ok ? result.ir : PLACEHOLDER_IR;
}
