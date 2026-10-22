import type { Clock } from "@jini-ai/core/primitives";
import type { FederationMessages } from "../messages.js";
import type { FederatedCallConfirmationRequest } from "../ports.js";
import type { ConversationToolApprovalStore, ExternalMcpToolApprovalRepoPort } from "../tool-approvals.js";

/** Minimal execution identity; the application may pass its richer context unchanged. */
export interface FederatedConfirmationContext {
  readonly principal: { readonly id: string };
  readonly run: { readonly id: string };
}

/** Presentation data only. Rendering and exchange lifecycle belong to host adapters. */
export interface FederatedConfirmationSpec {
  readonly toolId: string;
  readonly errorCode: string;
  readonly title: string;
  readonly description: string;
  readonly details: readonly { readonly label: string; readonly value: string; readonly format?: "code" }[];
  readonly warning: string;
  readonly danger: boolean;
  readonly confirmLabel: string;
  readonly alternatives?: readonly { readonly id: string; readonly label: string; readonly choice: "chat" | "always" }[];
}

export interface FederatedCardOffers { readonly offerChat: boolean; readonly offerAlways: boolean }
export type FederatedHumanConfirmOutcome =
  | { readonly confirmed: true; readonly choice?: string }
  | { readonly confirmed: false; readonly result: Readonly<Record<string, unknown>> };

/** The host binds its exchange store and maps cancelled/expired/abandoned answers to results.
 * Adapters must bind the answer to this principal, tool and execution, and accept it only once.
 */
export interface FederatedHumanConfirmPort<Context extends FederatedConfirmationContext, Exchanges> {
  ask(required: { context: Context; surfaceExchanges: Exchanges; spec: FederatedConfirmationSpec }): Promise<FederatedHumanConfirmOutcome>;
}

/** Optional remembered scopes; a missing store or conversation removes that choice. */
export interface FederatedApprovalDeps {
  readonly mayAlwaysAllow: (required: { principalId: string }, optional?: { scope?: string }) => Promise<boolean>;
  readonly clock: Clock;
  readonly always?: ExternalMcpToolApprovalRepoPort;
  readonly chat?: ConversationToolApprovalStore;
  readonly conversationIdForRun?: (required: { runId: string }) => string | undefined;
}

/** Host can enqueue durable webhooks; no transport or webhook package is imported here. */
export interface FederatedApprovalWebhookPort {
  approvalRemembered(required: {
    principalId: string; connectionId: string; toolName: string;
    fingerprint: string; scope: "chat" | "always"; grantedAt: string;
  }, optional?: { scope?: string }): Promise<void>;
}

export interface FederatedApprovalDiagnostic {
  readonly toolId: string;
  readonly choice: string;
  readonly stage: "store" | "webhook";
  readonly error: unknown;
}

export interface FederatedCallConfirmerRequired<Context extends FederatedConfirmationContext, Exchanges> {
  readonly messages: FederationMessages;
  readonly fingerprintDomain: string;
  readonly errorCode: string;
  readonly surfaceExchanges: Exchanges;
  readonly humanConfirm: FederatedHumanConfirmPort<Context, Exchanges>;
}

export interface FederatedCallConfirmerOptions {
  /** Opaque host storage partition; never interpreted by federation. */
  readonly scope?: string;
  readonly approvals?: FederatedApprovalDeps;
  readonly webhooks?: FederatedApprovalWebhookPort;
  readonly onPersistenceError?: (required: FederatedApprovalDiagnostic) => void;
}

/** Used by adapters without depending on a tool runtime's callback signature. */
export interface FederatedConfirmCallInput<Context extends FederatedConfirmationContext> {
  readonly context: Context;
  readonly request: FederatedCallConfirmationRequest;
}
