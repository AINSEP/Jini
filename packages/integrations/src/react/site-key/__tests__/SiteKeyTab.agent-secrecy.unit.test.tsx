// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AGENT_PRIVATE_ATTRIBUTE } from "@jini-ai/core/agent-handles";
import { SiteKeyTab, type SiteKeyTabProps } from "../SiteKeyTab.js";

afterEach(cleanup);

it("keeps a human-visible synthetic revealed key private and Reveal/Copy unaddressable", () => {
  const hex = "synthetic-revealed-site-key";
  const useSiteKeyHook: SiteKeyTabProps["useSiteKeyHook"] = () => {
    const [revealedHex, setRevealedHex] = useState<string | null>(null);
    return {
      status: { active: true, source: "file", keyFilePath: "/keys/site-key", runtimeMode: "local", state: "active" },
      loadError: null, revealing: false, revealError: null, revealedHex,
      reveal: async () => { setRevealedHex(hex); }, hideRevealed: () => setRevealedHex(null),
      generating: false, generateError: null, generate: vi.fn(async () => {}), refresh: vi.fn(async () => {}), t: key => key,
    };
  };
  const useSiteKeyRecoveryHook: SiteKeyTabProps["useSiteKeyRecoveryHook"] = () => ({
    siteKey: "", setSiteKey: vi.fn(), unlocking: false, unlockError: null, unlock: vi.fn(async () => {}),
    startFreshStep: "closed", preview: null, openStartFresh: vi.fn(async () => {}), cancelStartFresh: vi.fn(),
    confirmText: "", setConfirmText: vi.fn(), canConfirmStartFresh: false, startingFresh: false,
    startFreshError: null, startFresh: vi.fn(async () => {}), resultMessage: null, t: key => key,
  });
  const { container } = render(<SiteKeyTab useSiteKeyHook={useSiteKeyHook} useSiteKeyRecoveryHook={useSiteKeyRecoveryHook}
    useRevealedKeyCopyHook={() => ({ copied: false, copy: vi.fn(async () => {}) })} useAdminLocaleHook={() => "en"}
    kit={{ SecretInput: props => <input {...props} /> }}
    copy={{ siteKeyEnvVarName: "HOST_SITE_KEY", scope: "Saved credential scope", invalidEnv: "Invalid environment key", invalidFileSuffix: "Invalid file key",
      siteKeyStatusBadgeLabel: () => "Key file", siteKeyGenerateErrorMessage: ({ error }) => error }} />);
  const reveal = screen.getByRole("button", { name: "Reveal" });
  expect(reveal.hasAttribute("data-agent-handle")).toBe(false);
  fireEvent.click(reveal);
  const value = screen.getByText(hex);
  expect(value.textContent).toBe(hex);
  expect(value.hasAttribute(AGENT_PRIVATE_ATTRIBUTE)).toBe(true);
  expect(value.parentElement?.hasAttribute(AGENT_PRIVATE_ATTRIBUTE)).toBe(true);
  expect(screen.getByRole("button", { name: "Copy" }).hasAttribute("data-agent-handle")).toBe(false);
  const agentTree = container.cloneNode(true) as HTMLElement;
  agentTree.querySelectorAll(`[${AGENT_PRIVATE_ATTRIBUTE}]`).forEach(node => node.remove());
  expect(agentTree.textContent).not.toContain(hex);
});
