// @vitest-environment jsdom
import { render, screen } from "../../../__tests__/fetch-query-support.js";
import { describe, expect, it } from "vitest";

import { Analytics } from "../Analytics.js";
import type { AnalyticsController } from "../hooks/use-analytics.hooks.js";

/**
 * @file `Analytics` — markup-only screen. Every state below is driven through the injectable
 * `useAnalyticsHook` prop (see `Posts.tsx`'s own doc for the convention), never a fake `fetch`:
 * the whole point of the hook seam is that this screen's states (loading, error, empty, populated)
 * are reachable without a `DataTable` render depending on a real request settling.
 *
 * `t` (2026-08-11, standing i18n rule): `Analytics` now reads `t` off the injected hook rather than
 * calling `useAdminLocale()`/`analytics-i18n` itself, so `stubHook` supplies the identity translator
 * — every assertion below matches on the raw English key, stable against future copy/locale
 * changes, matching `wired-hooks-convention.md`'s own `t: (k) => k` example.
 */

function stubHook(overrides: Partial<AnalyticsController>): () => AnalyticsController {
  return () => ({ hits: null, error: null, t: ({ key }: { key: string }, _optional = {}) => key, ...overrides });
}

const HIT_WITH_EVENT = {
  occurredAt: "2026-08-01T12:00:00.000Z",
  kind: "event" as const,
  path: "/pricing",
  referrerHost: "google.com",
  deviceClass: "mobile" as const,
  browserFamily: "Safari",
  eventName: "cta_click",
};

const HIT_DIRECT_PAGEVIEW = {
  occurredAt: "2026-08-01T13:00:00.000Z",
  kind: "pageview" as const,
  path: "/",
  referrerHost: null,
  deviceClass: "desktop" as const,
  browserFamily: null,
  eventName: null,
};

describe("Analytics — loading and error states", () => {
  it("shows a loading notice while hits is null and there is no error", () => {
    render(<Analytics useAnalyticsHook={stubHook({ hits: null, error: null })} />);
    expect(screen.getByText(/loading recent hits/i)).toBeInTheDocument();
  });

  it("shows the error notice instead of the table when error is set — even once hits has already loaded", () => {
    // `Analytics.tsx`'s guard is `if (error) return <notice>`, unconditioned on `hits` (unlike
    // `Posts.tsx`'s `error && !posts`). A stub that supplies BOTH is the only way to pin that this
    // is the real branch structure and not an assumption about it.
    render(<Analytics useAnalyticsHook={stubHook({ hits: [HIT_DIRECT_PAGEVIEW], error: "ingest buffer down" })} />);
    expect(screen.getByText("ingest buffer down")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("Analytics — empty state", () => {
  it("shows the empty-state copy for a zero-length hits array (not the loading notice)", () => {
    render(<Analytics useAnalyticsHook={stubHook({ hits: [] })} />);
    expect(screen.getByText(/no hits recorded yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/loading recent hits/i)).not.toBeInTheDocument();
  });
});

describe("Analytics — Cookie Consent cross-link", () => {
  it("links to the Cookie Consent screen from the header", () => {
    render(<Analytics useAnalyticsHook={stubHook({ hits: [] })} />);
    expect(screen.getByRole("link", { name: "Cookie Consent" })).toHaveAttribute("href", "/admin/consent");
  });
});

describe("Analytics — populated table", () => {
  it("renders the five headers and formats each hit's occurrence time", () => {
    render(<Analytics useAnalyticsHook={stubHook({ hits: [HIT_WITH_EVENT, HIT_DIRECT_PAGEVIEW] })} />);
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Path", "Referrer", "Device / Browser", "Kind", "Time",
    ]);
    expect(screen.getByRole("cell", { name: "2026-08-01 12:00" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "2026-08-01 13:00" })).toBeInTheDocument();
  });

  it("renders referrer as '(direct)' when referrerHost is null, and the real host otherwise", () => {
    render(<Analytics useAnalyticsHook={stubHook({ hits: [HIT_WITH_EVENT, HIT_DIRECT_PAGEVIEW] })} />);
    expect(screen.getByText("google.com")).toBeInTheDocument();
    expect(screen.getByText("(direct)")).toBeInTheDocument();
  });

  it("appends the browser family to device class only when browserFamily is present", () => {
    render(<Analytics useAnalyticsHook={stubHook({ hits: [HIT_WITH_EVENT, HIT_DIRECT_PAGEVIEW] })} />);
    expect(screen.getByText("mobile / Safari")).toBeInTheDocument();
    // `HIT_DIRECT_PAGEVIEW.browserFamily` is null — must render the device class alone, no
    // trailing " / " artifact.
    expect(screen.getByText("desktop")).toBeInTheDocument();
    expect(screen.queryByText(/desktop \//)).not.toBeInTheDocument();
  });

  it("renders 'event: <name>' for an event hit and the bare kind for a pageview", () => {
    render(<Analytics useAnalyticsHook={stubHook({ hits: [HIT_WITH_EVENT, HIT_DIRECT_PAGEVIEW] })} />);
    expect(screen.getByText("event: cta_click")).toBeInTheDocument();
    expect(screen.getByText("pageview")).toBeInTheDocument();
  });

  it("renders each hit's path", () => {
    render(<Analytics useAnalyticsHook={stubHook({ hits: [HIT_WITH_EVENT] })} />);
    expect(screen.getByText("/pricing")).toBeInTheDocument();
  });
});
