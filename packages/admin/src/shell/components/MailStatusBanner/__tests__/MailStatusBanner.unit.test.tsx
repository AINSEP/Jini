// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { renderWithAdminKit as render } from "../../../../react/__tests__/render-with-admin-kit.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MailStatusBanner } from "../MailStatusBanner.js";
import {
  MAIL_BANNER_DISMISSED_KEY,
  MAIL_SET_UP_LABEL,
  MAIL_UNCONFIGURED_TEXT,
  mailStatusBannerVisible,
  readMailBannerDismissed,
  writeMailBannerDismissed,
  type MailBannerStorage,
  useMailStatusBanner,
} from "../hooks/use-mail-status-banner.hooks.js";

/**
 * @file The blocking mail banner: shown only for `state: "unconfigured"`, silent for every other
 * state and for a failed status read (it must never block the admin on its own fetch). The × hides
 * it and remembers that per browser; a storage that throws still hides it for the session.
 */

/** In-memory `MailBannerStorage` fake. */
function memoryStorage(seed: Record<string, string> = {}): MailBannerStorage & { data: Record<string, string> } {
  const data = { ...seed };
  return { data, getItem: ({ key }) => data[key] ?? null, setItem: ({ key, value }) => { data[key] = value; } };
}

/** A storage whose every call throws, like `localStorage` in some privacy modes. */
const throwingStorage: MailBannerStorage = {
  getItem: () => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("QuotaExceededError"); },
};

/** The caller-translated copy; English here. */
function labels(dismiss: string) {
  return { text: MAIL_UNCONFIGURED_TEXT, setUp: MAIL_SET_UP_LABEL, dismiss };
}

const unconfigured = async () => ({ mailDeliveryAvailable: false, state: "unconfigured" as const });

beforeEach(() => localStorage.clear());

describe("mailStatusBannerVisible", () => {
  it("shows only when unconfigured", () => {
    expect(mailStatusBannerVisible({ status: { mailDeliveryAvailable: false, state: "unconfigured" } })).toBe(true);
    expect(mailStatusBannerVisible({ status: { mailDeliveryAvailable: true, state: "ready" } })).toBe(false);
    expect(mailStatusBannerVisible({ status: { mailDeliveryAvailable: true, state: "degraded" } })).toBe(false);
    expect(mailStatusBannerVisible({ status: { mailDeliveryAvailable: false } })).toBe(false);
    expect(mailStatusBannerVisible({ status: null })).toBe(false);
  });
});

describe("readMailBannerDismissed / writeMailBannerDismissed", () => {
  it("round-trips the dismissal through the storage port", () => {
    const storage = memoryStorage();
    expect(readMailBannerDismissed({ storage })).toBe(false);
    writeMailBannerDismissed({ storage });
    expect(storage.data[MAIL_BANNER_DISMISSED_KEY]).toBe("1");
    expect(readMailBannerDismissed({ storage })).toBe(true);
  });

  it("treats any other stored value as not dismissed", () => {
    expect(readMailBannerDismissed({ storage: memoryStorage({ [MAIL_BANNER_DISMISSED_KEY]: "0" }) })).toBe(false);
  });

  it("never throws when storage does", () => {
    expect(readMailBannerDismissed({ storage: throwingStorage })).toBe(false);
    expect(() => writeMailBannerDismissed({ storage: throwingStorage })).not.toThrow();
  });
});

describe("MailStatusBanner", () => {
  it("renders a blocking alert once the status says unconfigured", async () => {
    const fetchStatus = vi.fn(async () => ({ mailDeliveryAvailable: false, state: "unconfigured" as const }));
    render(<MailStatusBanner useMailStatusBannerHook={useMailStatusBanner} fetchStatus={fetchStatus} labels={labels("Dismiss")} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(MAIL_UNCONFIGURED_TEXT);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("links Set up email to the Email screen's Provider tab instead of naming Access Tokens", async () => {
    render(<MailStatusBanner useMailStatusBannerHook={useMailStatusBanner} fetchStatus={unconfigured} labels={labels("Dismiss")} />);
    const link = await screen.findByRole("link", { name: "Set up email" });
    expect(link).toHaveAttribute("href", "/admin/email?tab=provider");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Access Tokens");
  });

  it("renders nothing when mail is ready", async () => {
    const fetchStatus = vi.fn(async () => ({ mailDeliveryAvailable: true, state: "ready" as const }));
    const { container } = render(<MailStatusBanner useMailStatusBannerHook={useMailStatusBanner} fetchStatus={fetchStatus} labels={labels("Dismiss")} />);
    await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the status read fails", async () => {
    const fetchStatus = vi.fn(async () => { throw new Error("403"); });
    const { container } = render(<MailStatusBanner useMailStatusBannerHook={useMailStatusBanner} fetchStatus={fetchStatus} labels={labels("Dismiss")} />);
    await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("ignores a status that arrives after unmount", async () => {
    let resolve: (value: { mailDeliveryAvailable: boolean; state: "unconfigured" }) => void = () => {};
    const fetchStatus = vi.fn(() => new Promise<{ mailDeliveryAvailable: boolean; state: "unconfigured" }>((done) => { resolve = done; }));
    const { unmount } = render(<MailStatusBanner useMailStatusBannerHook={useMailStatusBanner} fetchStatus={fetchStatus} labels={labels("Dismiss")} />);
    unmount();
    resolve({ mailDeliveryAvailable: false, state: "unconfigured" });
    await Promise.resolve();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("× hides the banner and remembers it in the injected storage", async () => {
    const storage = memoryStorage();
    render(<MailStatusBanner useMailStatusBannerHook={useMailStatusBanner} fetchStatus={unconfigured} labels={labels("Descartar")} storage={storage} />);
    fireEvent.click(await screen.findByRole("button", { name: "Descartar" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(storage.data[MAIL_BANNER_DISMISSED_KEY]).toBe("1");
  });

  it("stays hidden on the next mount once dismissed", async () => {
    const fetchStatus = vi.fn(unconfigured);
    const storage = memoryStorage({ [MAIL_BANNER_DISMISSED_KEY]: "1" });
    const { container } = render(<MailStatusBanner useMailStatusBannerHook={useMailStatusBanner} fetchStatus={fetchStatus} labels={labels("Dismiss")} storage={storage} />);
    await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("still hides for the session when storage throws", async () => {
    render(<MailStatusBanner useMailStatusBannerHook={useMailStatusBanner} fetchStatus={unconfigured} labels={labels("Dismiss")} storage={throwingStorage} />);
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("defaults to the browser's localStorage", async () => {
    const first = render(<MailStatusBanner useMailStatusBannerHook={useMailStatusBanner} fetchStatus={unconfigured} labels={labels("Dismiss")} />);
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(localStorage.getItem(MAIL_BANNER_DISMISSED_KEY)).toBe("1");
    first.unmount();
    const fetchStatus = vi.fn(unconfigured);
    const { container } = render(<MailStatusBanner useMailStatusBannerHook={useMailStatusBanner} fetchStatus={fetchStatus} labels={labels("Dismiss")} />);
    await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
