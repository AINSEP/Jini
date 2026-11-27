import { createAutomaticAgentPluginUse, readChatAgentPluginState } from "../../lifecycle/automatic-use.js";
import { describe, expect, it, vi } from "vitest";
import { createAutomaticPluginRuns, type AskAgentPluginChoice, type AutomaticPluginDeps, type AutomaticPluginRun } from "../automatic-agent-plugins.js";

function fixture() {
  let answer!: (value: { action: "auto" | "use" | "skip"; selected: readonly string[] }) => void;
  let opened!: () => void;
  const opening = new Promise<void>(resolve => { opened = resolve; });
  const answering = new Promise<{ action: "auto" | "use" | "skip"; selected: readonly string[] }>(resolve => { answer = resolve; });
  const preference = { mode: "ask" as const, revisionSeq: 1 };
  const publish = vi.fn(async () => {});
  const saveAuto = vi.fn<AutomaticPluginDeps["preferences"]["saveAuto"]>(async () => {});
  const list = vi.fn(async () => [{ pluginId: "synthetic", enabled: true, keywords: ["synthetic"], skills: [], mcpServerIds: [] }]);
  const askAgentPluginChoice = vi.fn(async () => { opened(); return answering; });
  const deps: AutomaticPluginDeps = {
    createAutomaticAgentPluginUse, readChatAgentPluginState,
    workspaceId: "workspace", siteTitleReady: Promise.resolve(), preferences: { mode: async () => preference.mode, snapshot: async () => ({ ...preference }), saveAuto },
    list, rank: ({ candidates }) => candidates.map(candidate => ({ ...candidate, score: 4 })), resolve: async () => ({ ok: true, promptPrefix: "Guidance" }),
    formatPluginToolPointer: () => "read guidance", warn: vi.fn(),
    catalog: [{ name: "load_agent_plugin", description: "Read guidance", sideEffects: "none", authorization: { permission: "agent_plugins.read" }, inputSchema: { type: "object" } }],
    metadata: { load_agent_plugin: { approval: { class: "read", confirmation: "direct" } } }, catalogModule: "host/catalog", derivedRisk: new Map([["load_agent_plugin", "none"]]),
    copy: { preferenceBeforeAnswer: "preference changed before answer", preferenceAfterAnswer: "preference changed after answer", loadNotes: () => ({}) },
  };
  const context: AutomaticPluginRun = { principal: { id: "owner" }, conversationId: "chat", state: { decision: null, excluded: [] }, query: "synthetic", pinned: [], signal: new AbortController().signal, emitSurface: vi.fn(async () => {}), publish };
  return { runs: createAutomaticPluginRuns({ deps, surfaces: {} as Parameters<typeof createAutomaticPluginRuns>[0]["surfaces"], askAgentPluginChoice }), deps, context, publish, saveAuto, preference, opening, answer, askAgentPluginChoice, list };
}

