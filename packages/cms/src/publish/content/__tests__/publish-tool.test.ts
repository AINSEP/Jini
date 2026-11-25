import { describe, expect, it, vi } from "vitest";
import { ToolInputError } from "@jini-ai/core";
import { createPublishContentFromTool, type PublishToolDeps, type PublishToolHost } from "../publish-tool.js";
import { applyPublishCriteria, parsePublishContentToolInput, preparePublishConfirmation, toPublishReportRows, type PublishContentOutcomeRow, type PublishContentReport } from "../ui/index.js";
import { TEST_POLICY } from "../ui/__tests__/test-policy.js";

/** @file The autonomous publish tool through its factory with fake ports: no network, no repo, no registry.
 *  Every host value is injected; the real neutral ui functions run under the neutral test policy. */

type P = Record<string, never>;
const CAPABILITY = "cap.publish";
const BASE_URL = "https://live.example";
const peerRow = (id: string, over: Record<string, unknown> = {}) => ({ workspaceId: "ws", id, label: id, baseUrl: BASE_URL, remoteWorkspaceId: "r", sealed: null, masked: null, aadVersion: 1, updatedAt: "2026-01-01T00:00:00.000Z", ...over });

function row(entityType: string, entityId: string, outcome: PublishContentOutcomeRow["outcome"] = "created", extra: Partial<PublishContentOutcomeRow> = {}): PublishContentOutcomeRow {
  return { entityType, entityId, entityLabel: entityId, outcome, writes: ["created", "applied", "forced"].includes(outcome), reason: null, ...extra };
}
const report = (...rows: PublishContentOutcomeRow[]): PublishContentReport => ({ refused: false, rows } as PublishContentReport);

interface Setup { peers?: unknown[]; mode?: string; planRows?: PublishContentOutcomeRow[]; executeReport?: unknown; omitReport?: boolean; notSupported?: { entityType: string; count: number }[]; liveCanOverwrite?: boolean }
function setup(options: Setup = {}) {
  const calls = { plan: [] as unknown[], confirm: [] as unknown[], execute: [] as unknown[], credential: [] as unknown[] };
  const rows = options.planRows ?? [row("page", "a"), row("page", "b")];
  let lastKept = rows;
  const deps = {
    workspaceId: "ws", clock: { now: () => new Date(0) }, idGen: { newId: () => "id" },
    publishContentPeerRepo: { listByWorkspace: async () => options.peers ?? [peerRow("peer-1")] },
    publishContentPeerHttpClient: { send: async () => ({ status: 200, headers: {}, bodyText: "{}" }) },
  } as unknown as PublishToolDeps<P>;
  const host: PublishToolHost<PublishToolDeps<P>, P> = {
    resolveRuntimeMode: () => options.mode ?? "local",
    resolveCredential: async required => { calls.credential.push(required.input); return { id: required.input.id, label: "Live", baseUrl: BASE_URL, remoteWorkspaceId: "r", apiKey: "k" }; },
    planPublishToPeer: (async (required: { deps: unknown }, selection: { selectedEntityKeys?: string[]; overwriteEntityKeys?: string[] } = {}) => {
      calls.plan.push(selection);
      const keys = selection.selectedEntityKeys;
      const kept = keys ? rows.filter(r => keys.includes(`${r.entityType}:${r.entityId}`) || !r.writes) : rows;
      lastKept = kept;
      return { planId: "plan-1", planHash: "hash-1", bundleId: "bundle-1", liveCanOverwrite: options.liveCanOverwrite ?? true, notSupportedByLive: options.notSupported ?? [],
        publicUrls: Object.fromEntries(rows.map(r => [`${r.entityType}:${r.entityId}`, `${BASE_URL}/${r.entityId}`])),
        itemNames: Object.fromEntries(rows.map(r => [`${r.entityType}:${r.entityId}`, [`Name ${r.entityId}`]])),
        details: { ...report(...kept), refused: false }, ...(selection.overwriteEntityKeys ? { overwriteEntityKeys: selection.overwriteEntityKeys } : {}) };
    }) as never,
    peerTransport: {
      confirmPeerImport: (async (required: { required: unknown }) => { calls.confirm.push(required.required); return { confirmationToken: "token-1" }; }) as never,
      executePeerImport: (async (required: { required: unknown }) => { calls.execute.push(required.required); return { runId: "run-1", verificationProblems: [], ...(options.omitReport ? {} : { report: "executeReport" in options ? options.executeReport : report(...lastKept) }) }; }) as never,
    },
    ui: {
      toPublishReportRows: (required, optional) => toPublishReportRows({ ...required, policy: TEST_POLICY }, optional),
      applyPublishCriteria: required => applyPublishCriteria({ ...required, typeAliases: { pages: "page" } }),
      parsePublishContentToolInput: required => parsePublishContentToolInput({ ...required, capabilityId: CAPABILITY }),
      preparePublishConfirmation: required => preparePublishConfirmation({ ...required, driftMessage: "drifted" }),
    },
    criteriaCapabilityId: CAPABILITY,
  };
  const publish = createPublishContentFromTool<PublishToolDeps<P>, P>({ host });
  return { calls, run: (input: Record<string, unknown> = {}) => publish({ deps, principalId: "user-1" }, input) as Promise<any> };
}

