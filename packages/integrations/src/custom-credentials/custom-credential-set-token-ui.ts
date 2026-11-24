import type { SecretCardForm, SurfaceCardApp, SurfaceOutcomeSpec } from "@jini-ai/core/contracts/cards";


/**
 * @file The MCP-UI surfaces `tool-registrations.ts` raises for `custom_credential_set_token`
 * (2026-09-01) — a masked, in-chat form for typing a saved custom credential's TOKEN, and the
 * result document that replaces it once the save actually finishes.
 *
 * ## The property this whole tool exists to hold up
 *
 * "A token must never pass through the model's context" — not merely "an agent must never write
 * one". Those come apart: if a human typed a token into ordinary chat text, it would land in
 * `ai_chat_messages` in plaintext, in the model's own context (so, the provider), and in the CLI's
 * session history — three copies, which is exactly why every OTHER credential-rotation path in this
 * codebase ends in "now go rotate it". This form is the escape from that: the human's keystrokes go
 * browser -> `mcp-ui-tool-calls-route.ts` -> `SurfaceExchangeStore` -> this parked tool call, entirely
 * inside the host's own process, and never through the spawned agent CLI's stdio at all. There is
 * therefore nothing to rotate afterward.
 *
 * `setTokenForm`'s field list has exactly one entry (`token`) — deliberately not a
 * `username` field too: `custom_credential_set_username` already owns that plaintext, non-secret
 * column, and folding it in here would blur which of the two tools is the one that can never accept a
 * secret's sibling metadata. `saveSetToken` (`tool-registrations.ts`) reads the submitted
 * `token` from the engine-filtered fields and carries the credential's EXISTING `username` forward into the
 * fresh `connection` it seals — see that function's own doc for why forgetting that would silently
 * clear a saved username.
 *
 * ## Form, then a replacing result — not a bare confirm/cancel
 *
 * Structurally this is `buildProposeCredentialForm`'s sibling (the host's deployment
 * agent tools) more than `delete-request-confirmation-ui.ts`'s: a form collecting a
 * secret field, not a yes/no dialog naming a destructive action. Unlike that S3-compatible form,
 * though, `tool-registrations.ts` drives this one through `askThenReport`, not `askOnce` — see that
 * function's own doc for the defect this avoids (a submission's `tools/call` round trip resolving
 * the instant the exchange DELIVERS the click, before the save has actually run). `setTokenOutcome`
 * is the correction: sent under the SAME `ui://` URI the form used
 * (the engine-owned URI), so `McpUiSurfaceCard` (`@jini-ai/chat`) replaces the form in place with
 * the true result rather than leaving a stale "Done." next to buttons that already fired.
 *
 * ## Why the URI carries only the exchange id
 *
 * Same reasoning `delete-request-confirmation-ui.ts` and `customProviderCredentialFormUri`
 * (`publish-agent-tools.ts`) both give: this is a live in-chat action, not an edit to an existing
 * host-owned row with its own id/version to key against, so the exchange id is the only stable handle
 * a fresh form instance has.
 */


/** Shared by the form and its later outcome document — see this file's header, "Why the URI carries
 *  only the exchange id". Reusing the SAME uri for both is what makes the outcome REPLACE the form
 *  in the transcript instead of opening a second card. */
// The published secret-card engine now supplies and reuses that URI.

/**
 * Renders the masked token-entry form. The rendered field is the ONLY place the token exists outside
 * the sealed ciphertext it becomes a moment later — it is typed directly into this iframe and posted
 * straight to `mcp-ui-tool-calls-route.ts`, never through the assistant's own text channel.
 *
 * @param required.app - The host's card identity for this form (its `CredentialCardIdentity.appNames.setToken`).
 * @param required.secretField - The host's secret marker for the token field (its `credential_save`
 *   secret-form definition), so the callback gate and this form derive "secret" from one source.
 * @complexity O(1) — a fixed one-field form.
 */
export function setTokenForm({ label, app, secretField }: { label: string; app: SurfaceCardApp; secretField: { readonly secret: true } | undefined }, _optional = {}): SecretCardForm {
  return {
    title: `Replace the saved key for '${label}'?`,
    description:
      "This REPLACES the saved key. Only continue if you want to replace it. Type the new key directly into the field below. It is sealed on the server the moment you submit — " +
      "the assistant never sees it, and it is never written to the chat transcript. Any saved username for " +
      "this credential is kept as-is.",
    submitLabel: "Replace saved key",
    fields: [
      {
        kind: "string",
        name: "token",
        label: "Token",
        hint: "Pasted or typed here only — never shown to the assistant.",
        required: false,
        allowBlank: true,
        ...secretField,
      },
    ],
    cancelLabel: "Cancel",
    app,
    preferredFrameSize: ["100%", "360px"],
  };
}

/**
 * Renders the RESULT of a submitted token — what replaces the form once `askThenReport`'s `handle`
 * callback (`saveSetToken`, `tool-registrations.ts`) has actually run `updateCustomCredential`
 * (or refused to, e.g. a blank submission). See this file's header for the mechanism and why the `uri`
 * MUST equal the engine-owned URI for the same exchange id.
 *
 * `message` is caller-controlled and must never carry the token itself — enforced by construction at
 * every call site in `tool-registrations.ts`, never by this function, which only renders what it is
 * given (same division of responsibility `@jini-ai/ui`'s own `SurfaceOutcomeSpec.message` doc states).
 *
 * @param required.app - The host's card identity for the outcome (`CredentialCardIdentity.appNames.setTokenOutcome`).
 * @complexity O(1) — fixed-size field reads.
 */
export function setTokenOutcome({ label, state, message, app }: { label: string; state: "success" | "failure"; message: string; app: SurfaceCardApp }, _optional = {}): SurfaceOutcomeSpec {
  return {
    title: state === "success" ? "Token saved" : "Token not saved",
    details: [{ label: "Credential", value: label }],
    state,
    message,
    app,
    preferredFrameSize: ["100%", "240px"],
  };
}