describe("automatic plugin run ownership", () => {
  it("shares one choice and preparation across simultaneous attempts on a turn", async () => {
    const f = fixture();
    const first = f.runs.start({ runId: "first", messageId: "turn", context: f.context });
    const second = f.runs.start({ runId: "second", messageId: "turn", context: f.context });
    await f.opening;
    f.answer({ action: "use", selected: ["synthetic"] });
    expect(await first).toBe(await second);
    expect(f.askAgentPluginChoice).toHaveBeenCalledTimes(1);
    expect(f.publish).toHaveBeenCalledTimes(1);
  });

  it("rejects stale consent before a preference or transcript-state commit", async () => {
    const f = fixture();
    const starting = f.runs.start({ runId: "run", context: f.context });
    const rejected = expect(starting).rejects.toThrow("preference changed after answer");
    await f.opening;
    f.preference.revisionSeq++;
    f.answer({ action: "auto", selected: ["synthetic"] });
    await rejected;
    expect(f.saveAuto).not.toHaveBeenCalled();
    expect(f.publish).not.toHaveBeenCalled();
    f.runs.forget({ runId: "run" });
  });

  it("forwards the approved revision to preference CAS and publishes no rejected consent", async () => {
    const f = fixture();
    f.saveAuto.mockImplementation(async ({ expectedRevisionSeq }) => {
      expect(expectedRevisionSeq).toBe(1);
      throw new Error("stale preference CAS");
    });
    const starting = f.runs.start({ runId: "run", context: f.context });
    const rejected = expect(starting).rejects.toThrow("stale preference CAS");
    await f.opening;
    f.answer({ action: "auto", selected: ["synthetic"] });
    await rejected;
    expect(f.publish).not.toHaveBeenCalled();
    expect(f.runs.guidanceIds({ runId: "run" })).toEqual([]);
    f.runs.forget({ runId: "run" });
  });

  it("consumes a late answer once when a retry starts", async () => {
    const f = fixture();
    const first = f.runs.start({ runId: "old", messageId: "old-turn", context: f.context });
    await f.opening;
    f.runs.forget({ runId: "old" }, { preservePending: true });
    f.answer({ action: "use", selected: ["synthetic"] });
    await first;
    await f.runs.start({ runId: "retry", messageId: "next-turn", context: f.context });
    expect(f.askAgentPluginChoice).toHaveBeenCalledTimes(1);
    await f.runs.start({ runId: "later", messageId: "later-turn", context: f.context });
    expect(f.askAgentPluginChoice).toHaveBeenCalledTimes(2);
  });

  it("refuses disposed and cross-principal attempts", async () => {
    const f = fixture();
    const first = f.runs.start({ runId: "run", messageId: "turn", context: f.context });
    await f.opening;
    await expect(f.runs.start({ runId: "other", messageId: "turn", context: { ...f.context, principal: { id: "other" } } })).rejects.toThrow("run is unavailable");
    f.answer({ action: "use", selected: ["synthetic"] });
    await first;
    f.runs.forget({ runId: "run" });
    await expect(f.runs.commit({ scope: { runId: "run", principalId: "owner", attempt: 1 }, offerId: "offer", deliveredIds: ["synthetic"] })).rejects.toThrow("run is unavailable");
  });
});

it('reads changing layouts once per logical turn and never at construction or rejoin', async () => {
  const { createScopedAutomaticPluginRuns, bindAutomaticGuidanceResolver } = await import('../automatic-agent-plugins.js');
  const f = fixture();
  let root = '/first';
  const reads: string[] = [];
  const resolve = vi.fn(async ({ workspaceLayout }: { workspaceLayout: { root: string; packages: string; revision: string } }) => ({ ok: true as const, promptPrefix: workspaceLayout.revision }));
  const runs = createScopedAutomaticPluginRuns({ deps: { ...f.deps, preferences: { ...f.deps.preferences, mode: async () => 'auto' },
    resolveForEntry: () => {
      reads.push(root);
      return bindAutomaticGuidanceResolver({ workspaceLayout: { root, packages: root + '/packages', revision: root }, resolveGuidance: resolve });
    },
  }, surfaces: {} as Parameters<typeof createScopedAutomaticPluginRuns>[0]['surfaces'], askAgentPluginChoice: f.askAgentPluginChoice });
  expect(reads).toEqual([]);
  await runs.start({ runId: 'first', messageId: 'turn', context: f.context });
  root = '/second';
  await runs.start({ runId: 'retry', messageId: 'turn', context: f.context });
  expect(reads).toEqual(['/first']);
  await runs.start({ runId: 'next', messageId: 'next-turn', context: f.context });
  expect(reads).toEqual(['/first', '/second']);
  expect(resolve.mock.calls.map(([input]) => input.workspaceLayout.revision)).toEqual(['/first', '/second']);
});

it('allows inactive guidance only for explicit loading', async () => {
  const { bindAutomaticGuidanceResolver } = await import('../automatic-agent-plugins.js');
  const resolveGuidance = vi.fn(async () => ({ ok: true as const, promptPrefix: 'Guidance' }));
  const resolve = bindAutomaticGuidanceResolver({ workspaceLayout: { root: '/root', packages: '/packages' }, resolveGuidance });
  await resolve({ pluginId: 'sample' });
  await resolve({ pluginId: 'sample' }, { allowInactiveGuidance: true });
  expect(resolveGuidance.mock.calls).toEqual([
    [{ pluginRefIds: ['sample'], workspaceLayout: { root: '/root', packages: '/packages' } }, { deliveryMode: 'inject', allowInactiveGuidance: false }],
    [{ pluginRefIds: ['sample'], workspaceLayout: { root: '/root', packages: '/packages' } }, { deliveryMode: 'inject', allowInactiveGuidance: true }],
  ]);
});

