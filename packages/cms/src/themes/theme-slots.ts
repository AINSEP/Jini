/** Shared partial-slot vocabulary and defaults. */

import type { ThemeSlotDescriptor } from "@jini-ai/core/contracts/site/core-theme-slots";

/** @file Pure theme defaults and route selection, shared without loading filesystem validators. */
/**
 * The `nav`/`footer` pair `resolveSlots` hardcoded before {@link ThemeManifest.slots} was parsed.
 * Used verbatim when a static theme declares no `slots`, so such a theme renders exactly as it did.
 */
export const DEFAULT_THEME_SLOTS: Readonly<Record<string, ThemeSlotDescriptor>> = {
  nav: { source: "nav.html", honorsCurrentPage: true },
  footer: { source: "footer.html" },
};
