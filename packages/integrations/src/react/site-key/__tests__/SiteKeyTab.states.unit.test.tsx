// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminSiteKeyStatus } from "@jini-ai/core/contracts/site/site-key";
import { SiteKeyGenerateAction, SiteKeyTab, type SiteKeyTabProps } from "../SiteKeyTab.js";
import type { SiteKeyController } from "../hooks/use-site-key.hooks.js";
import type { SiteKeyRecoveryController } from "../hooks/use-site-key-recovery.hooks.js";

afterEach(cleanup);

const t = (key: string) => `T(${key})`;

function status(_optional: Partial<AdminSiteKeyStatus> = {}): AdminSiteKeyStatus {
  return { active: true, source: "file", keyFilePath: "/keys/site-key", runtimeMode: "local", state: "active", ..._optional };
}

function controller(_optional: Partial<SiteKeyController> = {}): SiteKeyController {
  return {
    status: status(), loadError: null, revealing: false, revealError: null, revealedHex: null,
    reveal: vi.fn(async () => {}), hideRevealed: vi.fn(), generating: false, generateError: null,
    generate: vi.fn(async () => {}), refresh: vi.fn(async () => {}), t, ..._optional,
  };
}

function recovery(_optional: Partial<SiteKeyRecoveryController> = {}): SiteKeyRecoveryController {
  return {
    siteKey: "", setSiteKey: vi.fn(), unlocking: false, unlockError: null, unlock: vi.fn(async () => {}),
    startFreshStep: "closed", preview: null, openStartFresh: vi.fn(async () => {}), cancelStartFresh: vi.fn(),
    confirmText: "", setConfirmText: vi.fn(), canConfirmStartFresh: false, startingFresh: false,
    startFreshError: null, startFresh: vi.fn(async () => {}), resultMessage: null, t, ..._optional,
  };
}

const copy: SiteKeyTabProps["copy"] = {
  siteKeyEnvVarName: "HOST_SITE_KEY", scope: "Saved credential scope", invalidEnv: "Invalid environment key", invalidFileSuffix: "is not a valid key",
  siteKeyStatusBadgeLabel: ({ status: s, fallbackEnvVarName }) => `badge:${s.source}:${fallbackEnvVarName}`,
  siteKeyGenerateErrorMessage: ({ locale, error }) => `${locale}:could not generate: ${error}`,
};

function renderTab(c: SiteKeyController, r: SiteKeyRecoveryController = recovery(), _optional: { copyState?: { copied: boolean; copy: () => Promise<void> } } = {}) {
  const recoveryArgs: unknown[] = [];
  const copyArgs: { hex: string }[] = [];
  const utils = render(<SiteKeyTab useSiteKeyHook={() => c}
    useSiteKeyRecoveryHook={(args) => { recoveryArgs.push(args.onRecovered); return r; }}
    useRevealedKeyCopyHook={(args) => { copyArgs.push({ hex: args.hex }); return _optional.copyState ?? { copied: false, copy: vi.fn(async () => {}) }; }}
    useAdminLocaleHook={() => "en"} kit={{ SecretInput: ({ label, ...props }) => <input aria-label={label} {...props} /> }} copy={copy} />);
  return { ...utils, recoveryArgs, copyArgs };
}

