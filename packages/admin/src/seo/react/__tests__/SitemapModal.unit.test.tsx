import { act, render, screen } from "./harness/render.js";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SitemapModal } from "../components/SitemapModal.js";
import { useSitemapModal } from "./harness/hooks.js";
import { createFakeSitemapPort } from "./harness/api.js";
import type { SitemapPort } from "./harness/api.js";

/**
 * @file `SitemapModal` — "View sitemap" (owner request, `Seo.tsx`'s Sitemap card). Composes the
 * REAL {@link useSitemapModal} against a `createFakeSitemapPort` (`sitemap-dependencies.hooks.ts`)
 * via the `useModal` prop seam — the same "inject the real state hook bound to a fake port,
 * exercise it through the component" convention `MediaPickerDialog.tsx`'s own tests use for
 * `useDialog`, rather than a hand-typed stub `SitemapModalController`: this way the REAL
 * `parseSitemapXml`/`filterSitemapEntries` logic (`rules.ts`) runs end to end, so a mismatch
 * between what the parser produces and what the table renders cannot hide behind a fake that
 * already assumes the right shape.
 *
 * `Seo.unit.test.tsx` covers the OUTER "does clicking View sitemap open this modal at all"
 * question with its own lightweight `SitemapModalController` stub (never a real fetch); this file
 * owns everything the modal itself does once open.
 */

const TWO_URL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc><lastmod>2026-08-01</lastmod></url>
  <url><loc>https://example.com/about</loc></url>
</urlset>
`;

const ONE_URL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
</urlset>
`;

interface RenderModalOptions {
  sitemapEnabled?: boolean;
  regenerating?: boolean;
  onRegenerate?: () => Promise<boolean>;
  onClose?: () => void;
}

function renderModal(port: SitemapPort, options: RenderModalOptions = {}) {
  const onClose = options.onClose ?? vi.fn();
  const onRegenerate = options.onRegenerate ?? vi.fn(async () => true);
  render(
    <SitemapModal
      locale="en"
      sitemapEnabled={options.sitemapEnabled ?? true}
      regenerating={options.regenerating ?? false}
      onRegenerate={onRegenerate}
      onClose={onClose}
      // Forwards the whole `SitemapModalInputs` object rather than re-listing its fields, so this
      // double cannot silently drop `enabled` the way a positional parameter could.
      useModal={(inputs) => useSitemapModal(port, inputs)}
    />
  );
  return { onClose, onRegenerate };
}

/** A {@link SitemapPort} that hands back each text in `texts` in order, repeating the last one once
 *  exhausted — lets a test assert "the second fetch (a refetch) returned different content". */
function sequencedSitemapPort(texts: string[]): SitemapPort {
  let call = 0;
  return {
    async fetchSitemapXml() {
      const text = texts[Math.min(call, texts.length - 1)]!;
      call += 1;
      return { text };
    },
  };
}

