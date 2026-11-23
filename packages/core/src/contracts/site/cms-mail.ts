/**
 * @file The admin `system/mail-*` wire DTOs (ADR-029): the JSON bodies the mail admin routes
 * (status, test send, suppression removal preview, refusals) answer with and an admin client reads.
 * Declared here, once, so the server specs (`@jini-ai/cms/admin-http/routes/system/mail-*`) and any
 * client mirror read the same shapes without the client depending on CMS. The rules (what counts as
 * sent, which outcomes are local refusals) stay in CMS; only the declarations sit in Core.
 *
 * The provider-aware status block and a send's outcome are host DTOs the engine answers unchanged,
 * so they are declared here only as far as the engine reads them; a host's client may narrow them.
 */

/** The provider-aware status block a host builds; the status route spreads it into its body unchanged. */
export type AdminMailStatusBlockDto = Record<string, unknown>;

/** `GET .../system/mail-status`: whether outbound mail really sends, plus the host's status block. */
export type AdminMailStatusDto = { mailDeliveryAvailable: boolean } & AdminMailStatusBlockDto;

/** What the engine reads of a test send's truthful outcome; the host's whole outcome object is answered unchanged. */
export interface AdminMailTestSendOutcomeDto {
  outcome: string;
  errorCode?: string;
}

/** `POST .../system/mail-test-send` 200/429 body: whether the message left, and the send's own outcome. */
export interface AdminMailTestSendDto {
  sent: boolean;
  result: AdminMailTestSendOutcomeDto;
}

/** `POST .../system/mail-suppressions/remove` without `confirmed: true`: the preview of what would be unblocked. */
export interface AdminMailSuppressionRemovalPreviewDto {
  removed: false;
  confirmationRequired: true;
  /** The host's removal plan (what was blocked, why, and the warnings), answered unchanged. */
  plan: object;
}

/** A mail provider refusal's flat body: an operation refusal's caller-safe message, or a store refusal's bare code. */
export interface AdminMailProviderRefusalDto {
  error: string;
  code: string;
}