describe("publishContentFromTool", () => {
  it("plans, confirms and executes every row, reporting what actually landed", async () => {
    const t = setup();
    const result = await t.run();
    expect(result.published.map((r: { entityKey: string }) => r.entityKey)).toEqual(["page:a", "page:b"]);
    expect(result.published[0]).toMatchObject({ outcome: "created", publicUrl: `${BASE_URL}/a` });
    expect(result.message).toBe(`Published 2 items to ${BASE_URL}. Skipped 0.`);
    expect(result.runId).toBe("run-1");
    expect(t.calls.confirm).toEqual([{ planId: "plan-1", planHash: "hash-1" }]);
    expect(t.calls.execute).toEqual([{ bundleId: "bundle-1", confirmationToken: "token-1" }]);
  });

  it("refuses with the live-site error before touching any port when the host says it is the live site", async () => {
    const t = setup({ mode: "production" });
    await expect(t.run()).rejects.toMatchObject({ message: expect.stringContaining("This is the live site") });
    expect(t.calls.credential).toEqual([]);
  });

  it("narrows to the requested types and names the excluded rows, re-planning with exactly those keys", async () => {
    const t = setup({ planRows: [row("page", "a"), row("post", "p")] });
    const result = await t.run({ types: ["pages"] });
    expect(result.published.map((r: { entityKey: string }) => r.entityKey)).toEqual(["page:a"]);
    expect(result.skipped).toEqual([{ entityKey: "post:p", title: "p", reason: "Excluded by the requested selection." }]);
    expect(t.calls.plan.at(-1)).toEqual({ selectedEntityKeys: ["page:a"] });
  });

  it("publishes nothing, and never confirms or executes, when the selection matches no row", async () => {
    const t = setup();
    const result = await t.run({ items: ["nothing-matches"] });
    expect(result.published).toEqual([]);
    expect(result.unmatchedItems).toEqual(["nothing-matches"]);
    expect(result.message).toMatch(/^Published nothing\./);
    expect(t.calls.confirm).toEqual([]);
    expect(t.calls.execute).toEqual([]);
  });

  it("rejects malformed filters with exact copy and re-prefixes the parser's capability errors with the tool id", async () => {
    const t = setup();
    await expect(t.run({ types: "page" })).rejects.toThrow("'types' must be an array of at most 1000 non-empty strings.");
    await expect(t.run({ excludeItems: [" "] })).rejects.toThrow("'excludeItems' must be an array of at most 1000 non-empty strings.");
    await expect(t.run({ overwrite: "yes" })).rejects.toThrow("publish_content_publish: 'overwrite' must be a boolean");
    await expect(t.run({ types: ["page"], overwrite: 1 })).rejects.toBeInstanceOf(ToolInputError);
  });

  it("chooses the destination: explicit id, the single saved one, the connected one, else refuses with guidance", async () => {
    const explicit = setup(); await explicit.run({ peerId: "peer-9" });
    expect(explicit.calls.credential).toEqual([{ workspaceId: "ws", id: "peer-9" }]);
    const one = setup({ peers: [peerRow("only", { sealed: {} })] }); await one.run();
    expect(one.calls.credential).toEqual([{ workspaceId: "ws", id: "only" }]);
    const connected = setup({ peers: [peerRow("keyed", { sealed: {} }), peerRow("linked")] }); await connected.run();
    expect(connected.calls.credential).toEqual([{ workspaceId: "ws", id: "linked" }]);
    await expect(setup({ peers: [] }).run()).rejects.toThrow("No live destination is connected. Connect this computer with publish_content_connect, then publish again.");
    await expect(setup({ peers: [peerRow("a", { sealed: {} }), peerRow("b", { sealed: {} })] }).run()).rejects.toThrow("Several destinations are saved. Choose a peerId before publishing.");
    await expect(setup().run({ peerId: " " })).rejects.toThrow("'peerId' must be a non-empty string.");
  });

  it("never calls a race-time conflict published", async () => {
    const t = setup({ executeReport: report(row("page", "a"), row("page", "b", "conflict", { reason: "Concurrent edit on live." })) });
    const result = await t.run();
    expect(result.published.map((r: { entityKey: string }) => r.entityKey)).toEqual(["page:a"]);
    expect(result.skipped.map((r: { entityKey: string }) => r.entityKey)).toEqual(["page:b"]);
  });

  it("reports uncertainty, not success, when an old live build returns no per-item report", async () => {
    const t = setup({ omitReport: true });
    const result = await t.run();
    expect(result.published).toEqual([]);
    expect(result.unverified.map((r: { entityKey: string }) => r.entityKey)).toEqual(["page:a", "page:b"]);
    expect(result.runId).toBe("run-1");
    expect(result.message).toMatch(/^The publish run completed, but this live site's version did not return per-item results\./);
  });

  it.each([null, false, "report", []])("refuses remote report %j as missing", async remote => {
    await expect(setup({ executeReport: remote }).run()).rejects.toThrow("The live site returned no publish report.");
  });

  it.each([
    [{ refused: false }],
    [{ refused: false, rows: [row("page", "a", "created", { writes: false })] }],
    [{ refused: false, rows: [row("page", "a", "unchanged", { writes: true })] }],
    [{ refused: false, rows: [{ entityType: 1 }] }],
  ])("refuses malformed remote report %j", async remote => {
    await expect(setup({ executeReport: remote }).run()).rejects.toThrow("The live site returned an invalid publish report.");
  });

  it("surfaces the live site's own refusal reason", async () => {
    await expect(setup({ executeReport: { refused: true, refusalReason: "Not today.", rows: [] } }).run()).rejects.toThrow("Not today.");
  });

  it("returns source items the live build cannot hold as skipped, blocked rows", async () => {
    const t = setup({ planRows: [row("page", "a"), row("widget", "w", "unchanged")], notSupported: [{ entityType: "widget", count: 1 }] });
    const result = await t.run();
    expect(result.notSupportedByLive).toEqual([{ entityType: "widget", count: 1 }]);
    expect(result.skipped.map((r: { entityKey: string }) => r.entityKey)).toContain("widget:w");
  });

  it("refuses an overwrite selection while the live site cannot overwrite", async () => {
    const t = setup({ planRows: [row("page", "a", "conflict", { canOverwrite: true })], liveCanOverwrite: false });
    await expect(t.run({ overwrite: true })).rejects.toThrow("The live site cannot overwrite content yet. Update it before trying again.");
    expect(t.calls.execute).toEqual([]);
  });
});
