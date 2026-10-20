import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminFormSubmission } from "../../models.js";
import type { FormAnswerColumn } from "../../html-rules.js";
import type { FormSubmissionsController } from "../hooks/use-form-submissions.hooks.js";
import { FormSubmissions } from "../components/FormSubmissions.js";
import { FormsTestProvider } from "./harness.js";

/**
 * @file `FormSubmissions` against a typed fake controller (its `useFormSubmissionsHook` seam): the
 * error, loading and empty states, the list with its View buttons and answer columns, "Load more",
 * and the hand-off to `FormSubmissionDetail` once a submission is selected.
 */

const t = (key: string) => key;

function submission(id: string): AdminFormSubmission {
  return { id, formDefinitionId: "f1", data: { topic: `t-${id}` }, sourceIp: `10.0.0.${id}`, submittedAt: "2026-01-02T03:04:05Z" };
}

function controller(overrides: Partial<FormSubmissionsController> = {}): FormSubmissionsController {
  return { submissions: [submission("1"), submission("2")], nextCursor: null, error: null, selectedId: null, setSelectedId: vi.fn(), load: vi.fn(), loadingMore: false, ...overrides };
}

function renderWith(c: FormSubmissionsController, extra: { answerColumns?: FormAnswerColumn[] } = {}) {
  return render(<FormsTestProvider><FormSubmissions formId="f1" t={t} useFormSubmissionsHook={() => c} {...extra} /></FormsTestProvider>);
}

afterEach(() => vi.unstubAllGlobals());

describe("FormSubmissions states", () => {
  it("shows the load error alone when nothing has loaded", () => {
    const { container } = renderWith(controller({ submissions: null, error: "Could not load submissions." }));
    expect(container.querySelector(".notice.error")?.textContent).toBe("Could not load submissions.");
    expect(container.querySelector("table")).toBeNull();
  });

  it("shows a loading notice before the first page settles", () => {
    renderWith(controller({ submissions: null }));
    expect(screen.getByText("Loading submissions…")).not.toBeNull();
  });

  it("shows the empty state for a form with no submissions", () => {
    renderWith(controller({ submissions: [] }));
    expect(screen.getByText("No submissions yet.")).not.toBeNull();
  });

  it("keeps the list and shows the error above it when a later load fails", () => {
    const { container } = renderWith(controller({ error: "Could not load more." }));
    expect(container.querySelector(".notice.error")?.textContent).toBe("Could not load more.");
    expect(screen.getByText("10.0.0.1")).not.toBeNull();
  });

  it("hands off to the submission detail once one is selected", () => {
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    renderWith(controller({ selectedId: "1" }));
    expect(screen.getByText("Loading submission…")).not.toBeNull();
    expect(screen.queryByText("10.0.0.1")).toBeNull();
  });
});

describe("FormSubmissions list", () => {
  it("renders the default columns plus the supplied answer columns", () => {
    renderWith(controller(), { answerColumns: [{ key: "topic", header: "Topic", cell: (s) => String(s.data.topic) }] });
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Submitted at", "Source IP", "Topic", ""]);
    expect(screen.getByText("t-2")).not.toBeNull();
  });

  it("selects a submission from its View button", () => {
    const c = controller();
    renderWith(c);
    fireEvent.click(screen.getAllByRole("button", { name: "View" })[1]!);
    expect(c.setSelectedId).toHaveBeenCalledWith("2");
  });

  it("hides Load more when there is no next page", () => {
    renderWith(controller());
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("loads the next page from Load more", () => {
    const c = controller({ nextCursor: "c2" });
    renderWith(c);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(c.load).toHaveBeenCalledWith("c2");
  });

  it("disables Load more and relabels it while the page is in flight", () => {
    renderWith(controller({ nextCursor: "c2", loadingMore: true }));
    expect((screen.getByRole("button", { name: "Loading…" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
