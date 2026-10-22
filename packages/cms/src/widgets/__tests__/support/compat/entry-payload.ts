// Test-only argument adapters keep copied assertions byte-identical.
import * as owner from "../../../entry-payload.js";
export * from "../../../entry-payload.js";
export function buildWidgetInstanceFieldsJson(payload: Parameters<typeof owner.buildWidgetInstanceFieldsJson>[0]["payload"]) { return owner.buildWidgetInstanceFieldsJson({ payload }); }
export function parseWidgetInstancePayload(fieldsJson: Parameters<typeof owner.parseWidgetInstancePayload>[0]["fieldsJson"]): ReturnType<typeof owner.parseWidgetInstancePayload> { return owner.parseWidgetInstancePayload({ fieldsJson }); }
export function buildWidgetAreaFieldsJson(payload: Parameters<typeof owner.buildWidgetAreaFieldsJson>[0]["payload"]) { return owner.buildWidgetAreaFieldsJson({ payload }); }
export function parseWidgetAreaPayload(fieldsJson: Parameters<typeof owner.parseWidgetAreaPayload>[0]["fieldsJson"]): ReturnType<typeof owner.parseWidgetAreaPayload> { return owner.parseWidgetAreaPayload({ fieldsJson }); }
export function toWidgetInstanceEntry(entry: Parameters<typeof owner.toWidgetInstanceEntry>[0]["entry"]) { return owner.toWidgetInstanceEntry({ entry }); }
export function toWidgetAreaEntry(entry: Parameters<typeof owner.toWidgetAreaEntry>[0]["entry"]) { return owner.toWidgetAreaEntry({ entry }); }
export function widgetAreaSlug(regionKey: Parameters<typeof owner.widgetAreaSlug>[0]["regionKey"]) { return owner.widgetAreaSlug({ regionKey }); }
export function emptyWidgetAreaDoc() { return owner.emptyWidgetAreaDoc({  }); }
