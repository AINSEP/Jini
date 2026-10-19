import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../../core/index.js";
import type { DurableRun, DurableRunStore, RecoveryPorts, RunProbe } from "../../../core/durable-runs/ports.js";
import { translateRunFrame } from "../../../core/run-events/entry.js";
import { notices } from "../../../core/run-events/__tests__/fixture.js";
import { AWAITING_ANSWER_NOTICE, createDurableRecovery, EXHAUSTED_NOTICE, RECOVERY_LIMIT, RUN_STALENESS_MS, SAVED_WORK_NOTICE } from "../recover.js";

const TIME = 1_790_000_000_000;
// Raw stdout that quotes a tool description, as the luvira incident's leaked echo tail did.
const TOOL_PROSE: AgentEvent = { kind: "raw", line: 'description":"Starts an OAuth authorization for an already-saved, OAuth-authenticated server"}]}\n' };

function harness({ events, probe, content = "", run = {} }: { events: AgentEvent[]; probe: RunProbe; content?: string; run?: Partial<DurableRun> }) {
  let current: DurableRun = {
    messageId: "answer", conversationId: "chat", runId: "old", workspaceId: "ws", principalId: "admin", engine: "daemon",
    request: { agentId: "claude", contextRef: JSON.stringify({ prompt: "Import my site", conversationId: "chat" }) },
    message: { id: "answer", role: "assistant", runId: "old", runStatus: "running", content, events },
    transcript: [{ id: "question", role: "user", content: "Import my site" }],
    recoveryCount: 0, recoveryDeadline: null, attemptStartedAt: TIME, lastProgressAt: TIME,
    cancelReason: null, sessionId: null, sessionConfirmed: false, child: null, attemptBase: [],
    ...run,
  };
  const settlements: Parameters<RecoveryPorts["settle"]>[0][] = [];
  const attached: string[] = [];
  const canceled: string[] = [];
  const launches: Parameters<RecoveryPorts["launch"]>[0][] = [];
  const store = {
    async load() { return current; },
    async advance(input: Parameters<DurableRunStore["advance"]>[0]) {
      current = { ...current, runId: input.nextRunId, recoveryCount: current.recoveryCount + 1,
        attemptBase: input.events, message: { ...current.message, runId: input.nextRunId, events: [...input.events] } };
      return true;
    },
    async recoveryClock() {},
  } as unknown as DurableRunStore;
  const ports: RecoveryPorts = {
    store, now: () => TIME + 20_000, mintRunId: () => "next",
    probe: async () => probe, attach: (run) => { attached.push(run.runId); },
    launch: async (input) => { launches.push(input); }, cancelAttempt: async (run) => { canceled.push(run.runId); },
    verifyChildDead: async () => false, supportsNativeResume: () => true,
    async settle(value) { settlements.push(value); current = { ...current, message: { ...current.message, runStatus: value.status } }; return true; },
  };
  const info: unknown[][] = [];
  const logger = { info: (...args: unknown[]) => { info.push(args); } };
  return { recovery: createDurableRecovery(ports, { logger }), settlements, attached, canceled, launches, info };
}

