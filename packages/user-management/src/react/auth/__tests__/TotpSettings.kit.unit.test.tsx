import { forwardRef } from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fakeUmKit, renderWithUmKit } from "../../__tests__/fake-um-kit.js";
import { UserManagementKitMissingError, type SecretInputProps } from "../../kit.js";
import { TotpSettings, type TotpSettingsPort } from "../TotpSettings.js";

const translate = (key: string) => key;
const portWith = (status: TotpSettingsPort["status"]): TotpSettingsPort => ({ status, enroll: vi.fn(), confirm: vi.fn(), remove: vi.fn() });
const ownerStatus = (enrolled = false) => vi.fn().mockResolvedValue({ isOwner: true, available: true, enrolled });

/** Loading, error and loaded states of the authenticator card, rendered through the fake kit. */
describe("TotpSettings through the user-management kit", () => {
  it("renders nothing while the status read is pending", () => {
    const { container } = renderWithUmKit(<TotpSettings port={portWith(() => new Promise(() => {}))} translate={translate} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("explains in plain words when the status cannot be read", async () => {
    const { findByRole } = renderWithUmKit(<TotpSettings port={portWith(vi.fn().mockRejectedValue(new Error("down")))} translate={translate} />);
    expect(await findByRole("alert")).toHaveTextContent("Authenticator settings could not load. Reload this page to try again.");
  });

  it("renders nothing for staff", async () => {
    const status = vi.fn().mockResolvedValue({ isOwner: false, available: true, enrolled: false });
    const { container } = renderWithUmKit(<TotpSettings port={portWith(status)} translate={translate} />);
    await waitFor(() => expect(status).toHaveBeenCalledOnce());
    expect(container.querySelector('[data-um-kit="SecretInput"]')).toBeNull();
  });

  it("renders the owner password through the SecretInput slot, with the autofill hint and the private marker", async () => {
    const seen: SecretInputProps[] = [];
    const Capture = forwardRef<HTMLInputElement, Omit<SecretInputProps, "ref">>(function Capture(props, ref) { seen.push(props); return <input ref={ref} data-um-kit="SecretInput" />; });
    const { findByText } = renderWithUmKit(<TotpSettings port={portWith(ownerStatus())} translate={translate} />, { kit: fakeUmKit({ components: { SecretInput: Capture } }) });
    expect(await findByText("Set up authenticator")).toBeInTheDocument();
    expect(seen.at(-1)).toMatchObject({ label: "Current owner password", autoComplete: "current-password", "data-agent-private": "" });
  });

  it("renders the fake's tagged element for the enrolled owner", async () => {
    const { findByText, container } = renderWithUmKit(<TotpSettings port={portWith(ownerStatus(true))} translate={translate} />);
    expect(await findByText("Replace authenticator")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-um-kit="SecretInput"]')).toHaveLength(1);
  });

  it("throws the typed missing-provider error when no kit is mounted", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // The slot is only reached once the status resolves; the failure surfaces from that render.
      const failures: unknown[] = [];
      const onError = (event: ErrorEvent) => { failures.push(event.error); event.preventDefault(); };
      window.addEventListener("error", onError);
      try {
        render(<TotpSettings port={portWith(ownerStatus())} translate={translate} />);
        await waitFor(() => expect(failures.some((e) => e instanceof UserManagementKitMissingError)).toBe(true));
      } finally { window.removeEventListener("error", onError); }
    } finally { quiet.mockRestore(); }
  });
});
