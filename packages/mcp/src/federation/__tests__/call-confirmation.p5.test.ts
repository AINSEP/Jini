import { federatedToolApprovalFingerprint } from "../tool-approvals.js";
import { defaultFederationMessages } from "../messages.js";
import assert from "node:assert/strict";
import { test } from "vitest";
import { buildFederatedCallConfirmSpec, createFederatedCallConfirmer } from "../approvals/index.js";
import type { FederatedConfirmationSpec, FederatedHumanConfirmOutcome } from "../approvals/index.js";
import type { FederatedCallConfirmationRequest } from "../ports.js";
import { InMemoryExternalMcpToolApprovalRepo, createInMemoryConversationToolApprovalStore } from "../testing/tool-approvals.memory.js";

// Generalized from the call-confirmation, remembered-approvals and extra-approval-checks suites.
const request: FederatedCallConfirmationRequest = {
  toolId: "mcp__service__send", remoteName: "send", connectionId: "service", connectionLabel: "Service",
  arguments: Object.freeze({ name: "Ada" }), destructive: false, declaredAnnotations: { readOnlyHint: false },
  origin: { kind: "roster", admissionRevision: "revision-1" }, description: "Send a message.",
  inputSchema: { type: "object", properties: { name: { type: "string" } } }, writeShapedInputs: [],
};
const context = { principal: { id: "person" }, run: { id: "chat-a/1" } };
const cancelled = { confirmed: false, result: { ran: false, cancelled: true } } as const;

function harness(options: { mayAlways?: boolean; failSave?: boolean; choice?: string; notifyFails?: boolean } = {}) {
  const always = new InMemoryExternalMcpToolApprovalRepo({});
  const chat = createInMemoryConversationToolApprovalStore({});
  if (options.failSave) always.upsert = async () => { throw new Error("store unavailable"); };
  const specs: FederatedConfirmationSpec[] = [];
  const notifications: unknown[] = [], diagnostics: unknown[] = [];
  const exchanges = { identity: "host-exchanges" };
  let outcome: FederatedHumanConfirmOutcome = { confirmed: true, ...(options.choice ? { choice: options.choice } : {}) };
  const confirm = createFederatedCallConfirmer({ fingerprintDomain: "g3-approval-v2", errorCode: "EXTERNAL_MCP",
    messages: defaultFederationMessages, surfaceExchanges: exchanges,
    humanConfirm: { ask: async input => {
      assert.equal(input.surfaceExchanges, exchanges);
      specs.push(input.spec); return outcome;
    } },
  }, {
    scope: "workspace", approvals: { always, chat, clock: { nowMs: () => Date.parse("2026-01-01T00:00:00Z") },
      conversationIdForRun: ({ runId }) => runId.split("/")[0], mayAlwaysAllow: async () => options.mayAlways !== false },
    webhooks: { approvalRemembered: async input => { notifications.push(input); if (options.notifyFails) throw new Error("delivery unavailable"); } },
    onPersistenceError: input => { diagnostics.push(input); },
  });
  return { confirm, always, chat, specs, notifications, diagnostics, answer: (value: FederatedHumanConfirmOutcome) => { outcome = value; } };
}

test("card preserves exact argument values and injects branding", () => {
  const spec = buildFederatedCallConfirmSpec({ errorCode: "EXTERNAL_MCP", request: { ...request, arguments: { name: "Ada", sql: "a\nb", payload: { z: 1 }, count: 2, nil: null }, writeShapedInputs: ["sql"] }, messages: defaultFederationMessages }, { offers: { offerChat: true, offerAlways: true } });
  assert.deepEqual(spec.details, [
    { label: "Service", value: "Service" }, { label: "Tool", value: "send" },
    { label: "name", value: "Ada" }, { label: "sql", value: "a\nb", format: "code" },
    { label: "payload", value: '{\n  "z": 1\n}', format: "code" }, { label: "count", value: "2" }, { label: "nil", value: "null" },
  ]);
  assert.equal(spec.warning, "This can change things in Service. Its input sql looks like it can change data, so the host asks every time.");
  assert.equal(spec.alternatives, undefined);
});