describe("durable recovery: plugin Ask state belongs to the logical turn", () => {
  it.each(['boot', 'attempt-failed'] as const)('ends a dead preflight with its pending card on %s instead of asking again', async trigger => {
    const card: AgentEvent = { kind: 'ext', name: 'mcp-ui', data: { type: 'resource', resource: { uri: 'ui://pending' } } };
    const h = harness({ probe: 'dead', events: [card, { kind: 'status', label: 'Stopped by inactivity watchdog' }] });
    expect(await h.recovery.recover({ messageId: 'answer', trigger }, {})).toBe('finalized');
    expect(h.launches).toEqual([]);
    expect(h.settlements).toHaveLength(1);
    expect(h.settlements[0]!.events).toEqual([card, { kind: 'status', label: 'Stopped by inactivity watchdog' }, { kind: 'status', label: AWAITING_ANSWER_NOTICE }]);
    expect(await h.recovery.recover({ messageId: 'answer', trigger: 'browser' }, {})).toBe('terminal');
    expect(h.settlements).toHaveLength(1);
  });

  it('continues after an answered preflight instead of treating its old card as pending', async () => {
    const h = harness({ probe: 'dead', events: [
      { kind: 'ext', name: 'mcp-ui', data: { type: 'resource' } },
      { kind: 'ext', name: 'agent_plugins', data: { conversationId: 'chat', state: { decision: { selected: [], asked: true }, excluded: ['theme'] }, plugins: [] } },
    ] });
    expect(await h.recovery.recover({ messageId: 'answer', trigger: 'boot' }, {})).toBe('continued');
    expect(h.launches).toHaveLength(1);
    expect(h.settlements).toEqual([]);
  });

  it('does not retain a preflight wait after the model has executed and completed a tool', async () => {
    const h = harness({ probe: 'dead', events: [
      { kind: 'ext', name: 'mcp-ui', data: { type: 'resource' } },
      { kind: 'tool_use', id: 'read', name: 'read', input: {} },
      { kind: 'tool_result', toolUseId: 'read', content: 'Done', isError: false },
    ] });
    expect(await h.recovery.recover({ messageId: 'answer', trigger: 'boot' }, {})).toBe('continued');
    expect(h.launches).toHaveLength(1);
    expect(h.settlements).toEqual([]);
  });

  it.each([{ selected: ['theme'] }, { selected: [] }])("carries the saved selection $selected into a replacement attempt", async ({ selected }) => {
    const state = { decision: { selected, asked: true }, excluded: selected.length ? ['design'] : ['theme', 'design'] };
    const usage = (conversationId: string, value: typeof state): AgentEvent => ({ kind: 'ext', name: 'agent_plugins', data: { conversationId, state: value, plugins: [] } });
    const h = harness({ probe: 'dead', events: [
      usage('chat', { decision: { selected: ['obsolete'], asked: true }, excluded: [] }),
      usage('chat', state),
      usage('another-chat', { decision: { selected: ['foreign'], asked: true }, excluded: [] }),
      { kind: 'status', label: 'starting_model' },
    ], run: { request: { agentId: 'claude', contextRef: JSON.stringify({ prompt: 'Design', agentPluginState: { decision: null, excluded: [] } }) } } });
    expect(await h.recovery.recover({ messageId: 'answer', trigger: 'boot' }, {})).toBe('continued');
    expect(h.launches[0]!.run.runId).toBe('next');
    expect(JSON.parse(h.launches[0]!.request.contextRef).agentPluginState).toEqual(state);
  });

  it('keeps a live attempt with a pending card instead of starting another preflight', async () => {
    const h = harness({ probe: 'live', events: [{ kind: 'ext', name: 'mcp-ui', data: { type: 'resource' } }] });
    expect(await h.recovery.recover({ messageId: 'answer', trigger: 'timeout' }, {})).toBe('reattached');
    expect(h.launches).toEqual([]);
    expect(h.canceled).toEqual([]);
    expect(h.attached).toEqual(['old']);
  });
});

describe("durable recovery: saved omissions are system housekeeping", () => {
  it("tells the model a saved [token removed] marker is not a user disclosure, and keeps the saved output", async () => {
    const content = "Saved output: [token removed]";
    const h = harness({ content, probe: "dead", events: [{ kind: "text", text: content }] });

    expect(await h.recovery.recover({ messageId: "answer", trigger: "boot" }, {})).toBe("continued");
    const { prompt } = JSON.parse(h.launches[0]!.request.contextRef);
    const guidance = "Omission markers in the saved work are system housekeeping, not user content; do not mention them to the user or infer a user disclosure from them.";
    expect(prompt.indexOf(guidance)).toBeGreaterThan(-1);
    expect(prompt.indexOf(guidance)).toBeLessThan(prompt.indexOf("Accepted task:"));
    expect(prompt).toContain(`Saved partial answer:\n${content}`);
  });
});

