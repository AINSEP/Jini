import { describe, it, expect } from "vitest";
import { ToolInputError, ToolPermissionDeniedError, type ToolExecutionContext } from "@jini-ai/core";
import { catalog, createPublishContentDisconnectTools, derivedRisk, type PublishContentDisconnectDeps } from "../disconnect-tool.js";
import type { PublishContentPeerRecord, PublishContentPeerRepoPort } from "../peer-registry.js";

/** @file `publish_content_disconnect` through its handler with a Map-backed peer repo and an injected
 *  grant reversal (no deploy config is written). */

const WS = "ws-disconnect";
const TARGET = { nextStep: "Deploy this site once more." };

class SettingsWriteError extends Error {}

class MemoryRepo implements PublishContentPeerRepoPort {
  readonly vault = {} as never;
  readonly binding = {} as never;
  readonly rows = new Map<string, PublishContentPeerRecord>();
  async insert({ record }: { record: PublishContentPeerRecord }) { this.rows.set(record.id, record); }
  async update({ record }: { record: PublishContentPeerRecord }) { this.rows.set(record.id, record); }
  async findById({ id }: { workspaceId: string; id: string }) { return this.rows.get(id) ?? null; }
  async listByWorkspace() { return [...this.rows.values()]; }
  async delete({ id }: { workspaceId: string; id: string }) { this.rows.delete(id); }
}

function row(): PublishContentPeerRecord {
  return { workspaceId: WS, id: "peer-1", label: "live.example", baseUrl: "https://live.example", remoteWorkspaceId: "remote", sealed: null, masked: null, aadVersion: 1, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" };
}

function setup(over: { reverse?: () => Promise<{ changed: boolean; target: { nextStep: string } }>; deps?: Partial<PublishContentDisconnectDeps> } = {}) {
  const reversals: number[] = [];
  const tools = createPublishContentDisconnectTools<PublishContentDisconnectDeps>({ host: {
    catalogModule: "host/disconnect-tool.ts",
    reverseGrant: async () => { reversals.push(1); return (over.reverse ?? (async () => ({ changed: true, target: TARGET })))(); },
    settingsWriteFailure: { isInstance: ({ error }) => error instanceof SettingsWriteError, message: "Settings could not be saved; retry." },
  } });
  const repo = new MemoryRepo();
  const deps: PublishContentDisconnectDeps = {
    workspaceId: WS, authorize: async () => ({ allowed: true, reason: "matched" }),
    clock: { nowMs: () => Date.parse("2026-10-01T00:00:00.000Z") }, idGen: { newId: () => "peer-restored" },
    publishContentPeerRepo: repo, ...over.deps,
  };
  const call = () => {
    const [registration] = tools.buildRegistrations(deps);
    const ctx = { executionId: "e1", principal: { id: "operator" }, run: { id: "r1" }, input: {}, signal: new AbortController().signal } as ToolExecutionContext;
    return registration!.handler(ctx);
  };
  return { tools, repo, reversals, call };
}

describe("publish_content_disconnect", () => {
  it("forgets a connected destination and names the deploy still needed", async () => {
    const f = setup({ deps: { findPublishCandidate: async () => "https://unused.example" } });
    await f.repo.insert({ record: row() });
    expect(await f.call()).toStrictEqual({ connected: false, site: null, candidateUrl: "https://live.example", message: "This computer no longer publishes to live.example.", nextStep: TARGET.nextStep });
    expect(f.reversals).toHaveLength(1);
    expect(f.repo.rows.size).toBe(0);
  });

  it("when not connected and nothing changed, suggests the candidate URL and no next step", async () => {
    const f = setup({ reverse: async () => ({ changed: false, target: TARGET }), deps: { findPublishCandidate: async () => "https://candidate.example" } });
    expect(await f.call()).toStrictEqual({ connected: false, site: null, candidateUrl: "https://candidate.example", message: "This computer was not publishing anywhere.", nextStep: null });
  });

  it("reports no candidate without discovery but still forwards the grant reversal's deploy step", async () => {
    const f = setup();
    expect(await f.call()).toStrictEqual({ connected: false, site: null, candidateUrl: null,
      message: "This computer was not publishing anywhere.", nextStep: TARGET.nextStep });
    expect(await f.repo.listByWorkspace()).toEqual([]);
  });

  it("a changed grant whose target names no next step reports a null nextStep", async () => {
    const f = setup({ reverse: async () => ({ changed: true, target: {} as never }) });
    await f.repo.insert({ record: row() });
    expect(await f.call()).toMatchObject({ nextStep: null, candidateUrl: "https://live.example" });
  });

  it("refuses without the apply permission and touches nothing", async () => {
    const f = setup({ deps: { authorize: async () => ({ allowed: false, reason: "insufficient_permission" }) } });
    await f.repo.insert({ record: row() });
    await expect(f.call()).rejects.toBeInstanceOf(ToolPermissionDeniedError);
    expect(f.reversals).toHaveLength(0);
    expect(f.repo.rows.size).toBe(1);
  });

  it("a settings write failure is refused with the host's recovery copy, and the peer is put back", async () => {
    const f = setup({ reverse: async () => { throw new SettingsWriteError("read-only file system"); } });
    await f.repo.insert({ record: row() });
    await expect(f.call()).rejects.toSatisfy((error: unknown) => error instanceof ToolInputError && error.message === "Settings could not be saved; retry.");
    expect([...f.repo.rows.values()].map((r) => r.baseUrl)).toStrictEqual(["https://live.example"]);
  });

  it("any other failure propagates unchanged", async () => {
    const outage = new Error("peer store unavailable");
    const f = setup();
    f.repo.listByWorkspace = async () => { throw outage; };
    await expect(f.call()).rejects.toBe(outage);
  });

  it("the contributor installs this module's builder and risk under its own domain", () => {
    const { tools } = setup();
    const contributor = tools.contributePublishContentDisconnectTools();
    expect(contributor.domain).toBe("publish-content-disconnect");
    expect(contributor.build).toBe(tools.buildRegistrations);
    expect(contributor.risk).toBe(derivedRisk);
    expect(catalog.map((entry) => entry.name)).toStrictEqual(["publish_content_disconnect"]);
  });
});
