import { describe, expect, test } from "vitest";
import { defaultFederationMessages } from "../messages.js";
import { federatedToolApprovalFingerprint } from "../tool-approvals.js";
import type { ConversationToolApprovalKey, ConversationToolApprovalStore, ExternalMcpToolApprovalRecord, ExternalMcpToolApprovalRepoPort } from "../tool-approvals.js";
import { buildFederatedCallConfirmSpec, createFederatedCallConfirmer } from "../approvals/index.js";
import type {
  FederatedApprovalDeps, FederatedApprovalDiagnostic, FederatedCallConfirmerOptions, FederatedConfirmationSpec,
  FederatedHumanConfirmOutcome,
} from "../approvals/index.js";
import type { FederatedCallConfirmationRequest } from "../ports.js";

// Characterization pins for every reachable branch of approvals/call-confirmation.ts (SEC: remembered approvals).
const DOMAIN = "pin-domain";
const request: FederatedCallConfirmationRequest = {
  toolId: "mcp__service__send", remoteName: "send", connectionId: "service", connectionLabel: "Service",
  arguments: Object.freeze({ name: "Ada" }), destructive: false, declaredAnnotations: { readOnlyHint: false },
  origin: { kind: "roster", admissionRevision: "revision-1" }, description: "Send a message.",
  inputSchema: { type: "object" }, writeShapedInputs: [],
};
const context = { principal: { id: "person" }, run: { id: "chat-a/1" } };
const fingerprint = federatedToolApprovalFingerprint({ identity: request, fingerprintDomain: DOMAIN });
const chatKey: ConversationToolApprovalKey = { conversationId: "chat-a", principalId: "person", connectionId: "service", toolName: "send", fingerprint };
const savedAlways: ExternalMcpToolApprovalRecord = { serverId: "service", toolName: "send", fingerprint, grantedByPrincipalId: "person", grantedAt: "2026-01-01T00:00:00.000Z" };

type Call = [string, ...unknown[]];

/** Recording always-store fake; `saved` is what `find` returns. */
function alwaysStore(calls: Call[], saved: ExternalMcpToolApprovalRecord | null, { failUpsert = false } = {}): ExternalMcpToolApprovalRepoPort {
  return {
    find: async (input, optional) => { calls.push(["always.find", input, optional]); return saved; },
    upsert: async (record, optional) => { calls.push(["always.upsert", record, optional]); if (failUpsert) throw new Error("store down"); },
    listByScope: async () => [],
    delete: async (input, optional) => { calls.push(["always.delete", input, optional]); return true; },
  };
}

function chatStore(calls: Call[], has: boolean, { failGrant = false } = {}): ConversationToolApprovalStore {
  return {
    has: async key => { calls.push(["chat.has", key]); return has; },
    grant: async input => { calls.push(["chat.grant", input]); if (failGrant) throw new Error("chat store down"); },
  };
}

function approvals(calls: Call[], parts: Partial<FederatedApprovalDeps> = {}): FederatedApprovalDeps {
  return {
    clock: { nowMs: () => 0 },
    mayAlwaysAllow: async (input, optional) => { calls.push(["mayAlwaysAllow", input, optional]); return true; },
    conversationIdForRun: ({ runId }) => runId.split("/")[0],
    ...parts,
  };
}

function confirmer(answer: FederatedHumanConfirmOutcome, options: FederatedCallConfirmerOptions) {
  const specs: FederatedConfirmationSpec[] = [];
  const confirm = createFederatedCallConfirmer({ fingerprintDomain: DOMAIN, errorCode: "E", messages: defaultFederationMessages, surfaceExchanges: {},
    humanConfirm: { ask: async ({ spec }) => { specs.push(spec); return answer; } } }, options);
  return { confirm, specs };
}

const choices = (spec: FederatedConfirmationSpec | undefined) => spec?.alternatives?.map(alternative => alternative.choice);

