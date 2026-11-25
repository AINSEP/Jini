import type { HumanConfirmSpec } from "@jini-ai/core/contracts/site/human-confirm";


/**
 * @file The confirmation dialog `tool-registrations.ts` raises before running a DELETE through a
 * saved custom credential (2026-08-31, owner decision: "the only thing we maybe should be worried
 * about is deletion, but we can gate that with MCP-UI"). Structurally mirrors
 * the host's `contracts/core/human-confirm.ts` — see that file's own header for the mechanism this one
 * reuses rather than reinventing (a held-open `SurfaceExchangeStore` exchange, `askOnce`, a
 * confirm/cancel tool action carrying `SURFACE_EXCHANGE_ID_PARAM` back to the SAME tool call).
 *
 * Differs from that file only in WHAT the dialog shows and WHERE it is keyed: there is no existing
 * row/version to re-version against here (a DELETE-through-credential is a live outbound call, not an
 * edit to a host-owned entity) — so the `ui://` URI is keyed by the exchange id alone, the same
 * reasoning `features/deployments/publish-agent-tools.ts`'s own `publishConfirmationUri` gives for the
 * identical "nothing to re-version" shape.
 */

/**
 * Describes the dialog naming exactly what is about to be sent — label, resolved host, method, and
 * path — per the owner's own requirement ("showing the operator the label, the resolved host, the
 * method and the full path so they can see exactly what is about to be destroyed").
 *
 * The shared transport owns the exchange deadline (`SurfaceExchange.expiresAtMs()`), so the chat
 * counts the card down and closes it when the parked call stops waiting.
 *
 * @complexity O(1) — a handful of fixed-size field reads.
 */
export function describeDeleteRequestApproval({ label, host, path, toolId, irreversibleDescription }: { label: string; host: string; path: string; toolId: string; irreversibleDescription: string }, _optional = {}): HumanConfirmSpec {
  return {
    toolId, errorCode: "CUSTOM_CREDENTIALS",
    title: `Send a DELETE through '${label}'?`,
    description: irreversibleDescription,
    details: [{ label: "Credential", value: label }, { label: "Host", value: host }, { label: "Method", value: "DELETE" }, { label: "Path", value: path }],
    warning: "This is irreversible if the provider actually deletes something. Double-check the path above before confirming.",
    danger: true, confirmLabel: "Send DELETE",
  };
}
