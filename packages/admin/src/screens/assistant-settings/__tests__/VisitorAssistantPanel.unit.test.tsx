// @vitest-environment jsdom
import userEvent from "@testing-library/user-event";
import { render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { InfoTipProps } from "../../../react/kit.js";
import { createVisitorMoreInfo, VisitorAssistantPanel } from "../VisitorAssistantPanel.js";
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

it("keeps the enabled assistant switch usable for turning off without a key and sends widget choices separately", async () => {
  const user = userEvent.setup();
  const setPublicEnabled = vi.fn(async () => {});
  const setWidget = vi.fn(async () => {});
  const props = {
    controller: { ...controller(true), settings: { publicEnabled: true, widget: "react" as const }, setPublicEnabled, setWidget, saveError: "Previous update timed out" },
    CredentialForm: () => null, t: (key: string) => key, InfoTip, useVisitorAssistantPanelHook: useVisitorAssistantPanel,
    useVisitorCredentialFormHook: () => credential(),
  };
  const { rerender } = render(<VisitorAssistantPanel {...props} />);
  expect(screen.getByRole("status")).toHaveTextContent("Needs a key");
  expect(screen.getByText("Previous update timed out")).toBeVisible();
  const enable = screen.getByRole("switch", { name: "Enable the AI assistant on the public site" });
  expect(enable).toBeChecked();
  await user.click(enable);
  expect(setPublicEnabled.mock.calls).toEqual([[{ publicEnabled: false }]]);
  await user.selectOptions(screen.getByRole("combobox", { name: "Widget" }), "vanilla");
  expect(setWidget.mock.calls).toEqual([[{ widget: "vanilla" }]]);

  rerender(<VisitorAssistantPanel {...props}
    controller={{ ...props.controller, settings: { publicEnabled: false, widget: "vanilla" }, saving: true }}
    useVisitorCredentialFormHook={() => credential({ hasStoredKey: true })} />);
  expect(screen.getByRole("status")).toHaveTextContent("Visitors see no assistant.");
  expect(enable).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "Widget" })).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "Widget" })).toHaveValue("vanilla");
});

it("interpolates the translated more-info label with literal widget names", () => {
  const moreInfo = createVisitorMoreInfo({ t: (key) => key === "More info: {name}" ? "{name} — mehr Informationen" : key });
  expect(moreInfo("Widget $&")).toBe("Widget $& — mehr Informationen");
  const setWidget = vi.fn(async () => {});
  const { result } = renderHook(() => useVisitorAssistantPanel({ settings: { publicEnabled: true }, hasStoredKey: true, setWidget }));
  const panel = result.current;
  expect(panel.status).toBe("on");
  panel.chooseWidget({ value: "unknown" });
  expect(setWidget.mock.calls).toEqual([[{ widget: "react" }]]);
});