describe("buildFederatedCallConfirmSpec argument rows", () => {
  test("an undefined argument value renders as the string undefined in code format", () => {
    const spec = buildFederatedCallConfirmSpec({ request: { ...request, arguments: { missing: undefined } }, messages: defaultFederationMessages, errorCode: "E" });
    expect(spec.details[2]).toEqual({ label: "missing", value: "undefined", format: "code" });
  });

  test("a short string with a newline renders in code format", () => {
    const spec = buildFederatedCallConfirmSpec({ request: { ...request, arguments: { s: "a\n" } }, messages: defaultFederationMessages, errorCode: "E" });
    expect(spec.details[2]).toEqual({ label: "s", value: "a\n", format: "code" });
  });

  test("a boolean renders inline", () => {
    const spec = buildFederatedCallConfirmSpec({ request: { ...request, arguments: { flag: false } }, messages: defaultFederationMessages, errorCode: "E" });
    expect(spec.details[2]).toEqual({ label: "flag", value: "false" });
  });

  test("offers are absent by default", () => {
    expect(buildFederatedCallConfirmSpec({ request, messages: defaultFederationMessages, errorCode: "E" }).alternatives).toBeUndefined();
  });

  test("only the chat offer is rendered when always is not offered", () => {
    const spec = buildFederatedCallConfirmSpec({ request, messages: defaultFederationMessages, errorCode: "E" }, { offers: { offerChat: true, offerAlways: false } });
    expect(spec.alternatives).toEqual([{ id: "allow-chat", label: defaultFederationMessages.allowChatLabel, choice: "chat" }]);
  });

  test("only the always offer is rendered when chat is not offered", () => {
    const spec = buildFederatedCallConfirmSpec({ request, messages: defaultFederationMessages, errorCode: "E" }, { offers: { offerChat: false, offerAlways: true } });
    expect(spec.alternatives).toEqual([{ id: "allow-always", label: defaultFederationMessages.allowAlwaysLabel, choice: "always" }]);
  });
});

describe("remembered lookup", () => {
  test("without a scope the always lookup and stale delete get an empty options object", async () => {
    const calls: Call[] = [];
    const { confirm } = confirmer({ confirmed: false, result: { ran: false } }, { approvals: approvals(calls, { always: alwaysStore(calls, { ...savedAlways, fingerprint: "stale" }) }) });
    await confirm({ context, request });
    expect(calls.filter(([name]) => name.startsWith("always."))).toEqual([
      ["always.find", { serverId: "service", toolName: "send" }, {}], ["always.delete", { serverId: "service", toolName: "send" }, {}],
    ]);
  });

  test("a scope is forwarded to the always lookup and stale delete", async () => {
    const calls: Call[] = [];
    const { confirm } = confirmer({ confirmed: false, result: { ran: false } }, { scope: "s1", approvals: approvals(calls, { always: alwaysStore(calls, { ...savedAlways, fingerprint: "stale" }) }) });
    await confirm({ context, request });
    expect(calls.filter(([name]) => name.startsWith("always."))).toEqual([
      ["always.find", { serverId: "service", toolName: "send" }, { scope: "s1" }], ["always.delete", { serverId: "service", toolName: "send" }, { scope: "s1" }],
    ]);
  });

  test("a matching always grant confirms without asking or deleting", async () => {
    const calls: Call[] = [];
    const { confirm, specs } = confirmer({ confirmed: false, result: { ran: false } }, { approvals: approvals(calls, { always: alwaysStore(calls, savedAlways) }) });
    await expect(confirm({ context, request })).resolves.toEqual({ confirmed: true });
    expect(specs).toHaveLength(0);
    expect(calls.map(([name]) => name)).toEqual(["always.find"]);
  });

  test("no saved always grant falls through to the chat grant without a delete", async () => {
    const calls: Call[] = [];
    const { confirm, specs } = confirmer({ confirmed: false, result: { ran: false } }, { approvals: approvals(calls, { always: alwaysStore(calls, null), chat: chatStore(calls, true) }) });
    await expect(confirm({ context, request })).resolves.toEqual({ confirmed: true });
    expect(specs).toHaveLength(0);
    expect(calls.map(([name]) => name)).toEqual(["always.find", "chat.has"]);
  });

  test("a stale always grant is deleted and a matching chat grant still confirms", async () => {
    const calls: Call[] = [];
    const { confirm } = confirmer({ confirmed: false, result: { ran: false } }, { approvals: approvals(calls, { always: alwaysStore(calls, { ...savedAlways, fingerprint: "stale" }), chat: chatStore(calls, true) }) });
    await expect(confirm({ context, request })).resolves.toEqual({ confirmed: true });
    expect(calls.map(([name]) => name)).toEqual(["always.find", "always.delete", "chat.has"]);
    expect(calls[2]).toEqual(["chat.has", chatKey]);
  });

  test("a write-shaped call never reads either store", async () => {
    const calls: Call[] = [];
    const { confirm, specs } = confirmer({ confirmed: false, result: { ran: false } }, { approvals: approvals(calls, { always: alwaysStore(calls, savedAlways), chat: chatStore(calls, true) }) });
    await confirm({ context, request: { ...request, writeShapedInputs: ["sql"] } });
    expect(calls).toEqual([]);
    expect(specs).toHaveLength(1);
  });

  test("a preset call never reads the always store and is asked with only the chat offer", async () => {
    const calls: Call[] = [];
    const { confirm, specs } = confirmer({ confirmed: false, result: { ran: false } }, { approvals: approvals(calls, { always: alwaysStore(calls, savedAlways), chat: chatStore(calls, false) }) });
    await confirm({ context, request: { ...request, origin: { kind: "preset" } } });
    expect(calls.map(([name]) => name)).toEqual(["chat.has"]);
    expect(choices(specs[0])).toEqual(["chat"]);
  });

  test("a destructive call with a matching chat grant is asked without reading the chat store", async () => {
    const calls: Call[] = [];
    const { confirm, specs } = confirmer({ confirmed: false, result: { ran: false } }, { approvals: approvals(calls, { chat: chatStore(calls, true) }) });
    await confirm({ context, request: { ...request, destructive: true } });
    expect(calls).toEqual([]);
    expect(specs).toHaveLength(1);
  });

  test("an empty conversation id disables the chat lookup and offer", async () => {
    const calls: Call[] = [];
    const { confirm, specs } = confirmer({ confirmed: false, result: { ran: false } }, { approvals: approvals(calls, { chat: chatStore(calls, true), conversationIdForRun: () => "" }) });
    await confirm({ context, request });
    expect(calls).toEqual([]);
    expect(specs[0]?.alternatives).toBeUndefined();
  });

  test("a missing conversationIdForRun disables the chat lookup", async () => {
    const calls: Call[] = [];
    const deps: FederatedApprovalDeps = { clock: { nowMs: () => 0 }, mayAlwaysAllow: async () => true, chat: chatStore(calls, true) };
    const { confirm, specs } = confirmer({ confirmed: false, result: { ran: false } }, { approvals: deps });
    await confirm({ context, request });
    expect(calls).toEqual([]);
    expect(specs).toHaveLength(1);
  });
});