describe("SitemapModal — table view", () => {
  it("renders one row per <url>, with the header URL count", async () => {
    renderModal(createFakeSitemapPort({ text: TWO_URL_XML }));

    expect(await screen.findByRole("heading", { name: "Sitemap · 2 URLs" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://example.com/" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://example.com/about" })).toBeInTheDocument();
    expect(screen.getByText("2026-08-01")).toBeInTheDocument();
  });

  it("the sitemap has no URLs yet — shows the empty notice, not a zero-row table", async () => {
    renderModal(createFakeSitemapPort({}));
    expect(await screen.findByText("The sitemap has no URLs yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("the filter box narrows rows by a substring match on the URL", async () => {
    const user = userEvent.setup();
    renderModal(createFakeSitemapPort({ text: TWO_URL_XML }));
    await screen.findByRole("link", { name: "https://example.com/about" });

    await user.type(screen.getByPlaceholderText("Filter by URL…"), "about");

    expect(screen.queryByRole("link", { name: "https://example.com/" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://example.com/about" })).toBeInTheDocument();
  });

  it("a filter matching nothing shows a no-match notice, not an empty table", async () => {
    const user = userEvent.setup();
    renderModal(createFakeSitemapPort({ text: TWO_URL_XML }));
    await screen.findByRole("link", { name: "https://example.com/" });

    await user.type(screen.getByPlaceholderText("Filter by URL…"), "nonexistent-path");

    expect(screen.getByText("No URLs match this filter.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("SitemapModal — Raw XML toggle", () => {
  it("shows the exact raw response text, and toggling back returns to the table", async () => {
    const user = userEvent.setup();
    renderModal(createFakeSitemapPort({ text: TWO_URL_XML }));
    await screen.findByRole("link", { name: "https://example.com/" });

    await user.click(screen.getByRole("button", { name: "Raw XML" }));

    // A direct `querySelector`, not `getByText`: the raw text also bubbles up as the `textContent`
    // of `.sitemap-modal-raw`'s own ancestors, so a text-content matcher would report "multiple
    // elements found" against this exact same string — the `<pre>` itself is the one unambiguous
    // node to assert against.
    expect(document.querySelector(".sitemap-modal-raw")).toHaveTextContent(TWO_URL_XML, { normalizeWhitespace: false });
    expect(screen.queryByRole("link", { name: "https://example.com/" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByRole("link", { name: "https://example.com/" })).toBeInTheDocument();
  });
});

/** Flushes a full turn of the event loop inside `act`, so anything a wrongly-fired fetch would do
 *  has actually landed (and re-rendered) before a test asserts it never happened. Without this a
 *  synchronous assertion runs while the port promise is still pending and passes no matter what the
 *  component does — the exact vacuum these disabled-state tests used to sit in. */
async function flushPendingFetches(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** A {@link SitemapPort} that records every call, so a test can assert the fetch was NOT made. */
function countingSitemapPort(text: string): SitemapPort & { calls: number } {
  const port = {
    calls: 0,
    async fetchSitemapXml() {
      port.calls += 1;
      return { text };
    },
  };
  return port;
}

describe("SitemapModal — disabled and error states", () => {
  it("shows the disabled message instead of a table when sitemapEnabled is false", async () => {
    renderModal(createFakeSitemapPort({ text: TWO_URL_XML }), { sitemapEnabled: false });
    await flushPendingFetches();

    expect(screen.getByText(/Sitemap is off/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // Only the raw-XML link stays — the raw/table toggle only makes sense once there is a fetch
    // result to toggle, and this state deliberately never fetches (see `SitemapModal.tsx`'s own
    // `sitemapEnabled` prop doc).
    expect(screen.queryByRole("button", { name: "Raw XML" })).not.toBeInTheDocument();
    // The header must not report a URL count either: "the sitemap is off" and "the sitemap has 2
    // URLs" cannot both be true, and REQ 8 exists precisely to keep those two facts distinct.
    expect(screen.getByRole("heading", { name: "Sitemap" })).toBeInTheDocument();
  });

  it("never fetches /sitemap.xml at all when sitemapEnabled is false", async () => {
    const port = countingSitemapPort(TWO_URL_XML);
    renderModal(port, { sitemapEnabled: false });
    await flushPendingFetches();

    expect(port.calls).toBe(0);
  });

  it("a fetch failure shows the error, not a blank modal", async () => {
    renderModal(createFakeSitemapPort({ error: "network exploded" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("network exploded");
  });
});

describe("SitemapModal — regenerate in the footer", () => {
  it("refetches and updates the URL count after a SUCCESSFUL regenerate", async () => {
    const user = userEvent.setup();
    const port = sequencedSitemapPort([ONE_URL_XML, TWO_URL_XML]);
    const { onRegenerate } = renderModal(port, { onRegenerate: vi.fn(async () => true) });
    await screen.findByRole("heading", { name: "Sitemap · 1 URLs" });

    await user.click(screen.getByRole("button", { name: "Regenerate sitemap" }));

    expect(onRegenerate).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("heading", { name: "Sitemap · 2 URLs" })).toBeInTheDocument();
  });

  it("does NOT refetch after a FAILED regenerate", async () => {
    const user = userEvent.setup();
    const port = countingSitemapPort(ONE_URL_XML);
    const { onRegenerate } = renderModal(port, { onRegenerate: vi.fn(async () => false) });
    await screen.findByRole("heading", { name: "Sitemap · 1 URLs" });

    expect(port.calls).toBe(1);
    await user.click(screen.getByRole("button", { name: "Regenerate sitemap" }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);

    // Give a wrongly-fired refetch a turn of the event loop to resolve before asserting it never
    // happened — the count must still read the FIRST fetch's result.
    await flushPendingFetches();
    expect(port.calls).toBe(1);
    expect(screen.getByRole("heading", { name: "Sitemap · 1 URLs" })).toBeInTheDocument();
  });
});

describe("SitemapModal — focus", () => {
  it("renders an open native dialog; browser Tab containment is provided by showModal", async () => {
    renderModal(createFakeSitemapPort({ text: TWO_URL_XML }));
    await screen.findByRole("heading", { name: "Sitemap · 2 URLs" });

    expect(screen.getByRole("dialog").tagName).toBe("DIALOG");
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
  });
});
