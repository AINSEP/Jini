import { useEffect, useRef } from "react";

/** Titles a rail link with its visible label, remembering the original title to restore. */
function showLabelAsTitle({ link, original }: { link: Element; original: Map<Element, string | null> }, _options = {}): void {
  const text = link.querySelector("span")?.textContent;
  if (!text) return;
  if (!original.has(link)) original.set(link, link.getAttribute("title"));
  link.setAttribute("title", text);
}

/** The shared sidebar has rail tooltips only; expanded CMS labels keep their full translated text. */
export function useCmsSidebarLabelTooltips(
  { navId = "admin-sidebar", itemSelector }: {
    navId?: string;
    /** The host's sidebar item links (its own markup and classes). */
    itemSelector: string;
  },
  { doc = document, ownsTitle }: {
    doc?: Document;
    /** Items the host gives its own tooltip; their `title` is cleared instead of set. */
    ownsTitle?: (required: { link: Element }) => boolean;
  } = {},
): void {
  // Read at mutation time, so a host passing an inline predicate does not re-subscribe every render.
  const ownsTitleRef = useRef(ownsTitle);
  ownsTitleRef.current = ownsTitle;
  useEffect(() => {
    const nav = doc.getElementById(navId);
    if (!nav) return undefined;
    const original = new Map<Element, string | null>();
    const update = () => {
      for (const link of nav.querySelectorAll(itemSelector)) {
        // A host item with its own measured tooltip (the host's exception); Jini still supplies its full rail tooltip.
        if (ownsTitleRef.current?.({ link })) link.removeAttribute("title");
        else showLabelAsTitle({ link, original });
      }
    };
    update();
    // Locale and permission changes can replace labels/rows without remounting the sidebar.
    const observer = new MutationObserver(update);
    observer.observe(nav, { childList: true, characterData: true, subtree: true });
    return () => {
      observer.disconnect();
      for (const [link, title] of original) {
        if (title === null) link.removeAttribute("title");
        else link.setAttribute("title", title);
      }
    };
  }, [doc, navId, itemSelector]);
}
