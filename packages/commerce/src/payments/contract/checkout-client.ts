/** Browser checkout actions; the host supplies navigation and any provider client handler. */
import type { NextAction } from "./evidence.js";

export type OpenCheckoutResult =
  | { readonly kind: "navigated"; readonly url: string }
  | { readonly kind: "client_action_handled" }
  | { readonly kind: "nothing_to_open"; readonly next: "none" | "out_of_band" | "pending" }
  | { readonly kind: "refused"; readonly reason: "unsafe_url" | "no_client_action_handler" };
export type ClientActionHandler = (required: { payload: Readonly<Record<string, unknown>> }, optional?: Record<string, never>) => Promise<void>;

/** Use the platform URL parser so navigation and validation interpret the same absolute URL. */
function safeRedirect({ url }: { url: string }, _optional = {}): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    return parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Open a payment's next action, refusing unsafe redirects before calling the host.
 * @param required - Nullable next action and navigation port.
 * @param optional - Client-action handler, when supported by the host.
 * @returns The navigation, handled, pending or refusal result; handler failures propagate.
 * @example await openCheckout({ next: payment.next, navigate: ({ url }) => location.assign(url) });
 */
export async function openCheckout(
  { next, navigate }: { next: NextAction | null; navigate: (required: { url: string }) => void },
  optional: { clientAction?: ClientActionHandler } = {}
): Promise<OpenCheckoutResult> {
  if (next === null) return { kind: "nothing_to_open", next: "pending" };
  switch (next.kind) {
    case "none":
    case "out_of_band": return { kind: "nothing_to_open", next: next.kind };
    case "redirect":
      if (!safeRedirect({ url: next.url })) return { kind: "refused", reason: "unsafe_url" };
      navigate({ url: next.url });
      return { kind: "navigated", url: next.url };
    case "client_action":
      if (!optional.clientAction) return { kind: "refused", reason: "no_client_action_handler" };
      await optional.clientAction({ payload: next.payload });
      return { kind: "client_action_handled" };
  }
}
