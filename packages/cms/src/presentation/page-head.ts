import { escapeHtml } from "@jini-ai/core/text";
import { orFallback } from "@jini-ai/core/errors/idioms";
import type { HeadElement, HeadElementKey, JsonLd, PageHeadContext, PageHeadHook } from "../seo/types.js";

/**
 * @file The `page.head` render seam (ADR-PIPE-008 Decision §2).
 *
 * Purpose:
 * Owned by the render layer, NOT by the `seo` feature module (an
 * open design item named this exact gap and deferred seam ownership to "the theme-
 * contract owner" — this file takes that role). A small, core-owned, in-module
 * ordered fold over explicitly supplied contributors, not a port (hooks/registries are exempt
 * from rule-of-two).
 *
 * `HeadElement` is the canonical render IR (never raw HTML strings — the
 * largest theme-injection surface, INV-03). `serializeHeadElements` is the
 * ONE place IR becomes a string; every value is escaped there.
 */

function headElementKey(element: HeadElement): string {
  switch (element.kind) {
    case "title":
      return "title";
    case "meta":
      return `meta:${element.name}`;
    case "og":
      return `og:${element.property}`;
    case "link": {
      // `type` joins the key only when present, so every existing key is unchanged; it keeps an RSS
      // and an Atom `alternate` from overwriting each other.
      const key = element.type === undefined ? `link:${element.rel}` : `link:${element.rel}:${element.type}`;
      // Language alternates are distinct resources, even when their rel and MIME type agree.
      return element.hreflang === undefined ? key : `${key}:hreflang:${element.hreflang}`;
    }
    case "jsonld": {
      const type = element.data["@type"];
      return `jsonld:${typeof type === "string" ? type : "untyped"}`;
    }
    // Preserve the undefined fallback for runtime inputs outside this exhaustive union.
    default: return undefined as never;
  }
}

/**
 * Awaits this render's supplied contributors sorted by ascending contributor
 * `priority` (stable — ties preserve registration order), drops (never
 * rethrows) a throwing contributor's output (REQ-16/EC-06 fail-closed-per-
 * contributor fold), dedups by `HeadElementKey` with last-writer-wins-by-
 * (element)-priority + later-registration tie-break (behavior.spec.md
 * §5.2/§6.1), and returns the final array ordered ascending by each winning
 * element's own `priority` (the INV-required final-order guarantee).
 */
export async function foldPageHead({ context }: { context: PageHeadContext }, { contributors = [] }: { contributors?: readonly PageHeadHook[] } = {}): Promise<HeadElement[]> {
  const sortedContributors = [...contributors].sort((a, b) => a.priority - b.priority);

  const flattened: HeadElement[] = [];
  for (const contributor of sortedContributors) {
    // Fail-closed-per-contributor: a throwing contributor never breaks the fold.
    await orFallback({
      work: async () => {
        const elements = await contributor.handle(context);
        flattened.push(...elements);
      },
      fallback: undefined,
      step: "page head contributor",
    });
  }

  // Ascending by element priority (stable) so that, for a colliding key, the
  // highest-priority element is processed (and therefore wins the Map slot) last.
  flattened.sort((a, b) => a.priority - b.priority);

  const winners = new Map<HeadElementKey, HeadElement>();
  for (const element of flattened) {
    winners.set(headElementKey(element), element);
  }

  return [...winners.values()].sort((a, b) => a.priority - b.priority);
}

// ---------------------------------------------------------------------------
// Serialization — the one place IR becomes a string (INV-03)
// ---------------------------------------------------------------------------

/**
 * A jsonld payload is `JSON.stringify`-serialized, never string-concatenated
 * (INV-03) — `<` is additionally escaped to `<` so a value containing a
 * literal `</script>` can never break out of the surrounding tag.
 */
function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function serializeElement(element: HeadElement): string {
  switch (element.kind) {
    case "title":
      return `<title>${escapeHtml({ text: element.text })}</title>`;
    case "meta":
      return `<meta name="${escapeHtml({ text: element.name })}" content="${escapeHtml({ text: element.content })}"/>`;
    case "og":
      return `<meta property="${escapeHtml({ text: element.property })}" content="${escapeHtml({ text: element.content })}"/>`;
    case "link": {
      const hreflang = element.hreflang ? ` hreflang="${escapeHtml({ text: element.hreflang })}"` : "";
      const type = element.type ? ` type="${escapeHtml({ text: element.type })}"` : "";
      const title = element.title ? ` title="${escapeHtml({ text: element.title })}"` : "";
      return `<link rel="${escapeHtml({ text: element.rel })}" href="${escapeHtml({ text: element.href })}"${hreflang}${type}${title}/>`;
    }
    case "jsonld":
      return `<script type="application/ld+json">${serializeJsonLd(element.data)}</script>`;
    // Preserve the undefined fallback for runtime inputs outside this exhaustive union.
    default: return undefined as never;
  }
}

/** Turns the final `HeadElement[]` into escaped `<head>` tag markup. */
export function serializeHeadElements({ elements }: { elements: HeadElement[] }, _optional = {}): string {
  return elements.map(serializeElement).join("");
}