it("refuses cross-principal or malformed explicit loads before reading guidance, and returns the host note for a missing plugin", async () => {
  const f = fixture();
  const deps: AutomaticPluginDeps = {
    ...f.deps, preferences: { ...f.deps.preferences, mode: async () => "auto" },
    copy: { ...f.deps.copy, loadNotes: ({ pluginId }) => ({ missing: "Install " + pluginId + " first." }) },
  };
  const runs = createAutomaticPluginRuns({ deps, surfaces: {} as Parameters<typeof createAutomaticPluginRuns>[0]["surfaces"], askAgentPluginChoice: f.askAgentPluginChoice });
  const ctx = { executionId: "load-a", run: { id: "run" }, signal: f.context.signal, principal: f.context.principal };
  await runs.start({ runId: "run", context: f.context });
  const call = (input: unknown, principal = ctx.principal) => runs.loadRegistration.handler({ ...ctx, input, principal });
  const before = f.list.mock.calls.length;
  await expect(call({ pluginId: "synthetic", path: "notes.md" })).rejects.toThrow("Only pluginId, skill and file are accepted");
  await expect(call({ pluginId: "synthetic" }, { id: "other-person" })).rejects.toThrow("Agent Plugin run is unavailable");
  expect(f.list.mock.calls).toHaveLength(before);
  await expect(call({ pluginId: "not-installed" })).resolves.toEqual({
    pluginId: "not-installed", status: "missing", guidance: "", note: "Install not-installed first.",
  });
  await expect(call({ pluginId: "synthetic", skill: "selected", file: "reference.md" })).resolves.toEqual({
    pluginId: "synthetic", status: "loaded", guidance: "Guidance",
  });
});

it("commits an offered attempt only for its owner and reuses the offered id across a duplicate request", async () => {
  const f = fixture();
  const deps: AutomaticPluginDeps = {
    ...f.deps, preferences: { ...f.deps.preferences, mode: async () => "auto" },
  };
  const runs = createAutomaticPluginRuns({ deps, surfaces: {} as Parameters<typeof createAutomaticPluginRuns>[0]["surfaces"], askAgentPluginChoice: f.askAgentPluginChoice });
  const scope = { runId: "run", principalId: "owner", attempt: 1 };
  const request = { runId: "run", context: f.context, scope, offerId: "offer-1", isAttemptLive: async () => true };
  await expect(runs.offer({ ...request, scope: { ...scope, principalId: "other" } })).rejects.toThrow("Agent Plugin run is unavailable");
  const controller = new AbortController();
  controller.abort();
  await expect(runs.offer({ ...request, context: { ...f.context, signal: controller.signal } })).rejects.toThrow("Agent Plugin preparation was cancelled");
  const offered = await runs.offer(request);
  expect(offered.fullSections).toEqual([{ pluginId: "synthetic", text: "Guidance" }]);
  expect(f.publish.mock.calls).toEqual([]);
  await expect(runs.offer({ ...request, offerId: "other-offer-id" })).resolves.toEqual(offered);
  await expect(runs.commit({ scope, offerId: offered.offerId, deliveredIds: ["synthetic"] }, { signal: f.context.signal }))
    .resolves.toEqual({ guidanceIds: ["synthetic"] });
  expect(runs.guidanceIds({ runId: "run" })).toEqual(["synthetic"]);
  expect(f.publish).toHaveBeenCalledTimes(1);
});

it("off mode clears the usage strip without loading the catalog", async () => {
  const f = fixture();
  const deps: AutomaticPluginDeps = { ...f.deps, preferences: { ...f.deps.preferences, mode: async () => "off" } };
  const runs = createAutomaticPluginRuns({ deps, surfaces: {} as Parameters<typeof createAutomaticPluginRuns>[0]["surfaces"], askAgentPluginChoice: f.askAgentPluginChoice });
  await expect(runs.start({ runId: "off-run", context: f.context })).resolves.toBe("");
  expect(f.publish.mock.calls).toEqual([[{ conversationId: "chat", state: { decision: null, excluded: [] }, plugins: [] }]]);
  expect(f.list.mock.calls).toEqual([]);
});