test("card formatting preserves the inline threshold, destructive wording and no-argument row", () => {
  const long = "a".repeat(61), inline = "b".repeat(60);
  const spec = buildFederatedCallConfirmSpec({ errorCode: "EXTERNAL_MCP", request: { ...request, arguments: { long, inline } }, messages: defaultFederationMessages });
  assert.deepEqual(spec.details.slice(2), [{ label: "long", value: long, format: "code" }, { label: "inline", value: inline }]);
  const destructive = buildFederatedCallConfirmSpec({ errorCode: "EXTERNAL_MCP", request: { ...request, arguments: {}, destructive: true }, messages: defaultFederationMessages }, { offers: { offerChat: true, offerAlways: true } });
  assert.equal(destructive.title, "Run send on Service?"); assert.equal(destructive.errorCode, "EXTERNAL_MCP");
  assert.equal(destructive.warning, "Service marks this tool as destructive: it can delete or overwrite data, and that may not be undoable.");
  assert.deepEqual(destructive.details[2], { label: "Arguments", value: "(none)" });
  assert.equal(destructive.alternatives, undefined);
});

test("human confirmation remains pending until the host answers, with identical request values", async () => {
  let answer!: (outcome: FederatedHumanConfirmOutcome) => void;
  let readySignal!: () => void;
  const ready = new Promise<void>(resolve => { readySignal = resolve; });
  let settled = false;
  const confirm = createFederatedCallConfirmer({ fingerprintDomain: "g3-approval-v2", errorCode: "EXTERNAL_MCP", messages: defaultFederationMessages, surfaceExchanges: {}, humanConfirm: { ask: async ({ spec }) => {
    assert.equal(spec.details[2]!.value, "Ada"); readySignal();
    return new Promise<FederatedHumanConfirmOutcome>(resolve => { answer = resolve; });
  } } });
  const pending = confirm({ context, request }).then(value => { settled = true; return value; });
  await ready; assert.equal(settled, false);
  answer({ confirmed: true }); assert.deepEqual(await pending, { confirmed: true });
});

test("allow once and cancel never save a remembered grant", async () => {
  const h = harness();
  assert.deepEqual(await h.confirm({ context, request }), { confirmed: true });
  h.answer(cancelled);
  assert.deepEqual(await h.confirm({ context, request }), cancelled);
  assert.equal(h.specs.length, 2); assert.deepEqual(await h.always.listByScope({}, { scope: "workspace" }), []);
  assert.deepEqual(h.notifications, []);
});

test("chat grants bind principal, conversation, tool and fingerprint", async () => {
  const h = harness({ choice: "chat" });
  await h.confirm({ context, request }); await h.confirm({ context, request });
  assert.equal(h.specs.length, 1);
  await h.confirm({ context: { ...context, run: { id: "chat-b/1" } }, request });
  assert.equal(h.specs.length, 2);
  await h.confirm({ context, request: { ...request, remoteName: "other" } });
  await h.confirm({ context, request: { ...request, description: "Changed." } });
  assert.equal(h.specs.length, 4);
  await h.confirm({ context: { ...context, principal: { id: "other" } }, request });
  assert.equal(h.specs.length, 5);
});

test("always grant crosses chats, pins the identity and is revoked by deletion", async () => {
  const h = harness({ choice: "always" });
  await h.confirm({ context, request });
  const row = (await h.always.listByScope({}, { scope: "workspace" }))[0]!;
  assert.equal(row.grantedAt, "2026-01-01T00:00:00.000Z"); assert.equal(row.grantedByPrincipalId, "person");
  await h.confirm({ context: { ...context, run: { id: "chat-b/1" } }, request });
  assert.equal(h.specs.length, 1); assert.equal(h.notifications.length, 1);
  await h.always.delete({ serverId: "service", toolName: "send" }, { scope: "workspace" });
  h.answer(cancelled); await h.confirm({ context, request }); assert.equal(h.specs.length, 2);
});

