import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PageExternalChangeBanner } from "../PageExternalChangeBanner.js";

it("translates the supplied message, preserves the handles, and keeps both actions independent", () => {
  const t = vi.fn((key: string) => `translated:${key}`);
  const onLoadLatest = vi.fn();
  const onKeepEdits = vi.fn();
  const { container } = render(<PageExternalChangeBanner
    t={t}
    onLoadLatest={onLoadLatest}
    onKeepEdits={onKeepEdits}
    agentHandle={({ handle }) => ({ "data-agent-element": handle })}
    copy={{ messageKey: "host message", regionAgentLabel: "region", loadLatestAgentLabel: "load", keepEditsAgentLabel: "keep" }}
  />);
  expect(screen.getByText("translated:host message")).toBeInTheDocument();
  expect(t).toHaveBeenCalledWith("host message");
  for (const handle of ["page-external-change", "page-external-change-load-latest", "page-external-change-keep-edits"]) {
    expect(container.querySelector(`[data-agent-element="${handle}"]`)).not.toBeNull();
  }
  fireEvent.click(screen.getByRole("button", { name: "translated:Keep my edits" }));
  expect(onKeepEdits).toHaveBeenCalledTimes(1);
  expect(onLoadLatest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "translated:Load latest" }));
  expect(onLoadLatest).toHaveBeenCalledTimes(1);
  expect(onKeepEdits).toHaveBeenCalledTimes(1);
});
