import { describe, expect, it } from "vitest";

import { createFakeThemePagesPort } from "../hooks/theme-pages-fake-port.js";
import type { ThemePagesFileEntry } from "../hooks/theme-pages-port.hooks.js";

/** `setPagePublished`'s "page not found" guard is unreachable through `useThemePages` itself (the
 *  hook only ever calls it with a page id it already resolved from `pageFiles`), so it is exercised
 *  here by direct invocation with a page id absent from the seed. */
const ABOUT: ThemePagesFileEntry = { path: "render/pages/about.html", group: "page", published: false, resettable: true };

describe("createFakeThemePagesPort — setPagePublished not-found guard", () => {
  it("throws 'fake theme page not found' for a page absent from pageFiles", async () => {
    const port = createFakeThemePagesPort({ pageFiles: [ABOUT] });
    await expect(port.setPagePublished({ themeId: "basic", page: "missing-page", published: true })).rejects.toThrow(
      "fake theme page not found: missing-page",
    );
  });
});
