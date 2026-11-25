import { expect, it } from "vitest";

import { createPublicPageSecurityHeaderSet } from "../public-page-security-headers.js";

/** L11 Stryker: origin de-duplication and the empty-list `trimEnd` survived; pin the exact CSP. */
const none = { scripts: [], styles: [], fonts: [], fontPreconnects: {} };

it("with no theme resources every directive is exact, with no trailing space", () => {
  expect(createPublicPageSecurityHeaderSet({ resources: none })).toEqual({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy-Report-Only": [
      "default-src 'self'", "img-src 'self' data: https:", "media-src 'self' https:",
      "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "font-src 'self' data:",
      "frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com",
      "connect-src 'self'", "object-src 'none'", "base-uri 'self'",
    ].join("; "),
  });
});

it("theme resources contribute their origins once each, never paths", () => {
  const csp = createPublicPageSecurityHeaderSet({ resources: { ...none,
    scripts: ["https://cdn.example/a.js", "https://cdn.example/b.js", "https://js.other/c.js"],
    styles: ["https://fonts.googleapis.com/css?family=A"],
    fonts: ["https://fonts.gstatic.com/a.woff2", "https://fonts.gstatic.com/b.woff2"],
  } })["Content-Security-Policy-Report-Only"]!;
  expect(csp).toMatch(/; script-src 'self' 'unsafe-inline' https:\/\/cdn\.example https:\/\/js\.other; /);
  expect(csp).toMatch(/; style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com; /);
  expect(csp).toMatch(/; font-src 'self' data: https:\/\/fonts\.gstatic\.com; /);
});

it("the header set is frozen", () => {
  const headers = createPublicPageSecurityHeaderSet({ resources: none });
  expect(Object.isFrozen(headers)).toBe(true);
});
