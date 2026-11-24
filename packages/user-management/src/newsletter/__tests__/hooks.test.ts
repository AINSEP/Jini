/**
 * @file T032 — failing-first tests for `runHookChain` (REQ-23, EC-01, behavior.spec.md §1.3/§7).
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import { createHookRegistry } from "../hooks.js";
import type { OutboundEmail } from "@jini-ai/core/contracts/mail";

const baseMessage: OutboundEmail = {
  workspaceId: "ws-1",
  to: { email: "a@a.test" },
  from: { email: "no-reply@newsletter.local" },
  subject: "Hello",
  text: "hi",
};

const recipientFilterContext = {
  workspaceId: "ws-1",
  campaignId: "camp-1",
  listId: "list-1",
  subscriberId: "subscriber-1",
  recipientEmail: "a@a.test",
  status: "subscribed" as const,
};
const beforeSendContext = { workspaceId: "ws-1", campaignId: "camp-1", sendId: "send-1", subscriberId: "subscriber-1" };

test("runHookChain: beforeSend never runs for a row recipient.filter suppressed (EC-01, post-freeze unsubscribe case)", async () => {
  const registry = createHookRegistry();
  let beforeSendCalled = false;
  registry.registerRecipientFilterHook({ hook: () => false }); // suppress
  registry.registerBeforeSendHook({ hook: (_ctx, message) => {
    beforeSendCalled = true;
    return message;
  } });

  const result = await registry.runHookChain({ recipientFilterContext, beforeSendContext, message: baseMessage });
  assert.equal(result.keep, false);
  assert.equal(beforeSendCalled, false, "beforeSend must never run for a suppressed row");
});

test("runHookChain: a kept row runs beforeSend and returns the transformed message", async () => {
  const registry = createHookRegistry();
  registry.registerRecipientFilterHook({ hook: (ctx) => {
    assert.deepEqual(ctx, recipientFilterContext);
    return true;
  } });
  registry.registerBeforeSendHook({ hook: (ctx, message) => {
    assert.deepEqual(ctx, beforeSendContext);
    return { ...message, subject: "Transformed", text: `${message.text} footer` };
  } });
  registry.registerBeforeSendHook({ hook: (ctx, message) => {
    assert.deepEqual(ctx, beforeSendContext);
    assert.equal(message.subject, "Transformed");
    assert.equal(message.text, "hi footer");
    return { ...message, text: `${message.text} unsubscribe` };
  } });

  const result = await registry.runHookChain({ recipientFilterContext, beforeSendContext, message: baseMessage });
  assert.equal(result.keep, true);
  assert.equal(result.keep === true ? result.message.subject : "", "Transformed");
  assert.deepEqual(result.keep ? result.message : null, { ...baseMessage, subject: "Transformed", text: "hi footer unsubscribe" });
});

test("runHookChain: a throwing recipient.filter hook is fail-closed suppression, never 'keep by default' (behavior.spec §7)", async () => {
  const registry = createHookRegistry();
  registry.registerRecipientFilterHook({ hook: () => {
    throw new Error("boom");
  } });
  const result = await registry.runHookChain({ recipientFilterContext, beforeSendContext, message: baseMessage });
  assert.equal(result.keep, false);
});

test("runHookChain: a throwing beforeSend hook is also fail-closed suppression", async () => {
  const registry = createHookRegistry();
  registry.registerRecipientFilterHook({ hook: () => true });
  registry.registerBeforeSendHook({ hook: () => {
    throw new Error("boom");
  } });
  const result = await registry.runHookChain({ recipientFilterContext, beforeSendContext, message: baseMessage });
  assert.equal(result.keep, false);
});

test("runHookChain: with no hooks registered, the message passes through kept and unmodified", async () => {
  const registry = createHookRegistry();
  const result = await registry.runHookChain({ recipientFilterContext, beforeSendContext, message: baseMessage });
  assert.equal(result.keep, true);
  assert.deepEqual(result.keep === true ? result.message : null, baseMessage);
});

test("runHookChain: multiple recipient.filter hooks — any single suppress wins, subsequent filters don't override it back to keep", async () => {
  const registry = createHookRegistry();
  registry.registerRecipientFilterHook({ hook: () => true });
  registry.registerRecipientFilterHook({ hook: () => false });
  registry.registerRecipientFilterHook({ hook: () => true });
  const result = await registry.runHookChain({ recipientFilterContext, beforeSendContext, message: baseMessage });
  assert.equal(result.keep, false);
});

test("runHookChain: asynchronous suppression and transformations are awaited", async () => {
  const suppressed = createHookRegistry();
  let beforeSendCalled = false;
  suppressed.registerRecipientFilterHook({ hook: async () => { await Promise.resolve(); return false; } });
  suppressed.registerBeforeSendHook({ hook: () => { beforeSendCalled = true; return baseMessage; } });
  assert.equal((await suppressed.runHookChain({ recipientFilterContext, beforeSendContext, message: baseMessage })).keep, false);
  assert.equal(beforeSendCalled, false);

  const kept = createHookRegistry();
  kept.registerRecipientFilterHook({ hook: async () => { await Promise.resolve(); return true; } });
  kept.registerBeforeSendHook({ hook: async (_ctx, message) => { await Promise.resolve(); return { ...message, text: "async footer" }; } });
  kept.registerBeforeSendHook({ hook: (_ctx, message) => ({ ...message, text: `${message.text} unsubscribe` }) });
  const result = await kept.runHookChain({ recipientFilterContext, beforeSendContext, message: baseMessage });
  assert.equal(result.keep, true);
  assert.deepEqual(result.keep ? result.message : null, { ...baseMessage, text: "async footer unsubscribe" });
});

test("runHookChain: non-subscribed recipients are suppressed even with no registered filter", async () => {
  for (const status of ["pending", "unsubscribed", "bounced", "complained"] as const) {
    const registry = createHookRegistry();
    let beforeSendCalled = false;
    registry.registerBeforeSendHook({ hook: (_ctx, message) => { beforeSendCalled = true; return message; } });
    const result = await registry.runHookChain({ recipientFilterContext: { ...recipientFilterContext, status }, beforeSendContext, message: baseMessage });
    assert.equal(result.keep, false, status);
    assert.equal(beforeSendCalled, false, "suppression must precede beforeSend");
  }
});
