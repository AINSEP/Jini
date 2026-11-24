// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ProcessRestartController as AssistantDaemonRestartController } from "../../../react/hooks/use-process-restart.js";
import { AssistantDaemonRestart as RealAssistantDaemonRestart, assistantDaemonStatusMessage } from "../AssistantDaemonRestart.js";

/**
 * @file First test for `AssistantDaemonRestart` (the "Admin AI Assistant" tab's manual daemon
 * restart control). Mirrors `AdminExecutionMode.unit.test.tsx`'s "renders from the injected fake,
 * not a real round trip" shape: `useAssistantDaemonRestartHook` is the DI seam every assertion
 * below drives directly, so no test here depends on a real `fetch`. `useRestartAllowedHook` is the
 * host's execution-policy verdict.
 */

// Existing restart scenarios describe a local host; keep deployment discovery injectable.
type Props = ComponentProps<typeof RealAssistantDaemonRestart>;
function AssistantDaemonRestart(props: Partial<Props> & Pick<Props, "useAssistantDaemonRestartHook">) {
  return <RealAssistantDaemonRestart t={(key) => key} description="The Local CLI mode above runs as its own process."
    useRestartAllowedHook={() => true} {...props} />;
}

function fakeController(overrides: Partial<AssistantDaemonRestartController> = {}): AssistantDaemonRestartController {
  return {
    restarting: false,
    restartResult: null,
    restartError: null,
    checkingStatus: false,
    knownFailed: null,
    statusError: null,
    restart: vi.fn(async () => {}),
    checkStatus: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("AssistantDaemonRestart — rendering from the injected controller", () => {
  it("renders the idle state with both controls enabled and the host's explainer copy", () => {
    render(<AssistantDaemonRestart useAssistantDaemonRestartHook={() => fakeController()} />);
    expect(screen.getByRole("button", { name: "Restart assistant" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Check status" })).toBeEnabled();
    expect(screen.getByText("The Local CLI mode above runs as its own process.")).toHaveClass("jini-assistant-muted");
  });

  it("shows 'Restarting…' and disables the restart button while a restart is in flight", () => {
    render(<AssistantDaemonRestart useAssistantDaemonRestartHook={() => fakeController({ restarting: true })} />);
    expect(screen.getByRole("button", { name: "Restarting…" })).toBeDisabled();
  });

  it("an accepted restart shows the 'accepted' line, never claiming the daemon is healthy", () => {
    render(
      <AssistantDaemonRestart useAssistantDaemonRestartHook={() => fakeController({ restartResult: { ok: true } })} />,
    );
    expect(screen.getByText(/Restart accepted\. This does not confirm the process is healthy yet/)).toHaveClass("jini-assistant-save-line");
    expect(screen.queryByText(/restarted successfully/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/is now healthy/i)).not.toBeInTheDocument();
  });

  it("a refused restart shows the server's own reason verbatim", () => {
    render(
      <AssistantDaemonRestart
        useAssistantDaemonRestartHook={() => fakeController({ restartResult: { ok: false, reason: "shutting down" } })}
      />,
    );
    expect(screen.getByText("Restart refused: shutting down")).toBeInTheDocument();
  });

  it("a refused restart with no reason still says it was refused, with nothing after the colon", () => {
    render(<AssistantDaemonRestart useAssistantDaemonRestartHook={() => fakeController({ restartResult: { ok: false } })} />);
    expect(screen.getByRole("status")).toHaveTextContent(/^Restart refused:\s*$/);
  });

  it("an unexpected restart error renders in the error slot, not the ordinary result line", () => {
    render(
      <AssistantDaemonRestart useAssistantDaemonRestartHook={() => fakeController({ restartError: "forbidden" })} />,
    );
    expect(screen.getByText("forbidden")).toHaveClass("jini-save-error");
    expect(screen.queryByText(/Restart accepted/)).not.toBeInTheDocument();
  });

  it("shows the known-failed status line distinctly from the no-failure line", () => {
    const { rerender } = render(
      <AssistantDaemonRestart useAssistantDaemonRestartHook={() => fakeController({ knownFailed: true })} />,
    );
    expect(screen.getByText("Known failed — the last attempt to start it did not succeed.")).toBeInTheDocument();

    rerender(<AssistantDaemonRestart useAssistantDaemonRestartHook={() => fakeController({ knownFailed: false })} />);
    expect(screen.getByText("No known failure right now.")).toBeInTheDocument();
  });

  it("translates its own copy through the injected t", () => {
    render(<AssistantDaemonRestart t={(key) => `«${key}»`} useAssistantDaemonRestartHook={() => fakeController()} />);
    expect(screen.getByRole("heading", { name: "«Local CLI process»" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "«Restart assistant»" })).toBeInTheDocument();
  });
});

describe("AssistantDaemonRestart — user interaction", () => {
  it("pressing 'Restart assistant' calls the controller's restart()", async () => {
    const restart = vi.fn(async () => {});
    render(<AssistantDaemonRestart useAssistantDaemonRestartHook={() => fakeController({ restart })} />);

    await userEvent.click(screen.getByRole("button", { name: "Restart assistant" }));
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("pressing 'Check status' calls the controller's checkStatus()", async () => {
    const checkStatus = vi.fn(async () => {});
    render(<AssistantDaemonRestart useAssistantDaemonRestartHook={() => fakeController({ checkStatus })} />);

    await userEvent.click(screen.getByRole("button", { name: "Check status" }));
    expect(checkStatus).toHaveBeenCalledTimes(1);
  });
});

describe("AssistantDaemonRestart — restart gating", () => {
  it("renders nothing at all when the host's policy does not allow a Local CLI", () => {
    const restart = vi.fn(async () => {});
    const { container } = render(<AssistantDaemonRestart useRestartAllowedHook={() => false}
      useAssistantDaemonRestartHook={() => fakeController({ restart })} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Local CLI process")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restart assistant" })).not.toBeInTheDocument();
    expect(restart).not.toHaveBeenCalled();
  });
});

describe("assistantDaemonStatusMessage", () => {
  it("prioritizes statusError over every other state", () => {
    expect(
      assistantDaemonStatusMessage({ knownFailed: true, checkingStatus: true, statusError: "network down" }),
    ).toBe("network down");
  });

  it("shows the checking line only before the first result (knownFailed still null)", () => {
    expect(assistantDaemonStatusMessage({ knownFailed: null, checkingStatus: true, statusError: null })).toBe(
      "Checking status…",
    );
  });

  it("keeps showing the last known result during a RE-check (checkingStatus true, knownFailed already settled), instead of flashing back to 'Checking…'", () => {
    expect(assistantDaemonStatusMessage({ knownFailed: false, checkingStatus: true, statusError: null })).toBe(
      "No known failure right now.",
    );
  });

  it("returns null before the first check has even started (nothing loading, nothing known, no error)", () => {
    expect(assistantDaemonStatusMessage({ knownFailed: null, checkingStatus: false, statusError: null })).toBeNull();
  });
});
