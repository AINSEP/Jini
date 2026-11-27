// @vitest-environment jsdom
import { act, render, renderHook, screen, waitFor, within } from "../../../__tests__/fetch-query-support.js";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ContentAnalysisCard } from "../ContentAnalysisCard.js";
import { createFakeContentAnalysisPort } from "../hooks/content-analysis-dependencies.hooks.js";
import { useFetchMutation, useFetchQuery, useInvalidate } from "../../../react/kit.js";
import { useContentAnalysis, type ContentAnalysisController, type ContentAnalysisTarget } from "../hooks/use-content-analysis.hooks.js";
import { CONTENT_ANALYZER_PLUGIN_ID, buildContentAnalysisView, parseContentAnalysisReport } from "../rules.js";
import { VALID_REPORT_JSON, reportJson } from "./content-analysis-fixtures.js";

/**
 * @file `ContentAnalysisCard` — markup only. Each state is driven through the
 * `useContentAnalysisHook` seam; one end-to-end case composes the real hook with the fake port to
 * show Analyze now replacing the stored analysis with the fresh one. Rendered under the Jini test
 * kit (`fetch-query-support`), whose query slot is the real fetch-query binding. The host-wired case
 * (live transport) stays in the host (its `content-analysis-wired.unit.test.tsx`).
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
  const utils = render(<ContentAnalysisCard {...TARGET} useContentAnalysisHook={() => hook} />);
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
    expect(checkItems[2]!.querySelector(".jini-content-analysis-status-error [aria-hidden='true']")?.textContent).toBe("✕");
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
    render(
      <ContentAnalysisCard {...TARGET} useContentAnalysisHook={(props) => useContentAnalysis(props, { port, locale: "en", useFetchQuery, useFetchMutation })} />
    );
    expect(await screen.findByText("From the last save.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Analyze now" }));
    expect(await screen.findByText("From your current draft, including unsaved changes.")).toBeInTheDocument();
    expect(screen.getByText("61")).toBeInTheDocument();
  });

});

it("reports a refused status read instead of masking it as a disabled plugin", async () => {
  const port = createFakeContentAnalysisPort({ statusError: new Error("Status connection lost") });
  render(<ContentAnalysisCard {...TARGET} useContentAnalysisHook={(props) => useContentAnalysis(props, { port, locale: "en", useFetchQuery, useFetchMutation })} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Status connection lost");
  expect(screen.getByRole("region", { name: "Content analysis" })).toBeInTheDocument();
});

it("keeps stored results after a preview refusal and sends the unchanged draft on retry", async () => {
  const previewError = Object.assign(new Error("internal analyzer trace"), { status: 422, code: "PLUGIN_HOOK_FAILED" });
  const port = createFakeContentAnalysisPort({ previewError });
  const user = userEvent.setup();
  render(<ContentAnalysisCard {...TARGET} useContentAnalysisHook={(props) => useContentAnalysis(props, { port, locale: "en", useFetchQuery, useFetchMutation })} />);
  const analyze = await screen.findByRole("button", { name: "Analyze now" });
  await user.click(analyze);
  expect(await screen.findByRole("alert")).toHaveTextContent("The analyzer could not process this content.");
  expect(screen.getByText("From the last save.")).toBeInTheDocument();
  expect(screen.getByText("84")).toBeInTheDocument();

  port.setPreviewError({ error: null });
  await user.click(screen.getByRole("button", { name: "Analyze now" }));
  // A run without report data means unavailable, not a previously-analyzed draft.
  expect(await screen.findByText("Analysis unavailable.")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(port.previewCalls).toEqual([
    { pluginId: "content-analyzer", body: { postId: "p1", title: "Draft", bodyJson: { type: "doc", content: [] } } },
    { pluginId: "content-analyzer", body: { postId: "p1", title: "Draft", bodyJson: { type: "doc", content: [] } } },
  ]);
});

it("removes the previously visible analyzer after the injected status reports it is off", async () => {
  const configuration = { enabled: true };
  const port = createFakeContentAnalysisPort(configuration);
  const status = vi.fn(port.previewStatus);
  const observedPort = { ...port, previewStatus: status };
  function CardWithRefresh() {
    const invalidate = useInvalidate();
    return <>
      <button type="button" onClick={() => invalidate({ key: ["content-analysis", "preview-status"] })}>Refresh plugin status</button>
      <ContentAnalysisCard {...TARGET} useContentAnalysisHook={(props) => useContentAnalysis(props, {
        port: observedPort, locale: "en", useFetchQuery, useFetchMutation,
      })} />
    </>;
  }
  render(<CardWithRefresh />);
  expect(await screen.findByRole("button", { name: "Analyze now" })).toBeInTheDocument();
  configuration.enabled = false;
  await userEvent.click(screen.getByRole("button", { name: "Refresh plugin status" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Content analysis" })).not.toBeInTheDocument());
  expect(status.mock.calls).toEqual([[{ pluginId: "content-analyzer" }], [{ pluginId: "content-analyzer" }]]);
});

it("deduplicates a same-tick preview and never replaces analysis saved while that preview was running", async () => {
  let release!: () => void;
  const previewGate = new Promise<void>(resolve => { release = resolve; });
  const port = createFakeContentAnalysisPort({ previewGate, previewFields: { report: reportJson({ score: 61 }) } });
  const dependencies = { port, locale: "en", useFetchQuery, useFetchMutation };
  const newer: ContentAnalysisTarget = {
    ...TARGET, title: "Saved during preview",
    post: { ...TARGET.post, version: 2, ext: { "content-analyzer": { report: reportJson({ score: 92 }) } } },
  };
  const { result, rerender } = renderHook((target: ContentAnalysisTarget) => useContentAnalysis(target, dependencies), { initialProps: TARGET });
  await waitFor(() => expect(result.current.hidden).toBe(false));
  let first!: Promise<void>;
  let duplicate!: Promise<void>;
  act(() => { first = result.current.analyze(); duplicate = result.current.analyze(); });
  await waitFor(() => expect(result.current.analyzing).toBe(true));
  await waitFor(() => expect(port.previewCalls).toEqual([
    { pluginId: "content-analyzer", body: { postId: "p1", title: "Draft", bodyJson: { type: "doc", content: [] } } },
  ]));
  rerender(newer);
  await act(async () => { release(); await Promise.all([first, duplicate]); });
  expect(result.current.view.lead).toBe("From the last save.");
  expect(result.current.view.report?.stats.find(stat => stat.key === "score")?.value).toBe("92");

  await act(async () => { await result.current.analyze(); });
  expect(result.current.view.lead).toBe("From your current draft, including unsaved changes.");
  expect(result.current.view.report?.stats.find(stat => stat.key === "score")?.value).toBe("61");
  expect(port.previewCalls.map(call => call.body.title)).toEqual(["Draft", "Saved during preview"]);
});
