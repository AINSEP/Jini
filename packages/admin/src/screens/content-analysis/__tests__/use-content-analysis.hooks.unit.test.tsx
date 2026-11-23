// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { AdminApiError } from "@jini-ai/core/admin-runtime";
import { act, renderHook, waitFor } from "../../../__tests__/fetch-query-support.js";
import { createFakeContentAnalysisPort } from "../hooks/content-analysis-dependencies.hooks.js";
import { useContentAnalysis, type ContentAnalysisTarget } from "../hooks/use-content-analysis.hooks.js";
import type { ContentAnalysisPort } from "../hooks/content-analysis-port.hooks.js";
import { CONTENT_ANALYZER_PLUGIN_ID } from "../rules.js";
import { VALID_REPORT_JSON, reportJson } from "./content-analysis-fixtures.js";

/**
 * @file `useContentAnalysis` — the Content analysis card's state: whether the plugin is on, the
 * stored-vs-fresh analysis it shows, and Analyze now. Driven through `createFakeContentAnalysisPort`;
 * the live routes belong to the host's port and are pinned by the host's own port test.
 */

/** A manually-resolved promise, for race tests — never a timer. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const STORED_EXT = { [CONTENT_ANALYZER_PLUGIN_ID]: { report: VALID_REPORT_JSON } };
const DOC = { type: "doc", content: [{ type: "paragraph" }] };

function target(overrides: Partial<ContentAnalysisTarget> = {}): ContentAnalysisTarget {
  return { post: { id: "p1", version: 1, ext: STORED_EXT }, title: "Draft title", bodyJson: DOC, ...overrides };
}

function mount(port: ContentAnalysisPort, initial: ContentAnalysisTarget = target(), locale = "en") {
  return renderHook((props: ContentAnalysisTarget) => useContentAnalysis(props, { port, locale }), { initialProps: initial });
}

describe("showing the card", () => {
  it("is hidden until the plugin's preview status loads, then shows the stored analysis", async () => {
    const port = createFakeContentAnalysisPort();
    const { result } = mount(port);
    expect(result.current.hidden).toBe(true);
    await waitFor(() => expect(result.current.hidden).toBe(false));
    expect(result.current.view.lead).toBe("From the last save.");
    expect(result.current.view.report?.stats[0]?.value).toBe("84");
    expect(result.current.analyzing).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("stays hidden when the content-analyzer plugin is disabled", async () => {
    const port = createFakeContentAnalysisPort({ enabled: false });
    const { result } = mount(port);
    await waitFor(() => expect(port.statusCalls).toBe(1));
    await act(async () => {});
    expect(result.current.hidden).toBe(true);
  });

  it("stays hidden when the content-analyzer plugin is not installed", async () => {
    const port = createFakeContentAnalysisPort({ statusError: new AdminApiError({ message: "plugin was not found", status: 404 }, { code: "PLUGIN_NOT_FOUND" }) });
    const { result } = mount(port);
    await waitFor(() => expect(port.statusCalls).toBe(1));
    await act(async () => {});
    expect(result.current.hidden).toBe(true);
  });

  it("shows the card with the reason when the status read is refused or fails, instead of looking switched off", async () => {
    const port = createFakeContentAnalysisPort({ statusError: new AdminApiError({ message: "You do not have permission to do that.", status: 403 }, { code: "FORBIDDEN" }) });
    const { result } = mount(port);
    await waitFor(() => expect(result.current.hidden).toBe(false));
    expect(result.current.error).toBe("You do not have permission to do that.");
    expect(port.statusCalls).toBe(1);
  });

  it("says the post is not analyzed yet when it carries no stored report", async () => {
    const port = createFakeContentAnalysisPort();
    const { result } = mount(port, target({ post: { id: "p1", version: 1 } }));
    await waitFor(() => expect(result.current.hidden).toBe(false));
    expect(result.current.view).toEqual({ lead: "Not analyzed yet. Save, or click Analyze now.", report: null });
  });

  it("binds its copy to the given locale", async () => {
    const port = createFakeContentAnalysisPort();
    const { result } = mount(port, target(), "es");
    await waitFor(() => expect(result.current.hidden).toBe(false));
    expect(result.current.t("Analyze now")).toBe("Analizar ahora");
    expect(result.current.view.lead).toBe("Del último guardado.");
  });
});

describe("Analyze now", () => {
  it("sends the editor's current, unsaved title and body to the plugin's preview and shows the fresh result", async () => {
    const gate = deferred<void>();
    const port = createFakeContentAnalysisPort({ previewFields: { report: reportJson({ score: 61 }) }, previewGate: gate.promise });
    const { result } = mount(port);
    await waitFor(() => expect(result.current.hidden).toBe(false));

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.analyze();
    });
    await waitFor(() => expect(result.current.analyzing).toBe(true));
    expect(port.previewCalls).toEqual([
      { pluginId: CONTENT_ANALYZER_PLUGIN_ID, body: { postId: "p1", title: "Draft title", bodyJson: DOC } },
    ]);

    await act(async () => {
      gate.resolve();
      await pending;
    });
    expect(result.current.analyzing).toBe(false);
    expect(result.current.view.lead).toBe("From your current draft, including unsaved changes.");
    expect(result.current.view.report?.stats[0]?.value).toBe("61");
  });

  it("shows an unreadable preview reply as analysis unavailable", async () => {
    // No `previewFields`: the fake answers `{}`, a reply with no `report` at all.
    const port = createFakeContentAnalysisPort();
    const { result } = mount(port);
    await waitFor(() => expect(result.current.hidden).toBe(false));
    await act(() => result.current.analyze());
    expect(result.current.view).toEqual({ lead: "Analysis unavailable.", report: null });
  });

  it("reports a refused preview with its own copy, then clears it on the next successful run", async () => {
    const port = createFakeContentAnalysisPort({
      previewFields: { report: VALID_REPORT_JSON },
      previewError: new AdminApiError({ message: "hook threw", status: 422 }, { code: "PLUGIN_HOOK_FAILED" }),
    });
    const { result } = mount(port);
    await waitFor(() => expect(result.current.hidden).toBe(false));
    await act(() => result.current.analyze());
    await waitFor(() => expect(result.current.error).toBe("The analyzer could not process this content."));
    expect(result.current.analyzing).toBe(false);
    expect(result.current.view.lead).toBe("From the last save.");

    port.setPreviewError({ error: null });
    await act(() => result.current.analyze());
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.view.lead).toBe("From your current draft, including unsaved changes.");
  });

  it("lets a save's refreshed stored analysis win over an earlier fresh result", async () => {
    const port = createFakeContentAnalysisPort({ previewFields: { report: reportJson({ score: 61 }) } });
    const { result, rerender } = mount(port);
    await waitFor(() => expect(result.current.hidden).toBe(false));
    await act(() => result.current.analyze());
    expect(result.current.view.report?.stats[0]?.value).toBe("61");

    rerender(target({ post: { id: "p1", version: 2, ext: { [CONTENT_ANALYZER_PLUGIN_ID]: { report: reportJson({ score: 77 }) } } } }));
    expect(result.current.view.lead).toBe("From the last save.");
    expect(result.current.view.report?.stats[0]?.value).toBe("77");
  });

  it("ignores a preview that was still in flight when a save landed", async () => {
    const gate = deferred<void>();
    const port = createFakeContentAnalysisPort({ previewFields: { report: reportJson({ score: 61 }) }, previewGate: gate.promise });
    const { result, rerender } = mount(port);
    await waitFor(() => expect(result.current.hidden).toBe(false));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.analyze();
    });
    rerender(target({ post: { id: "p1", version: 2, ext: STORED_EXT } }));
    await act(async () => {
      gate.resolve();
      await pending;
    });
    expect(result.current.view.lead).toBe("From the last save.");
    expect(result.current.view.report?.stats[0]?.value).toBe("84");
  });

  it("sends one preview for a double click, before the button's disabled state renders", async () => {
    const gate = deferred<void>();
    const port = createFakeContentAnalysisPort({ previewGate: gate.promise });
    const { result } = mount(port);
    await waitFor(() => expect(result.current.hidden).toBe(false));
    const { analyze } = result.current;
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = analyze();
      second = analyze();
    });
    await act(async () => {
      gate.resolve();
      await Promise.all([first, second]);
    });
    expect(port.previewCalls).toHaveLength(1);
    await act(async () => {
      await result.current.analyze();
    });
    expect(port.previewCalls, "a finished run frees the button for the next one").toHaveLength(2);
  });
});
