// Test-only argument adapters keep copied assertions byte-identical.
import * as owner from "../../../markers/html-attributes.js";
export * from "../../../markers/html-attributes.js";
export function isAllowedEmbedHtmlAttributeName(name: Parameters<typeof owner.isAllowedEmbedHtmlAttributeName>[0]["name"]) { return owner.isAllowedEmbedHtmlAttributeName({ name }); }
export function parseEmbedHtmlAttributes(text: Parameters<typeof owner.parseEmbedHtmlAttributes>[0]["text"]) { return owner.parseEmbedHtmlAttributes({ text }); }
