import { isNonArrayRecord } from "@jini-ai/core";
import { WIDGET_AREA_FIELD_NAMESPACE, WIDGET_FIELD_NAMESPACE } from "./types.js";
import type { WidgetAreaDoc, WidgetInstanceStatus, WidgetRegionKey, WidgetTypeKey } from "./types.js";

/**
 * @file The pure storage envelope of a widget instance / `widget_area` entry: one JSON-serialized
 * `payload` text field under `fieldsJson.ext.<owner>`. Split from `entry-payload.ts` (which also
 * registers content types and maps read models) so readers in other domains — e.g. media's
 * rendition access — can decode a placed widget without loading the widgets write side.
 * See `entry-payload.ts`'s header for why the payload is one string field.
 */

export const WIDGET_PAYLOAD_FIELD = "payload";

export interface WidgetInstancePayload {
  widgetType: WidgetTypeKey;
  /** `Record<string, unknown>`, not `JsonObject`, matching the stub-frozen `Create/UpdateWidgetInstanceInput.config` shape (`write-service.ts`) — cast to `JsonObject` only at the `WidgetInstanceEntry` read-model boundary below. */
  config: Record<string, unknown>;
  status: WidgetInstanceStatus;
}

export interface WidgetAreaPayload {
  regionKey: WidgetRegionKey;
  doc: WidgetAreaDoc;
}

/** Reads the single `payload` text field out of an entry's `fieldsJson.ext.<owner>` envelope. */
function readPayloadString(fieldsJson: unknown, owner: string): string {
  const fields = { value: fieldsJson };
  if (!isNonArrayRecord(fields)) throw new Error("widgets: malformed fieldsJson (expected an object)");
  const ext = { value: fields.value.ext };
  if (!isNonArrayRecord(ext)) throw new Error("widgets: malformed fieldsJson (missing ext)");
  const ownerBag = { value: ext.value[owner] };
  if (!isNonArrayRecord(ownerBag) || typeof ownerBag.value[WIDGET_PAYLOAD_FIELD] !== "string") {
    throw new Error(`widgets: malformed fieldsJson (missing fields.ext.${owner}.payload)`);
  }
  return ownerBag.value[WIDGET_PAYLOAD_FIELD];
}

function buildFieldsJson(payload: unknown, owner: string): unknown {
  return { ext: { [owner]: { [WIDGET_PAYLOAD_FIELD]: JSON.stringify(payload) } } };
}

export function buildWidgetInstanceFieldsJson({ payload }: { payload: WidgetInstancePayload }, _optional: Record<string, never> = {}): unknown {
  return buildFieldsJson(payload, WIDGET_FIELD_NAMESPACE);
}

export function parseWidgetInstancePayload({ fieldsJson }: { fieldsJson: unknown }, _optional: Record<string, never> = {}): WidgetInstancePayload {
  return JSON.parse(readPayloadString(fieldsJson, WIDGET_FIELD_NAMESPACE)) as WidgetInstancePayload;
}

export function buildWidgetAreaFieldsJson({ payload }: { payload: WidgetAreaPayload }, _optional: Record<string, never> = {}): unknown {
  return buildFieldsJson(payload, WIDGET_AREA_FIELD_NAMESPACE);
}

export function parseWidgetAreaPayload({ fieldsJson }: { fieldsJson: unknown }, _optional: Record<string, never> = {}): WidgetAreaPayload {
  return JSON.parse(readPayloadString(fieldsJson, WIDGET_AREA_FIELD_NAMESPACE)) as WidgetAreaPayload;
}