describe("SiteKeyTab body states", () => {
  it("shows only the load error, and passes refresh as the recovery callback", () => {
    const c = controller({ loadError: "status unavailable", status: undefined });
    const { recoveryArgs } = renderTab(c);
    expect(screen.getByRole("status").textContent).toBe("status unavailable");
    expect(screen.queryByText("T(Site key)")).toBeNull();
    expect(recoveryArgs).toEqual([c.refresh]);
  });

  it("shows loading until the status arrives", () => {
    renderTab(controller({ status: undefined }));
    expect(screen.getByText("T(Loading…)").className).toBe("site-key-loading");
  });

  it("an active env key in production: storage warning, ok badge, fingerprint, env note", () => {
    const { container } = renderTab(controller({ status: status({ source: "env", runtimeMode: "production", fingerprint: "ab12" }) }));
    expect(container.querySelector(".site-key-scope-notice")?.textContent).toContain("T(On a live site, this key is stored right next to your database.");
    const badge = screen.getByText("badge:env:HOST_SITE_KEY");
    expect(badge.className).toBe("status status-ok");
    expect(container.querySelector("code.site-key-fingerprint")?.textContent).toBe("ab12");
    expect(container.querySelector(".site-key-status-card .site-key-status-note")?.textContent).toMatch(/^T\(This key was set up directly on the server/);
    expect(container.querySelector(".site-key-recovery-card")).toBeNull();
  });

  it("a valid file key in local mode: no storage warning, file path note", () => {
    const { container } = renderTab(controller());
    expect(container.querySelector(".site-key-scope-notice")?.textContent).not.toContain("On a live site");
    expect(container.querySelector(".site-key-fingerprint")).toBeNull();
    expect(container.querySelector(".site-key-status-card .site-key-status-note")?.textContent).toBe("T(Stored in a file on this server, at) /keys/site-key");
  });

  it("invalid keys warn: env uses its copy, file names the path; none is neutral with no Reveal", () => {
    const env = renderTab(controller({ status: status({ active: false, source: "env", invalid: true }) }));
    expect(screen.getByText("badge:env:HOST_SITE_KEY").className).toBe("status status-warning");
    expect(env.container.querySelector(".site-key-status-card .site-key-status-note")?.textContent).toBe("T(Invalid environment key)");
    cleanup();
    const file = renderTab(controller({ status: status({ active: false, invalid: true }) }));
    expect(file.container.querySelector(".site-key-status-card .site-key-status-note")?.textContent).toBe("T(The key file at) /keys/site-key T(is not a valid key)");
    cleanup();
    const none = renderTab(controller({ status: status({ active: false, source: "none", state: "missing" }) }));
    expect(screen.getByText("badge:none:HOST_SITE_KEY").className).toBe("status status-neutral");
    expect(none.container.querySelector(".site-key-status-card .site-key-status-note")?.textContent).toBe("T(A key is created automatically when this site starts.)");
    expect(screen.queryByRole("button", { name: "T(Reveal)" })).toBeNull();
  });
});

describe("SiteKeyTab reveal", () => {
  it("reveal calls the controller; in flight it is disabled; its error is shown", () => {
    const c = controller();
    renderTab(c);
    fireEvent.click(screen.getByRole("button", { name: "T(Reveal)" }));
    expect(c.reveal).toHaveBeenCalledTimes(1);
    cleanup();
    renderTab(controller({ revealing: true, revealError: "denied" }));
    expect(screen.getByRole("button", { name: "T(Revealing…)" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("denied").getAttribute("role")).toBe("status");
  });

  it("the revealed value copies through the hook and hides through the controller", () => {
    const copyFn = vi.fn(async () => {});
    const c = controller({ revealedHex: "fake-hex" });
    const { copyArgs } = renderTab(c, recovery(), { copyState: { copied: true, copy: copyFn } });
    expect(copyArgs).toEqual([{ hex: "fake-hex" }]);
    fireEvent.click(screen.getByRole("button", { name: "T(Copied!)" }));
    expect(copyFn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "T(Hide)" }));
    expect(c.hideRevealed).toHaveBeenCalledTimes(1);
  });
});

describe("SiteKeyRecoveryCard through the tab", () => {
  it("a locked key shows the recovery card and the locked note; unlock wires through", () => {
    const r = recovery({ siteKey: "pasted", unlockError: "wrong key" });
    const { container } = renderTab(controller({ status: status({ active: false, source: "none", state: "mismatch" }) }), r);
    expect(container.querySelector(".site-key-status-card .site-key-status-note")?.textContent).toBe("T(Your credentials need their original site key — use the card above.)");
    expect(screen.getByText("T(Your saved credentials are locked)")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("T(Paste your old site key)"), { target: { value: "new-paste" } });
    expect(r.setSiteKey).toHaveBeenCalledExactlyOnceWith("new-paste");
    const unlock = screen.getByRole("button", { name: "T(Unlock)" });
    expect(unlock.hasAttribute("disabled")).toBe(false);
    fireEvent.submit(unlock.closest("form")!);
    expect(r.unlock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("wrong key").className).toBe("notice error");
    fireEvent.click(screen.getByRole("button", { name: "T(Start fresh…)" }));
    expect(r.openStartFresh).toHaveBeenCalledTimes(1);
  });

  it("unlock is disabled for a blank paste or while unlocking", () => {
    renderTab(controller({ status: status({ state: "missing-with-data" }) }), recovery({ siteKey: "  " }));
    expect(screen.getByRole("button", { name: "T(Unlock)" }).hasAttribute("disabled")).toBe(true);
    cleanup();
    renderTab(controller({ status: status({ state: "missing-with-data" }) }), recovery({ siteKey: "k", unlocking: true }));
    expect(screen.getByRole("button", { name: "T(Unlocking…)" }).hasAttribute("disabled")).toBe(true);
  });

  it("the loading step shows its notice; the confirm step wires preview, text, confirm and cancel", () => {
    const locked = controller({ status: status({ state: "mismatch" }) });
    renderTab(locked, recovery({ startFreshStep: "loading" }));
    expect(screen.getByText("T(Checking what would change…)")).not.toBeNull();
    cleanup();
    const r = recovery({ startFreshStep: "confirm", preview: { removes: 1, affectedWebhooks: [], detail: "Removes one credential.", runtimeMode: "local" },
      confirmText: "START FRESH", canConfirmStartFresh: true, startFreshError: "server busy" });
    renderTab(locked, r);
    expect(screen.getByText("Removes one credential.")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("T(Type START FRESH to confirm)"), { target: { value: "START" } });
    expect(r.setConfirmText).toHaveBeenCalledExactlyOnceWith("START");
    fireEvent.click(screen.getByRole("button", { name: "T(Start fresh)" }));
    expect(r.startFresh).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "T(Cancel)" }));
    expect(r.cancelStartFresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("server busy").className).toBe("notice error");
  });

  it("confirm without a preview, unconfirmed, shows a disabled button; in flight it says so", () => {
    const locked = controller({ status: status({ state: "mismatch" }) });
    const { container } = renderTab(locked, recovery({ startFreshStep: "confirm" }));
    expect(container.querySelector(".site-key-recovery-confirm > p")).toBeNull();
    expect(screen.getByRole("button", { name: "T(Start fresh)" }).hasAttribute("disabled")).toBe(true);
    cleanup();
    renderTab(locked, recovery({ startFreshStep: "confirm", startingFresh: true }));
    expect(screen.getByRole("button", { name: "T(Starting fresh…)" }).hasAttribute("disabled")).toBe(true);
  });

  it("after a recovery the card stays with only the result message, even when no longer locked", () => {
    const { container } = renderTab(controller(), recovery({ resultMessage: "Unlocked." }));
    expect(screen.getByRole("status").textContent).toBe("Unlocked.");
    expect(container.querySelector(".site-key-recovery-unlock")).toBeNull();
  });
});