describe("offers", () => {
  test("mayAlwaysAllow gets the principal and an empty options object without a scope", async () => {
    const calls: Call[] = [];
    const { confirm, specs } = confirmer({ confirmed: false, result: { ran: false } }, { approvals: approvals(calls, { always: alwaysStore(calls, null), chat: chatStore(calls, false) }) });
    await confirm({ context, request });
    expect(calls.find(([name]) => name === "mayAlwaysAllow")).toEqual(["mayAlwaysAllow", { principalId: "person" }, {}]);
    expect(choices(specs[0])).toEqual(["chat", "always"]);
  });

  test("mayAlwaysAllow is not consulted for a destructive call", async () => {
    const calls: Call[] = [];
    const { confirm } = confirmer({ confirmed: false, result: { ran: false } }, { approvals: approvals(calls, { always: alwaysStore(calls, null) }) });
    await confirm({ context, request: { ...request, destructive: true } });
    expect(calls.map(([name]) => name)).toEqual(["always.find"]);
  });

  test("mayAlwaysAllow is not consulted for a write-shaped call", async () => {
    const calls: Call[] = [];
    const { confirm } = confirmer({ confirmed: false, result: { ran: false } }, { approvals: approvals(calls, { always: alwaysStore(calls, null) }) });
    await confirm({ context, request: { ...request, writeShapedInputs: ["sql"] } });
    expect(calls).toEqual([]);
  });

  test("mayAlwaysAllow is not consulted without an always store", async () => {
    const calls: Call[] = [];
    const { confirm } = confirmer({ confirmed: false, result: { ran: false } }, { approvals: approvals(calls, { chat: chatStore(calls, false) }) });
    await confirm({ context, request });
    expect(calls.map(([name]) => name)).toEqual(["chat.has"]);
  });
});

