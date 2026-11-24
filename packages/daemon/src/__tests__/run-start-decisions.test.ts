import assert from "node:assert/strict";
import { describe, test } from "vitest";

import {
  agentReceivesImageAttachments, durableAttemptOwnsAnswer, resolveStoredSessionId, selectRunHistoryPrompt,
} from "../run-start-decisions.js";

describe("resolveStoredSessionId", () => {
  test("an ordinary turn resumes the conversation's stored session", () => {
    assert.equal(resolveStoredSessionId({ recoveryMode: undefined, recoverySessionId: "recovered", priorSessionId: "stored" }, {}), "stored");
  });

  test("reconstruction never resumes, even with a stored or recovery session", () => {
    assert.equal(resolveStoredSessionId({ recoveryMode: "reconstruction", recoverySessionId: "recovered", priorSessionId: "stored" }, {}), null);
  });

  test("native recovery resumes the recovery session over the stored one", () => {
    assert.equal(resolveStoredSessionId({ recoveryMode: "native", recoverySessionId: "recovered", priorSessionId: "stored" }, {}), "recovered");
  });

  test("native recovery without a recovery session resumes nothing", () => {
    assert.equal(resolveStoredSessionId({ recoveryMode: "native", recoverySessionId: undefined, priorSessionId: "stored" }, {}), null);
  });
});

describe("agentReceivesImageAttachments", () => {
  for (const [label, def, expected] of [
    ["native image delivery", { imageDelivery: "native" }, true],
    ["prompt-path image delivery", { imageDelivery: "prompt-path" }, true],
    ["a stream-json prompt", { imageDelivery: "unsupported", promptInputFormat: "stream-json" }, true],
    ["unsupported delivery with a text prompt", { imageDelivery: "unsupported", promptInputFormat: "text" }, false],
    ["a definition naming neither", {}, false],
    ["an unknown agent", null, false],
    ["an absent definition", undefined, false],
  ] as const) {
    test(`${label} → ${expected}`, () => {
      assert.equal(agentReceivesImageAttachments({ def }, {}), expected);
    });
  }
});

describe("durableAttemptOwnsAnswer", () => {
  for (const runStatus of ["queued", "running"] as const) {
    test(`an uncancelled ${runStatus} attempt owns its answer`, () => {
      assert.equal(durableAttemptOwnsAnswer({ attempt: { cancelReason: null, message: { runStatus } } }, {}), true);
    });
  }

  test("a missing attempt does not own its answer", () => {
    assert.equal(durableAttemptOwnsAnswer({ attempt: null }, {}), false);
  });

  test("a cancelled attempt does not own its answer even while running", () => {
    assert.equal(durableAttemptOwnsAnswer({ attempt: { cancelReason: "user-stop", message: { runStatus: "running" } } }, {}), false);
  });

  for (const runStatus of ["succeeded", "failed", "canceled", undefined] as const) {
    test(`an attempt whose message is ${String(runStatus)} does not own its answer`, () => {
      assert.equal(durableAttemptOwnsAnswer({ attempt: { cancelReason: null, message: { runStatus } } }, {}), false);
    });
  }
});

describe("selectRunHistoryPrompt", () => {
  const base = { prompt: "tail", coldStartContext: "transcript", resumeSessionId: undefined, carriesOwnMemory: true };

  test("a memory-carrying cold start takes the full cold-start context", () => {
    assert.equal(selectRunHistoryPrompt(base, {}), "transcript");
  });

  test("a resumed turn keeps the tail prompt", () => {
    assert.equal(selectRunHistoryPrompt({ ...base, resumeSessionId: "session" }, {}), "tail");
  });

  test("a cold start without a cold-start context keeps the tail prompt", () => {
    assert.equal(selectRunHistoryPrompt({ ...base, coldStartContext: undefined }, {}), "tail");
  });

  test("an agent without its own memory keeps the tail prompt", () => {
    assert.equal(selectRunHistoryPrompt({ ...base, carriesOwnMemory: false }, {}), "tail");
  });
});
