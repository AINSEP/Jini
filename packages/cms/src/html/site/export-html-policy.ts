import { escapeHtml } from "@jini-ai/core/text";
import { attribute, editedHtml, elements, type Edit, type Element } from "./source-edits.js";

/** Identity and omitted discovery documents cannot truthfully advertise a public address. */
function omittedMetadata({ node }: { node: Element }, _options = {}): boolean {
  if (node.tagName === "meta") return omittedSocialMetadata({ node });
  if (node.tagName !== "link") return false;
  const rel = attribute({ node, name: "rel" })?.toLowerCase().split(/\s+/) ?? [];
  return rel.includes("canonical") || /\/(?:feed|sitemap)\.xml(?:[?#]|$)/i.test(attribute({ node, name: "href" }) ?? "");
}

/** Without an origin, social images must be root-relative or omitted. */
function omittedSocialMetadata({ node }: { node: Element }, _options = {}): boolean {
  const property = (attribute({ node, name: "property" }) ?? attribute({ node, name: "name" }))?.toLowerCase();
  if (property === "og:url") return true;
  if (property !== "og:image" && property !== "twitter:image") return false;
  return !/^\/(?!\/)/.test(attribute({ node, name: "content" }) ?? "");
}

/** JSON-LD identity is optional; keep the remaining structured data valid without a domain. */
function jsonWithoutIdentity({ value }: { value: unknown }, _options = {}): unknown {
  if (Array.isArray(value)) return value.map(item => jsonWithoutIdentity({ value: item }));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "url" && key !== "@id")
    .map(([key, item]) => [key, jsonWithoutIdentity({ value: item })]));
}

/** Malformed structured data cannot be repaired safely; omit that block in the no-domain copy. */
function jsonLdEdit({ node, html }: { node: Element; html: string }, _options = {}): Edit | undefined {
  if (node.tagName !== "script" || attribute({ node, name: "type" })?.toLowerCase() !== "application/ld+json") return undefined;
  const location = node.sourceCodeLocation;
  if (!location?.startTag || !location.endTag) return undefined;
  try {
    const value: unknown = JSON.parse(html.slice(location.startTag.endOffset, location.endTag.startOffset));
    const text = JSON.stringify(jsonWithoutIdentity({ value })).replaceAll("<", "\\u003c");
    return { startOffset: location.startTag.endOffset, endOffset: location.endTag.startOffset, text };
  } catch { return { ...location, text: "" }; }
}

/** Public metadata can be relative when a legacy loopback origin has been treated as unset.
 * Resolve it against this copy's trusted destination; preserve explicit external overrides.
 * @complexity O(attribute bytes), pure; source edits preserve the remainder of the document.
 */
function identityAttribute({ node }: { node: Element }, _options = {}): "href" | "content" | undefined {
  if (node.tagName === "link" && attribute({ node, name: "rel" })?.toLowerCase() === "canonical") return "href";
  if (node.tagName !== "meta") return undefined;
  const property = attribute({ node, name: "property" }) ?? attribute({ node, name: "name" });
  return property?.toLowerCase() === "og:url" ? "content" : undefined;
}

/** Make only root-relative identity attributes absolute; source offsets leave theme bytes intact. */
function publicIdentityEdit({ node, publicOrigin }: { node: Element; publicOrigin: string }, _options = {}): Edit | undefined {
  const key = identityAttribute({ node });
  if (key === undefined) return undefined;
  const value = attribute({ node, name: key }) ?? "";
  const location = node.sourceCodeLocation?.attrs?.[key];
  if (!location || !/^\/(?!\/)/.test(value)) return undefined;
  return { ...location, text: `${key}="${escapeHtml({ text: publicOrigin + value })}"` };
}

/** Reuse WebMCP's exact opt-out owner; leave all theme-owned data attributes alone.
 * Without public identity remove canonical/OG identity and JSON-LD url/@id, without serializing HTML.
 * @complexity O(HTML bytes + edits log edits), no I/O.
 */
export function exportHtml({ html, publicOrigin, stripNativeFormTools }: { html: string; publicOrigin?: string; stripNativeFormTools: (required: { html: string }, optional?: Record<string, never>) => string }, _optional: Record<string, never> = {}): string {
  html = stripNativeFormTools({ html });
  if (publicOrigin) {
    const edits = elements({ html }).map(node => publicIdentityEdit({ node, publicOrigin })).filter(edit => edit !== undefined);
    return editedHtml({ html, edits });
  }
  const edits: Edit[] = [];
  for (const node of elements({ html })) {
    if (omittedMetadata({ node }) && node.sourceCodeLocation) edits.push({ ...node.sourceCodeLocation, text: "" });
    else {
      const edit = jsonLdEdit({ node, html });
      if (edit) edits.push(edit);
    }
  }
  return editedHtml({ html, edits });
}
