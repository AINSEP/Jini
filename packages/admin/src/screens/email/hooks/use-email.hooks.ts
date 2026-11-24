import { useCallback, useEffect, useState } from "react";

import type { AdminMailStatus } from "../api/mail-status-api.types.js";
import type { EmailLoadApiError } from "./email-load.hooks.js";

/**
 * @file All of the Email screen's state (phase 1: configuration diagnostics only). `Email.tsx` is
 * markup only. Design: `ADS-memory/reports/2026-10-22-email-page-design-codex.md`.
 *
 * One read, `GET …/system/mail-status` — the same call `MailStatusBanner` makes. A failed read is
 * "Status unavailable", never "Not set up": an outage must not read as a fact about the site.
 */

/** Where the status read stands. `forbidden` is a 403 (`admin.forms.manage` missing). */
export type EmailStatusView =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error" }
  | { kind: "loaded"; status: AdminMailStatus };

/** The one-line verdict the Status section shows for a loaded status. */
export type EmailSummary = "not_set_up" | "no_external_delivery" | "needs_attention" | "configured";

export interface EmailPort {
  getMailStatus(): Promise<AdminMailStatus>;
}

export interface EmailController {
  view: EmailStatusView;
  locale: string;
  retry: () => void;
}

/**
 * Pure: the Status verdict. A lane on a non-hosted provider (the console fallback) is "No external
 * delivery" even when nothing else is wrong — it is never healthy email. A server that predates the
 * `state` field falls back to `mailDeliveryAvailable`.
 * @complexity Time: O(lanes). Space: O(1).
 */
export function emailSummary({ status }: { status: AdminMailStatus }): EmailSummary {
  if (status.state === "unconfigured") return "not_set_up";
  if (status.lanes?.some((lane) => lane.state === "local_only")) return "no_external_delivery";
  if (status.state === undefined) return status.mailDeliveryAvailable ? "configured" : "no_external_delivery";
  return status.state === "degraded" || hasWarnings(status) ? "needs_attention" : "configured";
}

function hasWarnings(status: AdminMailStatus): boolean {
  return (status.warnings?.length ?? 0) > 0;
}

/**
 * Loads the mail status on mount and again on `retry`.
 * @param required.port - where the status comes from; a fake in tests.
 * @param required.locale - the operator's resolved locale.
 * @param required.ApiError - the host's transport error class (a 403 reads as `forbidden`).
 */
export function useEmail(required: { port: EmailPort; locale: string; ApiError: EmailLoadApiError }): EmailController {
  const { port, locale, ApiError } = required;
  const [view, setView] = useState<EmailStatusView>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setView({ kind: "loading" });
    port.getMailStatus().then(
      (status) => { if (live) setView({ kind: "loaded", status }); },
      (error: unknown) => {
        if (live) setView({ kind: error instanceof ApiError && error.status === 403 ? "forbidden" : "error" });
      },
    );
    return () => { live = false; };
  }, [port, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { view, locale, retry };
}

