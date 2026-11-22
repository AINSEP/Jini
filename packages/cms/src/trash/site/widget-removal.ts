import { bindRemoveEntity } from "../index.js";
import type { TrashPort } from "../index.js";
import type { RemoveEntity } from "./ports.js";

/**
 * Preserve legacy widget payload status when the shared trash service stores its restore marker.
 * Widget adoption supplies priorMarker through its product port; Jini takes it as an option.
 * @complexity O(1) beyond the shared removal service.
 */
export function bindWidgetRemoval(required: { trash: TrashPort }, _optional: Record<string, never> = {}): RemoveEntity {
  const remove = bindRemoveEntity({ trash: required.trash, entityType: "widget" });
  // exactOptionalPropertyTypes: an absent marker is passed as no option, never as `undefined`.
  return ({ priorMarker, ...record }) => remove(record, priorMarker === undefined ? {} : { priorMarker });
}
