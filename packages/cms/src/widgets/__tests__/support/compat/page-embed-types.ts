// Test-only argument adapters keep copied assertions byte-identical.
import * as owner from "../../../page-embed-types.js";
export * from "../../../page-embed-types.js";
export function isPageEmbedType(type: Parameters<typeof owner.isPageEmbedType>[0]["type"]) { return owner.isPageEmbedType({ type }); }
