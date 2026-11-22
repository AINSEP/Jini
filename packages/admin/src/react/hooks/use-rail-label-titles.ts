import { useEffect } from 'react';

type RailLabelTitles = {
  navId: string; linkSelector: string; labelSelector: string;
  skipLink?: (required: { link: Element }, optional?: Record<string, never>) => boolean;
};

function showLabelAsTitle({ link, original, labelSelector }: {
  link: Element; original: Map<Element, string | null>; labelSelector: string;
}): void {
  const text = link.querySelector(labelSelector)?.textContent;
  if (!text) return;
  if (!original.has(link)) original.set(link, link.getAttribute('title'));
  link.setAttribute('title', text);
}

/**
 * Titles matching links from their visible labels and restores those titles on unmount.
 * Skipped links have their title removed, deferring tooltip ownership to the host.
 * @complexity Each observed update scans matching links; originals are retained until cleanup.
 */
export function useRailLabelTitles(
  { navId, linkSelector, labelSelector, skipLink }: RailLabelTitles,
  { doc = document }: { doc?: Document } = {},
): void {
  useEffect(() => {
    const nav = doc.getElementById(navId);
    if (!nav) return undefined;
    const original = new Map<Element, string | null>();
    const update = () => {
      for (const link of nav.querySelectorAll(linkSelector)) {
        if (skipLink?.({ link })) link.removeAttribute('title');
        else showLabelAsTitle({ link, original, labelSelector });
      }
    };
    update();
    // Locale and permission changes can replace labels or rows without remounting the navigation.
    const observer = new MutationObserver(update);
    observer.observe(nav, { childList: true, characterData: true, subtree: true });
    return () => {
      observer.disconnect();
      for (const [link, title] of original) {
        if (title === null) link.removeAttribute('title');
        else link.setAttribute('title', title);
      }
    };
  }, [doc, navId, linkSelector, labelSelector, skipLink]);
}
