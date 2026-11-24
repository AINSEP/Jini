// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { formatUserFacingError } from "@jini-ai/core";
import { createFailureChannel, ErrorNotice as UiErrorNotice } from "@jini-ai/ui/panel-kit";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { AdminKitProvider, type ErrorNoticeProps } from "../../../../react/kit.js";
import { fakeAdminKit } from "../../../../react/testing-kit.js";
import { AdminFailureNotice } from "../AdminFailureNotice.js";

const channel = createFailureChannel({}, {});

/** The real UI-library ErrorNotice in the kit slot; clipboard ports reach it through the host's kit binding. */
function renderWithKit(ui: ReactNode, { writeText }: { writeText?: (input: { text: string }) => Promise<void> } = {}) {
  const ErrorNotice = (props: ErrorNoticeProps) => <UiErrorNotice {...props} {...(writeText ? { clipboard: { writeText } } : {})} />;
  return render(<AdminKitProvider kit={fakeAdminKit({ components: { ErrorNotice } })}>{ui}</AdminKitProvider>);
}

afterEach(() => { channel.reset(); vi.restoreAllMocks(); });

it("dismisses an incident through the host's translated label", () => {
  const failure = formatUserFacingError({ message: "Pages could not be loaded.", action: "Try loading them again.", step: "Loading pages", cause: "offline" }, { errorId: "translated-incident" });
  channel.publish({ failure });
  renderWithKit(<AdminFailureNotice channel={channel} dismissLabel="Fehlermeldung schließen" />);
  fireEvent.click(screen.getByRole("button", { name: "Fehlermeldung schließen" }));
  expect(screen.queryByText(failure.message)).toBeNull();
  expect(channel.getSnapshot()).toBeNull();
});

it("retains a polite failure with copyable details until dismissed", async () => {
  const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"));
  renderWithKit(<AdminFailureNotice channel={channel} dismissLabel="Dismiss error" />, { writeText });
  expect(screen.queryByRole("status")).toBeNull();
  const failure = formatUserFacingError({ message: "Pages could not be loaded.", action: "Try loading them again.", step: "Loading pages", cause: "The error ID identifies the server report." }, { errorId: "incident-ui" });
  act(() => channel.publish({ failure }));
  expect(screen.getByRole("status")).toHaveTextContent(failure.message);
  fireEvent.click(screen.getByText("Show details"));
  fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith({ text: failure.copyText }));
  expect(await screen.findByText("Copy failed. Select the details and copy them manually.")).toBeVisible();
  expect(screen.getByText((_content, element) => element?.tagName === "PRE" && element.textContent === failure.copyText)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
  expect(screen.queryByText(failure.message)).toBeNull();
  expect(channel.getSnapshot()).toBeNull();
});

it("floats over the page and keeps Dismiss inside the notice card", () => {
  const failure = formatUserFacingError({ message: "The page save could not be completed.", action: "Check.", step: "Save page", cause: "x" }, { errorId: "incident-card" });
  channel.publish({ failure });
  const { container } = renderWithKit(<AdminFailureNotice channel={channel} dismissLabel="Dismiss error" />);
  const card = container.querySelector(".jini-admin-failure-notice");
  expect(card).not.toBeNull();
  expect(card?.contains(screen.getByRole("button", { name: "Dismiss error" }))).toBe(true);
  expect(card?.querySelector(".notice")?.contains(screen.getByRole("button", { name: "Dismiss error" }))).toBe(false);
});

it("passes the host's notice props through to the kit ErrorNotice", () => {
  const failure = formatUserFacingError({ message: "Menus could not be loaded.", action: "Retry.", step: "Load menus", cause: "x" }, { errorId: "incident-passthrough" });
  channel.publish({ failure });
  const { container } = renderWithKit(<AdminFailureNotice channel={channel} dismissLabel="Dismiss error" className="notice host-notice" />);
  expect(container.querySelector(".jini-admin-failure-notice > .host-notice")).toHaveTextContent(failure.message);
});
