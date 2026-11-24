export type ProviderDomainVerification =
  | { state: "verified" | "pending" | "failed" | "not_found"; domain: string; providerId: string }
  | { state: "no_sender" | "no_provider" | "unsupported" | "unknown"; domain?: string; providerId: string | null; reason?: string };

/** `GET /system/mail-status` (the host's mail-status route)
 *  — `false` while the site only logs outbound mail (the console fallback, no mail credential). */
export interface AdminMailStatus {
  /** Provider-side sender-domain verdict, independent of whether the sending key is saved. */
  senderDomainVerification?: ProviderDomainVerification;
  mailDeliveryAvailable: boolean;
  /** Present when the server reports lanes (email provider contract v1); `unconfigured` shows the
   *  admin's blocking banner. */
  state?: "ready" | "unconfigured" | "degraded";
  lanes?: readonly { lane: "transactional" | "bulk"; providerId: string | null; state: string }[];
  warnings?: readonly ("sender_unverified" | "sender_unknown")[];
  /** Installed mail providers (`MailStatusReport.providers`); `hosted: false` never leaves the machine. */
  providers?: readonly { id: string; label: string; hosted: boolean; origin: "core" | "plugin" }[];
  /** Plugin providers that were not loaded, and why (log-safe, English). */
  refusals?: readonly string[];
}
