/**
 * @file T015 — failing-first tests for `evaluateLaunchGate` (T018, CERTIFIED FIRST in Phase 2).
 * behavior.spec.md §1.2, REQ-21, INV-05, EC-05, EC-10.
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import { evaluateLaunchGate, type LaunchGateDeps } from "../launch-gate.js";
import type { MailerCapabilities } from "@jini-ai/core/contracts/mail";

const WS = "ws-1";

function makeDeps(overrides: Partial<{
  sendingEnabled: boolean;
  consentBound: boolean;
  originThrows: boolean;
  mailerDriver: string;
}> = {}): LaunchGateDeps {
  const { sendingEnabled = true, consentBound = true, originThrows = false, mailerDriver = "smtp" } = overrides;
  return {
    isSendingEnabled: async (workspaceId) => {
      assert.equal(workspaceId, WS, "the gate must read the requested workspace's setting");
      return sendingEnabled;
    },
    consentCapability: consentBound
      ? { request: async () => ({ requested: true }), confirm: async () => ({ status: "granted", consentRevisionId: "r1" }), revoke: async () => ({ status: "revoked" }) }
      : null,
    originRegistry: {
      canonicalOrigin: async () => {
        if (originThrows) throw new Error("no verified origin");
        return { scheme: "https" as const, host: "acme.test", verifiedAt: "2026-07-13T00:00:00.000Z", source: "workspace-setting" as const };
      },
      isAllowedRedirectTarget: async () => true,
      isAllowedEgressTarget: async () => true,
    },
    mailer: {
      capabilities: (): MailerCapabilities => ({
        driver: mailerDriver,
        supportsIdempotencyKey: true,
        supportsWebhookFeedback: true,
        maxBatchSize: 100,
        supportsAttachments: false,
      }),
      send: async () => ({ ok: true, providerMessageId: "m1", acceptedAt: "2026-01-01T00:00:00.000Z" }),
      sendBatch: async () => [],
    },
  };
}

test("evaluateLaunchGate: all four preconditions met -> gate reports met (AC-30)", async () => {
  const result = await evaluateLaunchGate({ deps: makeDeps(), workspaceId: WS, isTestSend: false });
  assert.equal(result.met, true);
  assert.deepEqual(result.unmetPreconditions, []);
});

test("evaluateLaunchGate: conflicting workspace settings are evaluated independently", async () => {
  const deps = makeDeps();
  const requested: string[] = [];
  deps.isSendingEnabled = async (workspaceId) => {
    requested.push(workspaceId);
    assert.ok([WS, "ws-disabled"].includes(workspaceId), "unexpected workspace");
    return workspaceId === WS;
  };
  assert.deepEqual(await evaluateLaunchGate({ deps, workspaceId: "ws-disabled", isTestSend: false }), { met: false, unmetPreconditions: ["sending_enabled_false"] });
  assert.deepEqual(await evaluateLaunchGate({ deps, workspaceId: WS, isTestSend: false }), { met: true, unmetPreconditions: [] });
  assert.deepEqual(requested, ["ws-disabled", WS]);
});

test("evaluateLaunchGate: (a) sending_enabled=false + (c) origin unresolved -> BOTH named, fixed order (AC-27/28/29 combo)", async () => {
  const result = await evaluateLaunchGate({
    deps: makeDeps({ sendingEnabled: false, originThrows: true }),
    workspaceId: WS,
    isTestSend: false,
  });
  assert.equal(result.met, false);
  assert.deepEqual(result.unmetPreconditions, ["sending_enabled_false", "origin_not_verified"]);
});

test("evaluateLaunchGate: (b) consent unbound + (d) console mailer -> BOTH named, fixed order", async () => {
  const result = await evaluateLaunchGate({
    deps: makeDeps({ consentBound: false, mailerDriver: "console" }),
    workspaceId: WS,
    isTestSend: false,
  });
  assert.equal(result.met, false);
  assert.deepEqual(result.unmetPreconditions, ["consent_capability_unbound", "mailer_adapter_not_production"]);
});

test("evaluateLaunchGate: (a) + (b) unmet -> both named in fixed order, never short-circuited to just one", async () => {
  const result = await evaluateLaunchGate({
    deps: makeDeps({ sendingEnabled: false, consentBound: false }),
    workspaceId: WS,
    isTestSend: false,
  });
  assert.deepEqual(result.unmetPreconditions, ["sending_enabled_false", "consent_capability_unbound"]);
});

test("evaluateLaunchGate: (c) + (d) unmet -> both named in fixed order", async () => {
  const result = await evaluateLaunchGate({
    deps: makeDeps({ originThrows: true, mailerDriver: "memory" }),
    workspaceId: WS,
    isTestSend: false,
  });
  assert.deepEqual(result.unmetPreconditions, ["origin_not_verified", "mailer_adapter_not_production"]);
});

test("evaluateLaunchGate: all four unmet -> all four named, fixed (a)->(d) order", async () => {
  const result = await evaluateLaunchGate({
    deps: makeDeps({ sendingEnabled: false, consentBound: false, originThrows: true, mailerDriver: "memory" }),
    workspaceId: WS,
    isTestSend: false,
  });
  assert.deepEqual(result.unmetPreconditions, [
    "sending_enabled_false",
    "consent_capability_unbound",
    "origin_not_verified",
    "mailer_adapter_not_production",
  ]);
});

test("evaluateLaunchGate: isTestSend=true waives (a)/(b) — (c)/(d) met -> gate reports met (AC-31)", async () => {
  const result = await evaluateLaunchGate({
    deps: makeDeps({ sendingEnabled: false, consentBound: false }),
    workspaceId: WS,
    isTestSend: true,
  });
  assert.equal(result.met, true);
  assert.deepEqual(result.unmetPreconditions, []);
});

test("evaluateLaunchGate: isTestSend=true with NO verified origin -> still blocked, (c) never waived (EC-10)", async () => {
  const result = await evaluateLaunchGate({
    deps: makeDeps({ sendingEnabled: false, consentBound: false, originThrows: true }),
    workspaceId: WS,
    isTestSend: true,
  });
  assert.equal(result.met, false);
  assert.deepEqual(result.unmetPreconditions, ["origin_not_verified"]);
});

test("evaluateLaunchGate: isTestSend=true with a console mailer -> still blocked, (d) never waived", async () => {
  const result = await evaluateLaunchGate({
    deps: makeDeps({ mailerDriver: "console" }),
    workspaceId: WS,
    isTestSend: true,
  });
  assert.equal(result.met, false);
  assert.deepEqual(result.unmetPreconditions, ["mailer_adapter_not_production"]);
});
