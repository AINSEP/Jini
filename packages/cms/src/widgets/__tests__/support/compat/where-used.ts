// Test-only argument adapters keep copied assertions byte-identical.
import * as owner from "../../../where-used.js";
export * from "../../../where-used.js";
export function toWhereUsedResponse(refs: Parameters<typeof owner.toWhereUsedResponse>[0]["refs"]) { return owner.toWhereUsedResponse({ refs }); }