describe("durable recovery: one metadata-only info line per decision", () => {
  it("logs the decision and failure class once, without answer text or diagnostics", async () => {
    const h = harness({ events: [{ kind: "text", text: "private answer" }, { kind: "status", label: "context_length_exceeded", detail: "private detail" }], probe: "dead" });

    expect(await h.recovery.recover({ messageId: "answer", trigger: "boot" }, {})).toBe("finalized");
    expect(h.info).toEqual([["[durable-recovery] " + JSON.stringify({ runId: "old", trigger: "boot", probe: "dead", decision: "finalized", failureClass: "permanent" })]]);
  });

  it("does not log the watcher's routine re-confirmation of its own live run", async () => {
    const h = harness({ events: [], probe: "dead" });

    expect(await h.recovery.recover({ messageId: "answer", trigger: "timeout" }, { liveRunId: "old" })).toBe("reattached");
    expect(h.info).toEqual([]);
  });
});

describe("durable recovery: diagnostics never end a live attempt", () => {
  it("reattaches a live attempt whose raw output quotes auth words instead of canceling it as Not logged in", async () => {
    const h = harness({ events: [TOOL_PROSE], probe: "live" });
    expect(await h.recovery.recover({ messageId: "answer", trigger: "browser" }, {})).toBe("reattached");
    expect(h.attached).toEqual(["old"]);
    expect(h.canceled).toEqual([]);
    expect(h.settlements).toEqual([]);
  });

  it("keeps a quiet live watch (fresh liveRunId proof) instead of finalizing it", async () => {
    const h = harness({ events: [TOOL_PROSE], probe: "dead" });
    expect(await h.recovery.recover({ messageId: "answer", trigger: "timeout", expectedRunId: "old" }, { liveRunId: "old" })).toBe("reattached");
    expect(h.settlements).toEqual([]);
  });

  it("still finalizes a dead attempt that genuinely failed to authenticate", async () => {
    const h = harness({ events: [{ kind: "status", label: "Not logged in · Please run /login" }], probe: "dead" });
    expect(await h.recovery.recover({ messageId: "answer", trigger: "attempt-failed" }, {})).toBe("finalized");
    expect(h.settlements[0]!.status).toBe("canceled");
    expect(h.settlements[0]!.events.at(-1)).toEqual({ kind: "status", label: "Not logged in. Saved work is above." });
  });
});

describe("durable recovery: successful CLI summaries are not failure diagnostics", () => {
  it.each([
    { type: "result", is_error: false, modelUsage: { x: { contextWindow: 1000000 } } },
    { type: "result", is_error: false, result: "Reviewed forbidden responses" },
    { type: "result", is_error: false, result: "Updated billing documentation" },
    // This line remains diagnostic input, independently guarding the required separator.
    { type: "result", is_error: true, modelUsage: { x: { contextWindow: 1000000 } } },
  ])("continues after an interrupted attempt containing %j", async (summary) => {
    const h = harness({ events: [
      { kind: "raw", line: JSON.stringify(summary) },
      { kind: "status", label: "Run failed", detail: "exit code 1, signal none, resumable no" },
    ], probe: "dead" });

    expect(await h.recovery.recover({ messageId: "answer", trigger: "attempt-failed" }, {})).toBe("continued");
    expect(h.launches).toHaveLength(1);
    expect(h.launches[0]!.run.runId).toBe("next");
    expect(h.attached).toEqual(["next"]);
    expect(h.settlements).toEqual([]);
  });

  it.each([
    { kind: "raw", line: "context_length_exceeded" },
    { kind: "raw", line: "context window exceeded" },
    { kind: "raw", line: JSON.stringify({ type: "result", is_error: true, error: "context_length_exceeded" }) },
    { kind: "raw", line: JSON.stringify({ type: "result", is_error: true, error: "context window exceeded" }) },
  ] as const)("preserves a real permanent failure after a successful CLI turn: %j", async (failure) => {
    const h = harness({ events: [
      { kind: "raw", line: JSON.stringify({ type: "result", is_error: false, result: "Completed earlier work" }) },
      failure,
    ], probe: "dead" });

    expect(await h.recovery.recover({ messageId: "answer", trigger: "attempt-failed" }, {})).toBe("finalized");
    expect(h.launches).toEqual([]);
    expect(h.settlements).toHaveLength(1);
    expect(h.settlements[0]!.status).toBe("failed");
    expect(h.settlements[0]!.events.at(-1)).toEqual({ kind: "status", label: EXHAUSTED_NOTICE, detail: failure.line });
  });
});

