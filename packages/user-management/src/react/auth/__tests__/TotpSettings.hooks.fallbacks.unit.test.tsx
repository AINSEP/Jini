import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TotpSettingsPort } from "../TotpSettings.js";
import { useTotpSettingsForm } from "../TotpSettings.hooks.js";

const t = (key: string) => `T:${key}`;

/** A port whose actions reject with a non-Error value, as a broken transport can. */
function rejectingPort(overrides: Partial<TotpSettingsPort> = {}): TotpSettingsPort {
  return {
    status: async () => ({ isOwner: true, available: true, enrolled: false }),
    enroll: vi.fn(async () => { throw "offline"; }),
    confirm: vi.fn(async () => { throw "offline"; }),
    remove: vi.fn(async () => { throw "offline"; }),
    ...overrides,
  };
}

/** Real forms, so each action receives a real submit event. */
function Harness({ port, initialEnrolled }: { port: TotpSettingsPort; initialEnrolled: boolean }) {
  const form = useTotpSettingsForm({ port, initialEnrolled, t });
  return (
    <>
      <form aria-label="enroll" onSubmit={form.enroll}><input aria-label="code" value={form.code} onChange={(e) => form.setCode(e.target.value)} /></form>
      <form aria-label="confirm" onSubmit={form.confirm} />
      <button type="button" onClick={() => void form.remove()}>remove</button>
      <output>{form.error}</output>
      <span data-testid="setup">{form.setup?.pendingToken ?? "none"}</span>
    </>
  );
}

const submit = async (name: string) => { await act(async () => { fireEvent.submit(screen.getByRole("form", { name })); }); };

describe("useTotpSettingsForm fallback messages", () => {
  it("explains a setup that failed without an Error", async () => {
    render(<Harness port={rejectingPort()} initialEnrolled={false} />);
    await submit("enroll");
    expect(screen.getByRole("status")).toHaveTextContent("T:Authenticator setup could not start. Try again.");
  });

  it("explains a confirmation that failed without an Error, and confirms nothing before setup", async () => {
    const port = rejectingPort({ enroll: vi.fn(async () => ({ pendingToken: "pending-1", secret: "s", uri: "otpauth://x" })) });
    render(<Harness port={port} initialEnrolled={true} />);
    await submit("confirm");
    expect(port.confirm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("code"), { target: { value: "123456" } });
    await submit("enroll");
    // An enrolled owner re-enrolls with their current code.
    expect(port.enroll).toHaveBeenCalledWith({ password: "", code: "123456" });
    expect(screen.getByTestId("setup")).toHaveTextContent("pending-1");
    await submit("confirm");
    expect(port.confirm).toHaveBeenCalledWith({ pendingToken: "pending-1", code: "" });
    expect(screen.getByRole("status")).toHaveTextContent("T:The code was not accepted. Enter a fresh authenticator code.");
  });

  it("shows the port's own Error message for each failed action", async () => {
    const port = rejectingPort({
      enroll: vi.fn(async () => { throw new Error("enroll refused"); }),
      remove: vi.fn(async () => { throw new Error("remove refused"); }),
    });
    render(<Harness port={port} initialEnrolled={false} />);
    await submit("enroll");
    expect(screen.getByRole("status")).toHaveTextContent("enroll refused");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "remove" })); });
    expect(screen.getByRole("status")).toHaveTextContent("remove refused");
  });

  it("shows a confirmation Error message as given", async () => {
    const port = rejectingPort({ enroll: vi.fn(async () => ({ pendingToken: "pending-2", secret: "s", uri: "otpauth://x" })),
      confirm: vi.fn(async () => { throw new Error("code expired"); }) });
    render(<Harness port={port} initialEnrolled={false} />);
    await submit("enroll");
    expect(port.enroll).toHaveBeenCalledWith({ password: "" });
    await submit("confirm");
    expect(screen.getByRole("status")).toHaveTextContent("code expired");
  });

  it("explains a removal that failed without an Error", async () => {
    render(<Harness port={rejectingPort()} initialEnrolled={true} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "remove" })); });
    expect(screen.getByRole("status")).toHaveTextContent("T:The authenticator could not be removed. Check your password and code.");
  });
});
