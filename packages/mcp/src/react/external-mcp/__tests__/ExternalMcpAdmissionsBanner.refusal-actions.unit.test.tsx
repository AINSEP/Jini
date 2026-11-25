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