describe("durable recovery: terminal failure details", () => {
  it("keeps the last non-empty diagnostic line, trimmed and capped, without answer or tool content", async () => {
    const reason = `context_length_exceeded: ${"x".repeat(400)}`;
    const h = harness({ probe: "dead", events: [
      { kind: "status", label: "Run failed", detail: `Earlier diagnostic\n  ${reason}  \n \n` },
      { kind: "text", text: "Private answer" },
      { kind: "tool_result", toolUseId: "tool", content: "Private tool result", isError: true },
      { kind: "raw", line: JSON.stringify({ type: "result", is_error: false, result: "Private summary" }) },
    ] });

    expect(await h.recovery.recover({ messageId: "answer", trigger: "attempt-failed" }, {})).toBe("finalized");
    expect(h.settlements[0]!.events.at(-1)).toEqual({ kind: "status", label: EXHAUSTED_NOTICE, detail: reason.slice(0, 300) });
    expect(h.launches).toEqual([]);
  });

  it.each([
    { recoveryCount: RECOVERY_LIMIT },
    { recoveryDeadline: TIME },
  ])("keeps the current attempt's diagnostic when the budget ends: %j", async (run) => {
    const h = harness({ probe: "dead", run, events: [
      { kind: "status", label: "Run failed", detail: "  HTTP 503: service unavailable\n\n" },
      { kind: "text", text: "Private answer" },
      { kind: "tool_result", toolUseId: "tool", content: "Private tool result", isError: false },
    ] });

    expect(await h.recovery.recover({ messageId: "answer", trigger: "boot" }, {})).toBe("finalized");
    expect(h.settlements[0]!.events.at(-1)).toEqual({ kind: "status", label: EXHAUSTED_NOTICE, detail: "HTTP 503: service unavailable" });
    expect(h.launches).toEqual([]);
  });

  it.each([
    { run: { recoveryCount: RECOVERY_LIMIT }, detail: `Tried ${RECOVERY_LIMIT} times` },
    { run: { recoveryDeadline: TIME }, detail: "Recovery window ended" },
  ])("uses a factual budget detail without diagnostics: $detail", async ({ run, detail }) => {
    const h = harness({ probe: "dead", run, events: [
      { kind: "text", text: "Private answer" },
      { kind: "tool_result", toolUseId: "tool", content: "Private tool result", isError: true },
    ] });

    expect(await h.recovery.recover({ messageId: "answer", trigger: "boot" }, {})).toBe("finalized");
    expect(h.settlements[0]!.events.at(-1)).toEqual({ kind: "status", label: EXHAUSTED_NOTICE, detail });
  });

  it("does not reuse an earlier attempt's diagnostics as the exhausted detail", async () => {
    const base: AgentEvent[] = [
      { kind: "status", label: "HTTP 503: earlier attempt" },
      { kind: "status", code: "run_recovering", label: "Continuing…" },
    ];
    const h = harness({ probe: "dead", run: { recoveryCount: RECOVERY_LIMIT, attemptBase: base }, events: [
      ...base, { kind: "text", text: "Saved work" },
    ] });

    expect(await h.recovery.recover({ messageId: "answer", trigger: "boot" }, {})).toBe("finalized");
    expect(h.settlements[0]!.events.at(-1)).toEqual({ kind: "status", label: EXHAUSTED_NOTICE, detail: `Tried ${RECOVERY_LIMIT} times` });
  });
});