it("a tool preparation failure is reported and does not consume the live run's ability to prepare again", async () => {
  const f = fixture();
  const list = vi.fn<AutomaticPluginDeps["list"]>(f.deps.list);
  const deps: AutomaticPluginDeps = { ...f.deps, list, preferences: { ...f.deps.preferences, mode: async () => "auto" } };
  const runs = createAutomaticPluginRuns({ deps, surfaces: {} as Parameters<typeof createAutomaticPluginRuns>[0]["surfaces"], askAgentPluginChoice: f.askAgentPluginChoice });
  const make = (id: string) => ({
    run: { id }, principal: f.context.principal, tool: { id: "publish" }, signal: f.context.signal,
  });
  await expect(runs.prepareGuidance(make("unknown"))).resolves.toBe("");
  expect(list.mock.calls).toEqual([]);
  await runs.start({ runId: "run", context: f.context });
  const failure = new Error("plugin index unavailable");
  list.mockRejectedValueOnce(failure);
  await expect(runs.prepareGuidance(make("run"))).resolves.toBe("");
  expect(f.deps.warn).toHaveBeenCalledExactlyOnceWith(failure);
  await expect(runs.prepareGuidance(make("run"))).resolves.toBe("");
  expect(f.deps.warn).toHaveBeenCalledTimes(1);
  expect(runs.guidanceIds({ runId: "run" })).toEqual(["synthetic"]);
});

it("a detached consent card drops its terminal user receipt but preserves the choice for the next turn", async () => {
  const f = fixture();
  const emitSurface = vi.fn<AutomaticPluginRun["emitSurface"]>(async () => {});
  const context = { ...f.context, emitSurface };
  let emitChoice!: AutomaticPluginRun["emitSurface"];
  const ask = vi.fn<AskAgentPluginChoice>(async input => {
    emitChoice = input.emitSurface;
    return f.askAgentPluginChoice();
  });
  const runs = createAutomaticPluginRuns({ deps: f.deps, surfaces: {} as Parameters<typeof createAutomaticPluginRuns>[0]["surfaces"], askAgentPluginChoice: ask });
  const start = runs.start({ runId: "first", messageId: "first-turn", context });
  await f.opening;
  const opened = { channel: "surface_request", payload: { surfaceId: "offer-a", surfaceKind: "form" } };
  await emitChoice(opened);
  runs.forget({ runId: "first" }, { preservePending: true });
  await emitChoice({ channel: "user_message", payload: { content: "Use the plugin", surfaceId: "offer-a" } });
  expect(emitSurface.mock.calls).toEqual([[opened]]);
  f.answer({ action: "use", selected: ["synthetic"] });
  expect(await start).toContain("Guidance");
  await runs.start({ runId: "second", messageId: "second-turn", context });
  expect(runs.guidanceIds({ runId: "second" })).toEqual(["synthetic"]);
  expect(ask).toHaveBeenCalledTimes(1);
});

it("a failed Off event is reported to the caller without falling back to guidance", async () => {
  const f = fixture();
  const mode = async () => "off" as const;
  const failure = new Error("conversation stream closed");
  const deps: AutomaticPluginDeps = { ...f.deps, preferences: { ...f.deps.preferences, mode } };
  const runs = createAutomaticPluginRuns({ deps, surfaces: {} as Parameters<typeof createAutomaticPluginRuns>[0]["surfaces"], askAgentPluginChoice: f.askAgentPluginChoice });
  f.publish.mockRejectedValueOnce(failure);
  await expect(runs.start({ runId: "off-run", context: f.context })).rejects.toBe(failure);
  expect(f.publish.mock.calls).toEqual([[{ conversationId: "chat", state: { decision: null, excluded: [] }, plugins: [] }]]);
  expect(f.list.mock.calls).toEqual([]);
});
