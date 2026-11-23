// @vitest-environment jsdom
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "../../../__tests__/fetch-query-support.js";
import { ContentAnalysisCard, ContentAnalysisCardView } from "../ContentAnalysisCard.js";
import { createFakeContentAnalysisPort } from "../hooks/content-analysis-dependencies.hooks.js";
import type { ContentAnalysisController, ContentAnalysisTarget } from "../hooks/use-content-analysis.hooks.js";
import { CONTENT_ANALYZER_PLUGIN_ID, buildContentAnalysisView, parseContentAnalysisReport } from "../rules.js";
import { VALID_REPORT_JSON, reportJson } from "./content-analysis-fixtures.js";

/**
 * @file `ContentAnalysisCard` — markup only. Each state is driven through `ContentAnalysisCardView`
 * with a hand-built controller; the end-to-end cases mount `ContentAnalysisCard` itself with the fake
 * port and an injected locale hook (both REQUIRED props the host supplies).
 */

const identity = (key: string) => key;
const REPORT = parseContentAnalysisReport({ raw: VALID_REPORT_JSON })!;
const TARGET: ContentAnalysisTarget = {
  post: { id: "p1", version: 1, ext: { [CONTENT_ANALYZER_PLUGIN_ID]: { report: VALID_REPORT_JSON } } },
  title: "Draft",
  bodyJson: null,
};

function controller(overrides: Partial<ContentAnalysisController> = {}): ContentAnalysisController {
  return {
    hidden: false,
    view: buildContentAnalysisView({ state: { kind: "report", source: "stored", report: REPORT }, t: identity }),
    analyzing: false,
    error: null,
    analyze: vi.fn(async () => {}),
    t: identity,
    ...overrides,
  };
}

function renderCard(overrides: Partial<ContentAnalysisController> = {}) {
  const hook = controller(overrides);
  const utils = render(<ContentAnalysisCardView controller={hook} />);
  return { ...utils, hook };
}

describe("ContentAnalysisCard", () => {
  it("renders nothing while the plugin is disabled", () => {
    const { container } = renderCard({ hidden: true });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the stored analysis in a labelled region: stats, table of contents and every check", () => {
    renderCard();
    const region = screen.getByRole("region", { name: "Content analysis" });
    expect(within(region).getByText("From the last save.")).toBeInTheDocument();

    const stats = within(region).getAllByRole("list")[0]!;
    expect(within(stats).getByText("84")).toBeInTheDocument();
    expect(within(stats).getByText("420")).toBeInTheDocument();
    expect(within(stats).getByText("3 min")).toBeInTheDocument();
    expect(within(stats).getByText("64.2")).toBeInTheDocument();
    expect(within(stats).getByText("Standard · grade 8.1")).toBeInTheDocument();

    const toc = within(region).getByRole("list", { name: "Table of contents" });
    const tocItems = within(toc).getAllByRole("listitem");
    expect(tocItems.map((item) => item.textContent)).toEqual(["H2Intro", "H3Details"]);
    expect(tocItems[1]).toHaveStyle({ paddingInlineStart: "1rem" });

    const checks = within(region).getByRole("list", { name: "Checks" });
    const checkItems = within(checks).getAllByRole("listitem");
    expect(checkItems).toHaveLength(7);
    // Status reads as text, not colour alone; the icon is decorative.
    expect(within(checkItems[2]!).getByText("Fail")).toBeInTheDocument();
    expect(within(checkItems[2]!).getByText("1 of 3 images are missing alt text.")).toBeInTheDocument();
    expect(checkItems[2]!.querySelector(".status-error [aria-hidden='true']")?.textContent).toBe("✕");
  });

  it("says so when the analysis has no headings", () => {
    renderCard({ view: buildContentAnalysisView({ state: { kind: "report", source: "stored", report: { ...REPORT, toc: [] } }, t: identity }) });
    expect(screen.getByText("No headings yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Table of contents" })).not.toBeInTheDocument();
  });

  it("shows the unavailable state with no report sections", () => {
    renderCard({ view: buildContentAnalysisView({ state: { kind: "invalid" }, t: identity }) });
    expect(screen.getByText("Analysis unavailable.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Checks" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyze now" })).toBeEnabled();
  });

  it("disables the button and says it is working while analyzing", () => {
    renderCard({ analyzing: true });
    expect(screen.getByRole("button", { name: "Analyzing…" })).toBeDisabled();
  });

  it("announces a failed run", () => {
    renderCard({ error: "The analyzer could not process this content." });
    expect(screen.getByRole("alert")).toHaveTextContent("The analyzer could not process this content.");
  });

  it("runs Analyze now on click", async () => {
    const { hook } = renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Analyze now" }));
    expect(hook.analyze).toHaveBeenCalledTimes(1);
  });

  it("with the real hook, Analyze now swaps the stored analysis for the draft's fresh one", async () => {
    const port = createFakeContentAnalysisPort({ previewFields: { report: reportJson({ score: 61 }) } });
    render(<ContentAnalysisCard {...TARGET} port={port} useAdminLocale={() => "en"} />);
    expect(await screen.findByText("From the last save.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Analyze now" }));
    expect(await screen.findByText("From your current draft, including unsaved changes.")).toBeInTheDocument();
    expect(screen.getByText("61")).toBeInTheDocument();
  });

  it("renders nothing when the injected port reports content-analyzer disabled", async () => {
    const port = createFakeContentAnalysisPort({ enabled: false });
    const { container } = render(<ContentAnalysisCard {...TARGET} port={port} useAdminLocale={() => "en"} />);
    await vi.waitFor(() => expect(port.statusCalls).toBe(1));
    expect(container).toBeEmptyDOMElement();
  });

  it("speaks the locale the host's injected useAdminLocale hook returns", async () => {
    const port = createFakeContentAnalysisPort();
    const useAdminLocale = vi.fn(() => "es");
    render(<ContentAnalysisCard {...TARGET} port={port} useAdminLocale={useAdminLocale} />);
    expect(await screen.findByRole("region", { name: "Análisis de contenido" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analizar ahora" })).toBeEnabled();
    expect(useAdminLocale).toHaveBeenCalled();
  });
});