describe("remember", () => {
  test("a confirmed answer without a choice remembers nothing", async () => {
    const calls: Call[] = [];
    const { confirm } = confirmer({ confirmed: true }, { approvals: approvals(calls, { always: alwaysStore(calls, null), chat: chatStore(calls, false) }) });
    await expect(confirm({ context, request })).resolves.toEqual({ confirmed: true });
    expect(calls.map(([name]) => name)).toEqual(["always.find", "chat.has", "mayAlwaysAllow"]);
  });

  test("an always choice the card did not offer remembers nothing", async () => {
    const calls: Call[] = [];
    const { confirm } = confirmer({ confirmed: true, choice: "always" }, { approvals: approvals(calls, { chat: chatStore(calls, false) }) });
    await expect(confirm({ context, request })).resolves.toEqual({ confirmed: true });
    expect(calls.map(([name]) => name)).toEqual(["chat.has"]);
  });

  test("a chat choice grants the chat key at the clock time and notifies with an empty options object", async () => {
    const calls: Call[] = [];
    const events: unknown[] = [];
    const { confirm } = confirmer({ confirmed: true, choice: "chat" }, {
      approvals: approvals(calls, { chat: chatStore(calls, false) }),
      webhooks: { approvalRemembered: async (event, optional) => { events.push([event, optional]); } },
    });
    await confirm({ context, request });
    expect(calls.at(-1)).toEqual(["chat.grant", { key: chatKey, grantedAt: "1970-01-01T00:00:00.000Z" }]);
    expect(events).toEqual([[{ principalId: "person", connectionId: "service", toolName: "send", fingerprint, scope: "chat", grantedAt: "1970-01-01T00:00:00.000Z" }, {}]]);
  });

  test("an always choice upserts the grant with an empty options object without a scope", async () => {
    const calls: Call[] = [];
    const { confirm } = confirmer({ confirmed: true, choice: "always" }, { approvals: approvals(calls, { always: alwaysStore(calls, null) }) });
    await confirm({ context, request });
    expect(calls.at(-1)).toEqual(["always.upsert", { serverId: "service", toolName: "send", fingerprint, grantedByPrincipalId: "person", grantedAt: "1970-01-01T00:00:00.000Z" }, {}]);
  });

  test("an always choice upserts with the scope", async () => {
    const calls: Call[] = [];
    const { confirm } = confirmer({ confirmed: true, choice: "always" }, { scope: "s1", approvals: approvals(calls, { always: alwaysStore(calls, null) }) });
    await confirm({ context, request });
    expect(calls.at(-1)).toEqual(["always.upsert", expect.objectContaining({ fingerprint }), { scope: "s1" }]);
  });

  test("a chat store failure is reported at the store stage, skips the webhook and keeps the approval", async () => {
    const calls: Call[] = [];
    const diagnostics: FederatedApprovalDiagnostic[] = [];
    let notified = 0;
    const { confirm } = confirmer({ confirmed: true, choice: "chat" }, {
      approvals: approvals(calls, { chat: chatStore(calls, false, { failGrant: true }) }),
      webhooks: { approvalRemembered: async () => { notified++; } }, onPersistenceError: diagnostic => { diagnostics.push(diagnostic); },
    });
    await expect(confirm({ context, request })).resolves.toEqual({ confirmed: true });
    expect(diagnostics).toEqual([{ toolId: "mcp__service__send", choice: "chat", stage: "store", error: new Error("chat store down") }]);
    expect(notified).toBe(0);
  });

  test("a store failure without onPersistenceError still keeps the approval", async () => {
    const calls: Call[] = [];
    const { confirm } = confirmer({ confirmed: true, choice: "always" }, { approvals: approvals(calls, { always: alwaysStore(calls, null, { failUpsert: true }) }) });
    await expect(confirm({ context, request })).resolves.toEqual({ confirmed: true });
  });

  test("a throwing onPersistenceError cannot fail an approved call", async () => {
    const calls: Call[] = [];
    const { confirm } = confirmer({ confirmed: true, choice: "always" }, {
      approvals: approvals(calls, { always: alwaysStore(calls, null, { failUpsert: true }) }), onPersistenceError: () => { throw new Error("sink down"); },
    });
    await expect(confirm({ context, request })).resolves.toEqual({ confirmed: true });
  });

  test("a webhook failure is reported at the webhook stage", async () => {
    const calls: Call[] = [];
    const diagnostics: FederatedApprovalDiagnostic[] = [];
    const deliveryError = new Error("delivery down");
    const { confirm } = confirmer({ confirmed: true, choice: "always" }, {
      approvals: approvals(calls, { always: alwaysStore(calls, null) }),
      webhooks: { approvalRemembered: async () => { throw deliveryError; } }, onPersistenceError: diagnostic => { diagnostics.push(diagnostic); },
    });
    await expect(confirm({ context, request })).resolves.toEqual({ confirmed: true });
    expect(diagnostics).toEqual([{ toolId: "mcp__service__send", choice: "always", stage: "webhook", error: deliveryError }]);
  });
});
