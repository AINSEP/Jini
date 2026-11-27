import { expect, it } from "vitest";
import {
  categoryLabel, costClassLabel, isAssertiveRecoveryBanner, parseDeepLinkEnvelope,
  recoveryBannerTone, restoreButtonAccessibleName,
} from "../rules.js";
import type { AdminDegradedBanner } from "../../core/index.js";

it("localizes known recovery labels and keeps unknown server values readable", () => {
  expect(categoryLabel({ category: "posts_pages", locale: "es" })).toBe("escrituras de posts/páginas");
  expect(categoryLabel({ category: "search_index", locale: "es" })).toBe("escrituras de search_index");
  expect(categoryLabel({ category: "search_index", locale: "unlisted" })).toBe("search_index writes");
  expect(costClassLabel({ costClass: "cheap", locale: "es" })).toBe("Restauración rápida");
  expect(costClassLabel({ costClass: "offline-snapshot", locale: "es" })).toBe("offline-snapshot");
});

it.each([
  ["migration-interrupted", "error", true],
  ["pending-migration", "error", true],
  ["cost-unavailable", "error", false],
  ["operation-in-flight", "warning", false],
  ["watermark-baseline-unavailable", "", false],
] as const)("keeps %s severity separate from announcement urgency", (kind, tone, assertive) => {
  const banner: AdminDegradedBanner = { kind, actionKind: "none", accessibleText: "Restore capability changed" };
  expect(recoveryBannerTone(banner)).toBe(tone);
  expect(isAssertiveRecoveryBanner(banner)).toBe(assertive);
});

it("rejects malformed deep links but leaves valid JSON, even falsy JSON, to the server", () => {
  expect(parseDeepLinkEnvelope({ raw: '{"siteId":' })).toEqual({ ok: false });
  expect(parseDeepLinkEnvelope({ raw: "null" })).toEqual({ ok: true, envelope: null });
  expect(parseDeepLinkEnvelope({ raw: '{"siteId":"site-7","restorePointId":"rp-9"}' })).toEqual({
    ok: true, envelope: { siteId: "site-7", restorePointId: "rp-9" },
  });
});

it("distinguishes restore buttons by the point timestamp in the viewer time zone", () => {
  const viewerTimeZone = "America/Los_Angeles";
  expect(restoreButtonAccessibleName({ locale: "en", point: { createdAt: "2026-01-10T03:27:00Z" }, viewerTimeZone })).toBe("Restore… 2026-01-09 19:27");
  expect(restoreButtonAccessibleName({ locale: "en", point: { createdAt: "2026-01-10T06:04:00Z" }, viewerTimeZone })).toBe("Restore… 2026-01-09 22:04");
});
