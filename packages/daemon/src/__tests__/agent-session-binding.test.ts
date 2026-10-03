// Characterization assertions copied and generalized from server/inbound/assistant/__tests__/agent-session-binding.unit.test.ts
import assert from "node:assert/strict";
import { test, describe } from "vitest";

import { AGENT_DEFS } from "@jini-ai/agent-runtime";

import {
  agentAcceptsHostMintedSessionId,
  resolveHostMintedSessionId,
  resolveNewSessionField,
} from "./session-fixture.js";

describe("agentAcceptsHostMintedSessionId — which defs the host may mint a session id for", () => {
  test("claude accepts a host-minted session id", () => {

    assert.equal(agentAcceptsHostMintedSessionId("claude"), true);
  });

  test("codex does NOT — it is capture-style, the CLI mints its own id", () => {

    assert.equal(agentAcceptsHostMintedSessionId("codex"), false);
  });

  test("opencode does NOT — also capture-style", () => {
    assert.equal(agentAcceptsHostMintedSessionId("opencode"), false);
  });

  test("amr does NOT — ACP `session/load` resume, whose handle is the ACP session, not a CLI flag", () => {
    assert.equal(agentAcceptsHostMintedSessionId("amr"), false);
  });

  test("an unknown agent id does NOT — fails closed, same default as agentCarriesOwnMemory", () => {
    assert.equal(agentAcceptsHostMintedSessionId("not-a-real-agent"), false);
  });

  test("every def this returns true for actually consumes newSessionId in its own buildArgs", () => {

    const accepted = AGENT_DEFS.filter((def) => agentAcceptsHostMintedSessionId(def.id));
    assert.ok(accepted.length > 0, "no def accepts a host-minted session id — the predicate cannot be exercised at all");
    for (const def of accepted) {
      const args = def.buildArgs({ prompt: "hi", imagePaths: [] }, { extraAllowedDirs: [], options: {}, runtimeContext: { newSessionId: "minted-abc" } });
      assert.ok(
        args.includes("minted-abc"),
        `def "${def.id}" is claimed to accept a host-minted session id but its buildArgs never puts it on the command line`,
      );
    }
  });
});

describe("resolveHostMintedSessionId — when a fresh id is minted at dispatch", () => {
  const mint = (): string => "minted-1";

  test("mints on a cold start for a specify-style agent in a known conversation", () => {
    assert.equal(
      resolveHostMintedSessionId({
        conversationId: "conv-1",
        effectiveResumeSessionId: null,
        acceptsHostMintedSessionId: true,
        mint,
      }),
      "minted-1",
    );
  });

  test("does not mint when this run is resuming — the stored id already binds the conversation", () => {
    assert.equal(
      resolveHostMintedSessionId({
        conversationId: "conv-1",
        effectiveResumeSessionId: "stored-9",
        acceptsHostMintedSessionId: true,
        mint,
      }),
      null,
    );
  });

  test("does not mint for a capture-style agent — the CLI owns the id", () => {
    assert.equal(
      resolveHostMintedSessionId({
        conversationId: "conv-1",
        effectiveResumeSessionId: null,
        acceptsHostMintedSessionId: false,
        mint,
      }),
      null,
    );
  });

  test("does not mint without a conversation id — there is nothing to file the binding under", () => {

    assert.equal(
      resolveHostMintedSessionId({
        conversationId: undefined,
        effectiveResumeSessionId: null,
        acceptsHostMintedSessionId: true,
        mint,
      }),
      null,
    );
  });

  test("mints a DISTINCT id per call — two cold conversations must not share one CLI session", () => {
    let n = 0;
    const counting = (): string => {
      n += 1;
      return `minted-${n}`;
    };
    const input = { conversationId: "conv-1", effectiveResumeSessionId: null, acceptsHostMintedSessionId: true } as const;
    assert.equal(resolveHostMintedSessionId({ ...input, mint: counting }), "minted-1");
    assert.equal(resolveHostMintedSessionId({ ...input, mint: counting }), "minted-2");
  });
});

describe("resolveNewSessionField — the AgentExecutor.run() spread", () => {
  test("carries the minted id", () => {
    assert.deepEqual(resolveNewSessionField("minted-1"), { newSessionId: "minted-1" });
  });

  test("is an EMPTY object for null — not `{ newSessionId: undefined }`", () => {

    const field = resolveNewSessionField(null);
    assert.deepEqual(field, {});
    assert.equal("newSessionId" in field, false);
  });
});