describe("SiteKeyGenerateAction", () => {
  function renderGenerate(c: SiteKeyController) {
    return render(<SiteKeyGenerateAction controller={c} useAdminLocaleHook={() => "de"} copy={copy} />);
  }

  it("renders nothing without a status or once any key source exists", () => {
    expect(renderGenerate(controller({ status: undefined })).container.innerHTML).toBe("");
    expect(renderGenerate(controller({ status: status({ active: false, invalid: true }) })).container.innerHTML).toBe("");
  });

  it("generates for a keyless install and shows the in-flight label", () => {
    const c = controller({ status: status({ active: false, source: "none", state: "missing" }) });
    renderGenerate(c);
    fireEvent.click(screen.getByRole("button", { name: "T(Generate a key)" }));
    expect(c.generate).toHaveBeenCalledTimes(1);
    cleanup();
    renderGenerate(controller({ status: status({ active: false, source: "none" }), generating: true }));
    expect(screen.getByRole("button", { name: "T(Generating…)" }).hasAttribute("disabled")).toBe(true);
  });

  it("maps each failure kind to its text", () => {
    const none = status({ active: false, source: "none" });
    renderGenerate(controller({ status: none, generateError: { kind: "already-exists" } }));
    expect(screen.getByRole("status").textContent).toBe("T(A key file already exists. This tab only creates a new key — it never overwrites one.)");
    cleanup();
    renderGenerate(controller({ status: none, generateError: { kind: "generic", detail: "disk full" } }));
    expect(screen.getByRole("status").textContent).toBe("de:could not generate: disk full");
    cleanup();
    renderGenerate(controller({ status: none, generateError: { kind: "refused", code: "KEY_INVALID", detail: "Server refused." } }));
    expect(screen.getByRole("status").textContent).toBe("Server refused.");
  });
});

describe("SiteKeyTab browser bindings for the copy hook", () => {
  it("binds the clipboard to navigator.clipboard and the scheduler to real timers", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async (_text: string) => {});
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
      let bound: Parameters<SiteKeyTabProps["useRevealedKeyCopyHook"]>[0] | undefined;
      render(<SiteKeyTab useSiteKeyHook={() => controller({ revealedHex: "fake-hex" })} useSiteKeyRecoveryHook={() => recovery()}
        useRevealedKeyCopyHook={(args) => { bound = args; return { copied: false, copy: async () => {} }; }}
        useAdminLocaleHook={() => "en"} kit={{ SecretInput: ({ label, ...props }) => <input aria-label={label} {...props} /> }} copy={copy} />);
      await bound!.clipboard.writeText("fake-hex");
      expect(writeText).toHaveBeenCalledExactlyOnceWith("fake-hex");
      const fired = vi.fn();
      bound!.scheduler.setTimeout(fired, 50);
      vi.advanceTimersByTime(50);
      expect(fired).toHaveBeenCalledTimes(1);
      const cancelled = vi.fn();
      const handle = bound!.scheduler.setTimeout(cancelled, 50);
      bound!.scheduler.clearTimeout(handle);
      vi.advanceTimersByTime(100);
      expect(cancelled).toHaveBeenCalledTimes(0);
    } finally {
      if (original) Object.defineProperty(navigator, "clipboard", original);
      else Reflect.deleteProperty(navigator, "clipboard");
      vi.useRealTimers();
    }
  });
});
