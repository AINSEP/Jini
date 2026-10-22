// Test-only argument adapters keep copied assertions byte-identical.
import * as owner from "../../../html/html-embeds.js";
export * from "../../../html/html-embeds.js";
export function scanHtmlEmbeds(html: Parameters<typeof owner.scanHtmlEmbeds>[0]["html"]) { return owner.scanHtmlEmbeds({ html }); }
export function substituteHtmlEmbeds(html: Parameters<typeof owner.substituteHtmlEmbeds>[0]["html"], resolve: Parameters<typeof owner.substituteHtmlEmbeds>[0]["resolve"]) { return owner.substituteHtmlEmbeds({ html, resolve }); }
