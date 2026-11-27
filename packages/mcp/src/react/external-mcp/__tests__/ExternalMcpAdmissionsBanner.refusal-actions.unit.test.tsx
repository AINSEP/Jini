// @vitest-environment jsdom
import { fireEvent, render, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ExternalMcpAdmissionsBanner, type ExternalMcpAdmissionsBannerProps } from "../ExternalMcpAdmissionsBanner.js";

afterEach(cleanup);

it("requests grants only for named write-refusal rows and removal only for missing launchers", () => {
  const onAllowWrite = vi.fn();
  const onRequestRemove = vi.fn();
  const controller: ExternalMcpAdmissionsBannerProps["controller"] = { loading: false, waitingForAssistant: false, unavailable: null, connections: [{ connectionId: "server", notLoaded: [], liveToolCount: 0, savedToolCount: 0, entries: [
    { connectionId: "server", remoteName: null, kind: "needs-write-grant", messageKey: "connection", messageVars: {} },
    { connectionId: "server", remoteName: "write", kind: "needs-write-grant", messageKey: "write", messageVars: {} },
    { connectionId: "server", remoteName: null, kind: "missing-launcher", messageKey: "launcher", messageVars: {} },
    { connectionId: "server", remoteName: "refused", kind: "refused", messageKey: "refused", messageVars: {} },
  ] }], restartHelps: true, canRestart: false, restarting: false, restartError: null, restartAccepted: false, restart: vi.fn() };
  const view = render(<ExternalMcpAdmissionsBanner controller={controller} t={key => key} onAllowWrite={onAllowWrite} onRequestRemove={onRequestRemove} describeHeadline={() => "drift"} />);
  expect(view.getAllByRole("checkbox")).toHaveLength(1);
  fireEvent.click(view.getByRole("checkbox"));
  expect(onAllowWrite).toHaveBeenCalledExactlyOnceWith("server", "write");
  fireEvent.click(view.getByRole("button", { name: "Remove" }));
  expect(onRequestRemove).toHaveBeenCalledExactlyOnceWith("server");
  expect(view.queryByRole("button", { name: "Restart the assistant" })).toBeNull();
});

it("lists missing tools and distinguishes restart in progress from a refusal", () => {
  const restart = vi.fn();
  const controller: ExternalMcpAdmissionsBannerProps["controller"] = {
    loading: false, waitingForAssistant: false, unavailable: null,
    connections: [{ connectionId: "archive", notLoaded: ["write", "delete"], liveToolCount: 1, savedToolCount: 3, entries: [] }],
    restartHelps: true, canRestart: true, restarting: false, restartError: null, restartAccepted: false, restart,
  };
  const banner = (state: typeof controller) => <ExternalMcpAdmissionsBanner controller={state} t={key => key}
    onAllowWrite={vi.fn()} onRequestRemove={vi.fn()} describeHeadline={() => "Saved tools differ"} />;
  const view = render(banner(controller));
  expect(view.getByRole("heading", { name: "archive" }).textContent).toBe("archive");
  expect(view.getByText("Live now: 1 tools. Saved: 3 tools — write, delete are not loaded.").textContent)
    .toBe("Live now: 1 tools. Saved: 3 tools — write, delete are not loaded.");
  expect(view.getByText("This ends any conversation in progress.").textContent).toBe("This ends any conversation in progress.");
  fireEvent.click(view.getByRole("button", { name: "Restart the assistant" }));
  expect(restart).toHaveBeenCalledExactlyOnceWith();
  view.rerender(banner({ ...controller, restarting: true, restartAccepted: true }));
  expect(view.getByRole("button", { name: "Restart the assistant" })).toHaveProperty("disabled", true);
  expect(view.getByRole("status").textContent).toBe("Restarting…");
  view.rerender(banner({ ...controller, restartError: "Another restart is in progress." }));
  expect(view.getByRole("alert").textContent).toBe("Another restart is in progress.");
  expect(view.queryByRole("status")).toBeNull();
});

it("shows recovery status while the assistant starts or cannot report admissions", () => {
  const controller: ExternalMcpAdmissionsBannerProps["controller"] = {
    loading: true, waitingForAssistant: false, unavailable: null, connections: [],
    restartHelps: false, canRestart: false, restarting: false, restartError: null, restartAccepted: false, restart: vi.fn(),
  };
  const banner = (state: typeof controller) => <ExternalMcpAdmissionsBanner controller={state} t={key => key}
    onAllowWrite={vi.fn()} onRequestRemove={vi.fn()} describeHeadline={() => "Saved tools differ"} />;
  const view = render(banner(controller));
  expect(view.queryByRole("status")).toBeNull();
  view.rerender(banner({ ...controller, loading: false, waitingForAssistant: true }));
  expect(view.getByRole("status").textContent).toBe("The assistant is starting. This list updates on its own when it's ready.");
  view.rerender(banner({ ...controller, loading: false, unavailable: "Assistant unavailable." }));
  expect(view.getByRole("status").textContent).toBe("Assistant unavailable.");
  expect(view.queryByRole("button", { name: "Restart the assistant" })).toBeNull();
});