for (const drift of [ { description: "Changed." }, { inputSchema: { type: "object", properties: {} } }, { declaredAnnotations: { readOnlyHint: true } }, { origin: { kind: "roster", admissionRevision: "revision-2" } } ] as const) {
  test(`identity drift ${JSON.stringify(drift)} removes stale always approval`, async () => {
    const h = harness({ choice: "always" }); await h.confirm({ context, request });
    h.answer(cancelled); await h.confirm({ context, request: { ...request, ...drift } });
    assert.equal(h.specs.length, 2); assert.deepEqual(await h.always.listByScope({}, { scope: "workspace" }), []);
  });
}

test("write-shaped calls ignore matching remembered grants and forged remember choices", async () => {
  const h = harness({ choice: "always" }); await h.confirm({ context, request });
  await h.confirm({ context, request: { ...request, writeShapedInputs: ["sql"] } });
  assert.equal(h.specs.length, 2); assert.equal(h.specs[1]!.alternatives, undefined);
  assert.equal(h.notifications.length, 1);
});

test("destructive, preset and unauthorized cards cannot save a forged always choice", async () => {
  for (const [h, call] of [
    [harness(), { ...request, destructive: true }],
    [harness(), { ...request, origin: { kind: "preset" } }],
    [harness({ mayAlways: false }), request],
  ] as const) {
    h.answer({ confirmed: true, choice: "always" }); await h.confirm({ context, request: call });
    assert.ok(!h.specs[0]!.alternatives?.some(choice => choice.choice === "always"));
    assert.deepEqual(await h.always.listByScope({}, { scope: "workspace" }), []);
  }
});

test("save and notification failures retain explicit approval for this call", async () => {
  for (const options of [{ failSave: true }, { notifyFails: true }]) {
    const h = harness({ ...options, choice: "always" });
    assert.deepEqual(await h.confirm({ context, request }), { confirmed: true });
    assert.equal(h.diagnostics.length, 1);
    if (options.failSave) { await h.confirm({ context, request }); assert.equal(h.specs.length, 2); }
  }
});

test("a matching always grant is invalid for a destructive call and is removed", async () => {
  const h = harness({ choice: "always" }); await h.confirm({ context, request });
  h.answer(cancelled); await h.confirm({ context, request: { ...request, destructive: true } });
  assert.equal(h.specs[1]!.danger, true);
  assert.ok(!h.specs[1]!.alternatives?.some(alternative => alternative.choice === "always"));
  assert.deepEqual(await h.always.listByScope({}, { scope: "workspace" }), []);
});

// REGRESSION: fails if isRemembered returns a matching chat grant for a destructive request.
test("destructive calls ignore matching chat grants and ask on every invocation", async () => {
  const h = harness({ choice: "chat" });
  const destructive = { ...request, destructive: true };
  const fingerprint = federatedToolApprovalFingerprint({ identity: destructive, fingerprintDomain: "g3-approval-v2" });
  await h.chat.grant({ key: { conversationId: "chat-a", principalId: "person", connectionId: "service", toolName: "send", fingerprint }, grantedAt: "2026-01-01T00:00:00.000Z" });
  h.answer(cancelled);
  assert.deepEqual(await h.confirm({ context, request: destructive }), cancelled);
  assert.deepEqual(await h.confirm({ context, request: destructive }), cancelled);
  assert.equal(h.specs.length, 2);
  assert.ok(h.specs.every(spec => spec.alternatives === undefined && spec.danger));
  assert.deepEqual(h.notifications, []);
});

// REGRESSION: fails if buildFederatedCallConfirmSpec restores the write-shaped-only alternatives guard.
test("a forged chat choice for permanent deletion never becomes a remembered grant", async () => {
  const h = harness({ choice: "chat" });
  const destructive = { ...request, destructive: true };
  assert.equal(buildFederatedCallConfirmSpec({ request: destructive, messages: defaultFederationMessages, errorCode: "EXTERNAL_MCP" },
    { offers: { offerChat: true, offerAlways: true } }).alternatives, undefined);
  await h.confirm({ context, request: destructive });
  await h.confirm({ context, request: destructive });
  assert.equal(h.specs.length, 2);
  assert.equal(h.specs[0]!.alternatives, undefined);
  assert.deepEqual(h.notifications, []);
  assert.equal(await h.chat.has({ conversationId: "chat-a", principalId: "person", connectionId: "service", toolName: "send",
    fingerprint: federatedToolApprovalFingerprint({ identity: destructive, fingerprintDomain: "g3-approval-v2" }) }), false);
});

