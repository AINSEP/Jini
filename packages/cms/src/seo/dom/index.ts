/// <reference lib="dom" />
import type { HeadElement } from "../types.js";

/**
 * Applies the finalized head descriptors using the browser's text/attribute sinks. The caller
 * owns registration, deduplication and replacement of previous contributions. JSON-LD retains the
 * server serializer's `<` escape so an embedded closing script tag cannot become markup when the
 * document is serialized. Returns the inserted nodes so the caller can remove its contribution.
 * @complexity O(total descriptor text length), one element per descriptor.
 */
export function applyHeadElements(
  required: { elements: readonly HeadElement[] },
  optional: { document: Document }
): HTMLElement[] {
  const { document } = optional;
  const nodes = required.elements.map((element) => {
    switch (element.kind) {
      case "title": {
        const node = document.createElement("title");
        node.textContent = element.text;
        return node;
      }
      case "meta": {
        const node = document.createElement("meta");
        node.setAttribute("name", element.name);
        node.setAttribute("content", element.content);
        return node;
      }
      case "og": {
        const node = document.createElement("meta");
        node.setAttribute("property", element.property);
        node.setAttribute("content", element.content);
        return node;
      }
      case "link": {
        const node = document.createElement("link");
        node.setAttribute("rel", element.rel);
        node.setAttribute("href", element.href);
        if (element.hreflang) node.setAttribute("hreflang", element.hreflang);
        if (element.type) node.setAttribute("type", element.type);
        if (element.title) node.setAttribute("title", element.title);
        return node;
      }
      case "jsonld": {
        const node = document.createElement("script");
        node.setAttribute("type", "application/ld+json");
        node.textContent = JSON.stringify(element.data).replace(/</g, "\\u003c");
        return node;
      }
    }
  });
  document.head.append(...nodes);
  return nodes;
}
