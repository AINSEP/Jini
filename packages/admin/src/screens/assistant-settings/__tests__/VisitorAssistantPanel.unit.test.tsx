// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { InfoTipProps } from "../../../react/kit.js";
import { VisitorAssistantPanel } from "../VisitorAssistantPanel.js";
import { useVisitorAssistantPanel } from "../use-visitor-assistant-panel.hooks.js";
import type { VisitorCredentialFormController } from "../visitor-credential-form-port.js";

function InfoTip({ label }: InfoTipProps) {
  return <span data-testid="tip">{label}</span>;
}

function controller(publicEnabled: boolean) {
  return { settings: { publicEnabled }, saving: false, saveError: null, setPublicEnabled: vi.fn(async () => {}), setWidget: vi.fn(async () => {}) };
}

function credential(overrides: Partial<VisitorCredentialFormController> = {}): VisitorCredentialFormController {
  return { loadState: { status: "ready" }, hasStoredKey: false, ...overrides } as VisitorCredentialFormController;
}

describe("VisitorAssistantPanel", () => {
  it("renders the pill and steps with jini classes and hands the ONE credential controller to the form", () => {
    const cred = credential();
    const seen: VisitorCredentialFormController[] = [];
    const CredentialForm = ({ useVisitorCredentialFormHook }: { useVisitorCredentialFormHook: () => VisitorCredentialFormController }) => {
      seen.push(useVisitorCredentialFormHook());
      return <p>form</p>;
    };
    const { container } = render(<VisitorAssistantPanel controller={controller(false)} CredentialForm={CredentialForm} t={(k) => k}
      InfoTip={InfoTip} useVisitorCredentialFormHook={() => cred} useVisitorAssistantPanelHook={useVisitorAssistantPanel} />);
    expect(seen[0]).toBe(cred);
    expect(container.querySelector(".jini-visitor-pill.jini-visitor-pill--needs-key")?.textContent).toBe("Needs a key");
    expect(container.querySelectorAll("li.jini-visitor-step")).toHaveLength(3);
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getAllByText("Save a key in step 1 first.").some((el) => el.matches("p.jini-visitor-step-hint"))).toBe(true);
  });

  it("shows the load states instead of the steps", () => {
    const props = { controller: controller(true), CredentialForm: () => null, t: (k: string) => k, InfoTip, useVisitorAssistantPanelHook: useVisitorAssistantPanel };
    const { rerender } = render(<VisitorAssistantPanel {...props} useVisitorCredentialFormHook={() => credential({ loadState: { status: "loading" } })} />);
    expect(screen.getByRole("status").textContent).toBe("Loading saved settings…");
    rerender(<VisitorAssistantPanel {...props} useVisitorCredentialFormHook={() => credential({ loadState: { status: "error", message: "boom" } })} />);
    expect(screen.getByRole("alert").textContent).toBe("boom");
  });
});
