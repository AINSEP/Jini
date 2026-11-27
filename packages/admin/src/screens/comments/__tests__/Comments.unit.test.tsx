// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { Comments, type CommentsModulePanelHook } from "../index.js";

it("mounts the comments queue with an empty route and shows the host loading view until ready", () => {
  let ready = false;
  const useModulePanel = vi.fn<CommentsModulePanelHook>((_route, options) => ({
    content: ready ? <h1>Moderation queue</h1> : options.loadingContent,
  }));
  const ModuleLoading = () => <p role="status">Loading moderation</p>;
  const { rerender } = render(<Comments useModulePanel={useModulePanel} ModuleLoading={ModuleLoading} />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading moderation");
  const request = useModulePanel.mock.calls[0]![0];
  expect(request).toEqual({ moduleId: "comments", pageId: "queue", route: { view: null, params: {}, query: expect.any(URLSearchParams) } });
  expect([...request.route.query.entries()]).toEqual([]);

  ready = true;
  rerender(<Comments useModulePanel={useModulePanel} ModuleLoading={ModuleLoading} />);
  expect(screen.getByRole("heading", { name: "Moderation queue" })).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
