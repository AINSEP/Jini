import { useCallback, useEffect, useState } from "react";
import { orFallbackSync } from "@jini-ai/core/errors/idioms";

import type { AdminMailStatus } from "../../../../screens/email/api/mail-status-api.types.js";

/** The banner line (English; also the `app-i18n.ts` key). */
export const MAIL_UNCONFIGURED_TEXT =
  "Email is not set up: sign-in links, confirmations and form notifications are not sent.";
/** The link to the Email screen (English; also the `app-i18n.ts` key). */
export const MAIL_SET_UP_LABEL = "Set up email";

/** Namespaced under `jini.admin.` like the dashboard's default-password dismiss key, so it can never
 *  collide with an unrelated app key. Per browser, not per user: the mail state is site-wide. */
export const MAIL_BANNER_DISMISSED_KEY = "jini.admin.mail-status-banner.dismissed";

/** The slice of `localStorage` the dismiss needs; injected for tests. */
export interface MailBannerStorage {
  getItem(input: { key: string }, options?: Record<string, never>): string | null;
  setItem(input: { key: string; value: string }, options?: Record<string, never>): void;
}

/** Touches `localStorage` only inside each call, so a privacy mode that throws on the property
 *  access itself is caught by the try/catch in the read/write helpers below. */
const browserStorage: MailBannerStorage = {
  getItem: ({ key }, _options = {}) => localStorage.getItem(key),
  setItem: ({ key, value }, _options = {}) => localStorage.setItem(key, value),
};

/** Pure: whether a status shows the banner — only when no provider is chosen, never when unknown. */
export function mailStatusBannerVisible({ status }: { status: AdminMailStatus | null }): boolean {
  return status?.state === "unconfigured";
}

/** Best-effort read — a failing storage just shows the banner again, which is harmless.
 *  @complexity Time/space: O(1). */
export function readMailBannerDismissed({ storage }: { storage: MailBannerStorage }): boolean {
  return orFallbackSync({ work: () => {
    return storage.getItem({ key: MAIL_BANNER_DISMISSED_KEY }) === "1";
  }, fallback: false, step: "Read mail banner dismissal" });
}

/** Best-effort write — silent on storage failure; the caller's state still hides it for the session.
 *  @complexity Time/space: O(1). */
export function writeMailBannerDismissed({ storage }: { storage: MailBannerStorage }): void {
  // best-effort; see the doc comment above.
  orFallbackSync({ work: () => {
    storage.setItem({ key: MAIL_BANNER_DISMISSED_KEY, value: "1" });
  }, fallback: undefined, step: "Remember mail banner dismissal" });
}

/**
 * Reads the mail status once on mount. A failed read (no `admin.forms.manage`, server down) shows
 * nothing: this banner must never block the screen on its own fetch. `dismiss` hides it for this
 * browser (owner, 2026-10-21: email stays unconfigured on purpose, so the line is noise once read).
 * @param required.fetchStatus - `api.getMailStatus` in the app; injected for tests.
 * @param optional.storage - defaults to the browser's `localStorage`.
 */
export function useMailStatusBanner(
  required: { fetchStatus: () => Promise<AdminMailStatus> },
  optional: { storage?: MailBannerStorage | undefined } = {},
): { visible: boolean; dismiss: () => void } {
  const [status, setStatus] = useState<AdminMailStatus | null>(null);
  const { fetchStatus } = required;
  const storage = optional.storage ?? browserStorage;
  const [dismissed, setDismissed] = useState(() => readMailBannerDismissed({ storage }));
  useEffect(() => {
    let live = true;
    fetchStatus().then((next) => { if (live) setStatus(next); }, () => {});
    return () => { live = false; };
  }, [fetchStatus]);
  const dismiss = useCallback(() => {
    writeMailBannerDismissed({ storage });
    setDismissed(true);
  }, [storage]);
  return { visible: !dismissed && mailStatusBannerVisible({ status }), dismiss };
}
