// Test-only argument adapters keep copied assertions byte-identical.
import * as owner from "../../../region-area-service.js";
export * from "../../../region-area-service.js";
export function validatePlacementWidgetsExist(deps: Parameters<typeof owner.validatePlacementWidgetsExist>[0]["deps"], workspaceId: Parameters<typeof owner.validatePlacementWidgetsExist>[0]["workspaceId"], placements: Parameters<typeof owner.validatePlacementWidgetsExist>[0]["placements"]) { return owner.validatePlacementWidgetsExist({ deps, workspaceId, placements }); }