test("remembered-store lookup failures fail closed before asking or granting", async () => {
  const h = harness();
  h.always.find = async () => { throw new Error("lookup unavailable"); };
  await assert.rejects(() => h.confirm({ context, request }), /lookup unavailable/);
  assert.equal(h.specs.length, 0); assert.equal(h.notifications.length, 0);
});

test("missing stores or conversation never offer a scope the host cannot persist", async () => {
  const specs: FederatedConfirmationSpec[] = [];
  const required = { fingerprintDomain: "g3-approval-v2", errorCode: "EXTERNAL_MCP", messages: defaultFederationMessages, surfaceExchanges: {}, humanConfirm: { ask: async ({ spec }: { spec: FederatedConfirmationSpec }) => {
    specs.push(spec); return { confirmed: true, choice: "chat" } as const;
  } } };
  const noStores = createFederatedCallConfirmer(required);
  await noStores({ context, request }); assert.equal(specs[0]!.alternatives, undefined);
  const noConversation = createFederatedCallConfirmer({ ...required, fingerprintDomain: "g3-approval-v2", errorCode: "EXTERNAL_MCP" }, { approvals: {
    clock: { nowMs: () => Date.parse("2026-01-01") }, mayAlwaysAllow: async () => false,
    chat: { has: async () => { throw new Error("unexpected lookup"); }, grant: async () => { throw new Error("unexpected save"); } },
    conversationIdForRun: () => undefined,
  } });
  await noConversation({ context, request }); assert.equal(specs[1]!.alternatives, undefined);
});

for (const reason of ["expired", "abandoned"]) test(`host ${reason} result is preserved without saving`, async () => {
  const h = harness({ choice: "always" });
  const outcome = { confirmed: false, result: { ran: false, reason } } as const;
  h.answer(outcome); assert.deepEqual(await h.confirm({ context, request }), outcome);
  assert.deepEqual(await h.always.listByScope({}, { scope: "workspace" }), []);
});

// REGRESSION: fails if buildFederatedCallConfirmSpec restores the hardcoded wire error code.
test("host error namespace and confirmation wording are used verbatim", () => {
  const spec = buildFederatedCallConfirmSpec({ request, errorCode: "HOST_APPROVAL", messages: {
    ...defaultFederationMessages, confirmationTitle: () => "Host approval", confirmationWarning: () => "Host warning",
  } });
  assert.equal(spec.errorCode, "HOST_APPROVAL"); assert.equal(spec.title, "Host approval"); assert.equal(spec.warning, "Host warning");
});
// REGRESSION: fails if approvalRemembered omits the optional opaque scope.
test("remember events retain approval duration separately from the host partition", async () => {
  const events: unknown[] = [];
  const confirm = createFederatedCallConfirmer({ fingerprintDomain: "host-v2", errorCode: "HOST_APPROVAL",
    messages: defaultFederationMessages, surfaceExchanges: {}, humanConfirm: { ask: async () => ({ confirmed: true, choice: "always" }) } }, {
    scope: "tenant:/opaque", approvals: { always: new InMemoryExternalMcpToolApprovalRepo({}), clock: { nowMs: () => 0 },
      mayAlwaysAllow: async (input, optional) => { assert.deepEqual(input, { principalId: "person" });
        assert.deepEqual(optional, { scope: "tenant:/opaque" }); return true; } },
    webhooks: { approvalRemembered: async (event, optional) => { events.push({ event, optional }); } },
  });
  await confirm({ context, request });
  assert.deepEqual(events, [{ event: { principalId: "person", connectionId: "service", toolName: "send",
    fingerprint: federatedToolApprovalFingerprint({ identity: request, fingerprintDomain: "host-v2" }), scope: "always", grantedAt: "1970-01-01T00:00:00.000Z" },
    optional: { scope: "tenant:/opaque" } }]);
});
