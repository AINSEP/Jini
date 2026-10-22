// Test-only argument adapters keep copied assertions byte-identical.
import * as owner from "../../../registry.js";
export * from "../../../registry.js";
export function getWidgetTypeRegistration<K extends keyof typeof owner.WIDGET_TYPE_REGISTRATIONS>(typeKey: K) { return owner.getWidgetTypeRegistration({ typeKey }); }
export function findWidgetTypeRegistration(raw: Parameters<typeof owner.findWidgetTypeRegistration>[0]["raw"]) { return owner.findWidgetTypeRegistration({ raw }); }
