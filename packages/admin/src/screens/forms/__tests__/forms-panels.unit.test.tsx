// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FormEditor, FormsList, type FormsModulePanelHook } from "../index.js";

afterEach(cleanup);

function ModuleLoading({ editor }: { editor?: boolean }) {
  return <p role="status">{editor ? "Loading form editor" : "Loading forms list"}</p>;
}

function mountPanel() {
  return vi.fn<FormsModulePanelHook>((props, options) => ({
    content: <section aria-label={props.pageId}>{options.loadingContent}</section>,
  }));
}

it("mounts the Forms list on its own module route and forwards the host's list content", () => {
  const useModulePanel = mountPanel();
  render(<FormsList useModulePanel={useModulePanel} ModuleLoading={ModuleLoading} />);
  const [target] = useModulePanel.mock.calls[0]!;
  expect(useModulePanel).toHaveBeenCalledTimes(1);
  expect(target).toEqual({ moduleId: "forms", pageId: "list", route: { view: null, params: {}, query: expect.any(URLSearchParams) } });
  expect([...target.route.query]).toEqual([]);
  expect(screen.getByRole("region", { name: "list" }).textContent).toBe("Loading forms list");
});

it("switches the editor query tab without changing the mounted form identity", () => {
  const useModulePanel = mountPanel();
  const props = { formId: "forms/feedback-2026", useModulePanel, ModuleLoading };
  const { rerender } = render(<FormEditor {...props} tab="fields" />);
  expect(screen.getByRole("region", { name: "editor" }).textContent).toBe("Loading form editor");
  rerender(<FormEditor {...props} tab="submissions" />);
  expect(useModulePanel).toHaveBeenCalledTimes(2);
  expect(useModulePanel.mock.calls.map(([{ route, ...target }]) => ({
    ...target, route: { ...route, query: [...route.query] },
  }))).toEqual([
    { moduleId: "forms", pageId: "editor", params: { formId: "forms/feedback-2026" }, route: { view: null, params: { formId: "forms/feedback-2026" }, query: [["tab", "fields"]] } },
    { moduleId: "forms", pageId: "editor", params: { formId: "forms/feedback-2026" }, route: { view: null, params: { formId: "forms/feedback-2026" }, query: [["tab", "submissions"]] } },
  ]);
  expect(screen.getByRole("region", { name: "editor" }).textContent).toBe("Loading form editor");
});