describe("durable recovery: stale runs waiting on the owner", () => {
  const card: AgentEvent[] = [
    { kind: "tool_use", id: "copy", name: "credential_copy_from_project", input: {} },
    { kind: "ext", name: "mcp-ui", data: { uri: "ui://tovu/credential-copy/pending" } },
    { kind: "status", code: "tool_progress", label: "Waiting", data: { elapsedSeconds: 60 } },
  ];

  it("says a stale run was waiting for an answer while a card's tool call stayed open", async () => {
    const h = harness({ probe: "dead", events: card, run: { lastProgressAt: TIME - RUN_STALENESS_MS } });

    expect(await h.recovery.recover({ messageId: "answer", trigger: "boot" }, {})).toBe("finalized");
    expect(h.settlements[0]!.events.at(-1)).toEqual({ kind: "status", label: AWAITING_ANSWER_NOTICE });
    expect(h.settlements[0]!.events.slice(0, -1)).toEqual(card);
    expect(h.launches).toEqual([]);
  });

  it.each([
    { events: [{ kind: "text", text: "Saved work" }] },
    { events: [...card, { kind: "tool_result", toolUseId: "copy", content: "Copied", isError: false }] },
  ] satisfies { events: AgentEvent[] }[])("keeps the no-progress notice for a stale run with no unanswered card: %j", async ({ events }) => {
    const h = harness({ probe: "dead", events, run: { lastProgressAt: TIME - RUN_STALENESS_MS } });

    expect(await h.recovery.recover({ messageId: "answer", trigger: "boot" }, {})).toBe("finalized");
    expect(h.settlements[0]!.events.at(-1)).toEqual({ kind: "status", label: SAVED_WORK_NOTICE });
    expect(h.launches).toEqual([]);
  });
});

describe("durable recovery: bridge failure is permanent", () => {
  it.each(["Error: bridge entry point missing", "Error: not logged in"])("finalizes MCP_BRIDGE_UNAVAILABLE once with its own message (%s)", async (reason) => {
    const message = `The assistant's tools did not load (MCP bridge "jini" status: failed). The run was stopped instead of continuing without them. Bridge exited with code 1: ${reason}`;
    const failure = translateRunFrame({ kind: "error", notices, raw: JSON.stringify({ payload: {
      message, error: { code: "MCP_BRIDGE_UNAVAILABLE", message },
    } }) });
    const h = harness({ events: [
      { kind: "status", label: "Agent started" }, ...failure.events,
      { kind: "status", label: "Run failed", detail: "exit code 1, signal none, resumable no" },
    ], probe: "dead" });

    expect(await h.recovery.recover({ messageId: "answer", trigger: "attempt-failed" }, {})).toBe("finalized");
    expect(h.launches).toEqual([]);
    expect(h.settlements).toHaveLength(1);
    expect(h.settlements[0]!.status).toBe("failed");
    expect(h.settlements[0]!.events.at(-1)).toEqual({ kind: "status", label: message });
    expect(await h.recovery.recover({ messageId: "answer", trigger: "browser" }, {})).toBe("terminal");
    expect(h.settlements).toHaveLength(1);
  });

  it("still retries an HTTP 429 rate-throttled attempt", async () => {
    const h = harness({ events: [{ kind: "status", label: "HTTP 429: rate limit exceeded" }], probe: "dead" });
    expect(await h.recovery.recover({ messageId: "answer", trigger: "attempt-failed" }, {})).toBe("continued");
    expect(h.launches).toHaveLength(1);
    expect(h.launches[0]!.run.runId).toBe("next");
    expect(h.launches[0]!.run.recoveryCount).toBe(1);
    expect(h.attached).toEqual(["next"]);
    expect(h.settlements).toEqual([]);
  });
});
