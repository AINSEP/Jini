/**
 * @file `hooks.ts` — fixed-order, fail-closed hook dispatch (ADR-PIPE-011 C-018, REQ-23,
 * behavior.spec.md §1.3).
 *
 * `runHookChain` runs `recipient.filter` -> (if kept) `beforeSend` -> returns the transformed
 * message or a suppression verdict. `recipient.filter` ALWAYS runs before `beforeSend`; a throwing
 * hook is fail-closed suppression, never "keep by default" (behavior.spec §7).
 *
 * Implemented as a factory (`createHookRegistry`) rather than module-level mutable arrays — avoids
 * a hidden cross-test/cross-instance singleton while still exposing the three named capabilities
 * the ADR's Contract Map (C-018) names.
 */
import type { UUID } from "@jini-ai/core/primitives";
import type { OutboundEmail } from "@jini-ai/core/contracts/mail";
import type { SubscriptionStatus } from "./types.js";

export interface RecipientFilterContext {
  workspaceId: UUID;
  campaignId: UUID;
  listId: UUID;
  subscriberId: UUID;
  recipientEmail: string;
  status: SubscriptionStatus;
}

export interface BeforeSendHookContext {
  workspaceId: UUID;
  campaignId: UUID;
  sendId: UUID;
  subscriberId: UUID;
}

/** Returns `true` to keep the recipient (EC-01: re-checked live at dispatch time, distinct from the freeze-time filter). */
export type RecipientFilterHook = (ctx: RecipientFilterContext) => Promise<boolean> | boolean;
/** Returns a possibly-transformed message (footer/unsub-link/UTM injection). */
export type BeforeSendHook = (ctx: BeforeSendHookContext, message: OutboundEmail) => Promise<OutboundEmail> | OutboundEmail;

export type HookChainResult = { keep: true; message: OutboundEmail } | { keep: false; reason: string };

export interface HookRegistry {
  registerRecipientFilterHook(required: { hook: RecipientFilterHook }, optional?: {}): void;
  registerBeforeSendHook(required: { hook: BeforeSendHook }, optional?: {}): void;
  runHookChain(required: {
    recipientFilterContext: RecipientFilterContext;
    beforeSendContext: BeforeSendHookContext;
    message: OutboundEmail;
  }, optional?: {}): Promise<HookChainResult>;
}

/**
 * @complexity O(k), k = registered hook count (small, fixed per process).
 * @overallScore 100
 */
export function createHookRegistry(_optional: Record<string, never> = {}): HookRegistry {
  const recipientFilters: RecipientFilterHook[] = [];
  const beforeSendHooks: BeforeSendHook[] = [];

  return {
    registerRecipientFilterHook({ hook }, _options = {}) {
      recipientFilters.push(hook);
    },
    registerBeforeSendHook({ hook }, _options = {}) {
      beforeSendHooks.push(hook);
    },
    async runHookChain(required, _options = {}) {
      // Step 1: recipient.filter — ALWAYS before beforeSend (behavior.spec §1.3).
      for (const filter of recipientFilters) {
        let keep: boolean;
        try {
          keep = await filter(required.recipientFilterContext);
        } catch (err) {
          // A throwing filter is fail-closed suppression, never "keep by default" (behavior.spec §7).
          return { keep: false, reason: `recipient.filter threw: ${(err as Error).message}` };
        }
        if (!keep) return { keep: false, reason: "recipient.filter suppressed this recipient" };
      }

      // EC-01: live subscription status is mandatory, including with an empty registry.
      // Custom filters may further restrict the audience, but cannot re-enable an unsubscribe.
      if (required.recipientFilterContext.status !== "subscribed") {
        return { keep: false, reason: `subscription is '${required.recipientFilterContext.status}'` };
      }

      // Step 2: beforeSend — only reached for a row that passed step 1.
      let message = required.message;
      for (const hook of beforeSendHooks) {
        try {
          message = await hook(required.beforeSendContext, message);
        } catch (err) {
          // Same fail-closed rule applies to beforeSend (behavior.spec §7).
          return { keep: false, reason: `beforeSend threw: ${(err as Error).message}` };
        }
      }

      return { keep: true, message };
    },
  };
}
