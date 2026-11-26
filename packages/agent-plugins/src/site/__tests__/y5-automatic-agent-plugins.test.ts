import { describe, expect, it, vi } from "vitest";
import { createAutomaticPluginRuns, type AutomaticPluginDeps, type AutomaticPluginRun } from "../automatic-agent-plugins.js";

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
