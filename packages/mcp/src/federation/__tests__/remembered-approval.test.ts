import { describe, expect, test } from "vitest";
import { federatedToolApprovalFingerprint } from "../tool-approvals.js";
import type { ConversationToolApprovalStore, ExternalMcpToolApprovalRepoPort } from "../tool-approvals.js";
import { approvalContext, rememberApproval } from "../approvals/remembered-approval.js";
import type { FederatedApprovalDeps } from "../approvals/index.js";
import type { FederatedCallConfirmationRequest } from "../ports.js";

// Direct tests for the defense-in-depth guards `createFederatedCallConfirmer` can never reach: it
// only passes a choice its own card offered, and the card offers none for these calls.
const request: FederatedCallConfirmationRequest = {
  toolId: "mcp__service__send", remoteName: "send", connectionId: "service", connectionLabel: "Service",
  arguments: {}, destructive: false, declaredAnnotations: undefined, origin: { kind: "roster", admissionRevision: "r1" },
  description: "Send.", inputSchema: { type: "object" }, writeShapedInputs: [],
};
const context = { principal: { id: "person" }, run: { id: "chat-a/1" } };

function deps(writes: string[]): FederatedApprovalDeps {
  const always: ExternalMcpToolApprovalRepoPort = {
    find: async () => null, listByScope: async () => [], delete: async () => false,
    upsert: async () => { writes.push("always.upsert"); },
  };
  const chat: ConversationToolApprovalStore = { has: async () => false, grant: async () => { writes.push("chat.grant"); } };
  return { clock: { nowMs: () => 0 }, mayAlwaysAllow: async () => true, always, chat, conversationIdForRun: () => "chat-a" };
}

function remember(call: FederatedCallConfirmationRequest, choice: "chat" | "always", approvals: FederatedApprovalDeps, { withKeys = true } = {}) {
  const notified: string[] = [];
  const keys = approvalContext(context, call, withKeys ? approvals : undefined, "d");
  return { notified, done: rememberApproval({ context, request: call, keys, approvals, choice,
    options: { webhooks: { approvalRemembered: async ({ scope }) => { notified.push(scope); } } } }) };
}

describe("rememberApproval guards", () => {
  for (const choice of ["chat", "always"] as const) {
    test(`a forged ${choice} choice for a destructive call saves and notifies nothing`, async () => {
      const writes: string[] = [];
      const { notified, done } = remember({ ...request, destructive: true }, choice, deps(writes));
      await done;
      expect([writes, notified]).toEqual([[], []]);
    });

    test(`a forged ${choice} choice for a write-shaped call saves and notifies nothing`, async () => {
      const writes: string[] = [];
      const { notified, done } = remember({ ...request, writeShapedInputs: ["sql"] }, choice, deps(writes));
      await done;
      expect([writes, notified]).toEqual([[], []]);
    });

    test(`a ${choice} choice without its key saves and notifies nothing`, async () => {
      const writes: string[] = [];
      const { notified, done } = remember(request, choice, deps(writes), { withKeys: false });
      await done;
      expect([writes, notified]).toEqual([[], []]);
    });
  }

  test("a chat choice with its key saves and notifies", async () => {
    const writes: string[] = [];
    const { notified, done } = remember(request, "chat", deps(writes));
    await done;
    expect([writes, notified]).toEqual([["chat.grant"], ["chat"]]);
  });

  test("the keys carry the call's fingerprint", () => {
    expect(approvalContext(context, request, undefined, "d")).toEqual({
      fingerprint: federatedToolApprovalFingerprint({ identity: request, fingerprintDomain: "d" }), chatKey: undefined, alwaysKey: undefined,
    });
  });
});
