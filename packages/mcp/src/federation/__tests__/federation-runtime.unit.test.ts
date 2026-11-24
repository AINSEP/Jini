import { describe, expect, test, vi } from "vitest";

import { messages } from "./fixtures.js";
import type { AttachFederatedToolsResult } from "../bootstrap.js";
import { FEDERATED_CONNECTION_DEFAULTS, type ResolvedFederatedConnection } from "../config.js";
import type { FederationReloadResult } from "../reload.js";
import {
  createFederationConsoleLogger, createFederationRuntime, mergeReloadConnectFailures, selectAwaitingGrantConnectionIds,
  type CreateFederationRuntimeRequired, type FederationHostLogger,
} from "../runtime.js";
import type { FederatedAdmissionReport } from "../trust.js";

/** @file Accounting owned by `runtime.ts`: single-flight boot, boot-plus-reload merge, refusal prefix
 * caching and the reload coordinator's seed. All I/O is injected, so no handshake runs here. */

function connection(connectionId: string, { allowed = [] as string[] } = {}): ResolvedFederatedConnection {
  return {
    config: { connectionId, label: connectionId, allowedToolNames: allowed, writeAllowedToolNames: [], ...FEDERATED_CONNECTION_DEFAULTS },
    launch: { url: `https://example.invalid/${connectionId}`, headers: {} },
  };
}

function report({ drift = [] as string[], admitted = 0 } = {}): FederatedAdmissionReport {
  const tool = { remoteName: "t", toolId: "x.t" } as unknown as FederatedAdmissionReport["admitted"][number];
  return { admitted: Array.from({ length: admitted }, () => tool), refused: [], allowlistedButAbsent: drift, writeAllowedButNotAllowlisted: [] };
}

const silent: FederationHostLogger = { info: () => {}, warn: () => {} };
const empty: AttachFederatedToolsResult = { registeredToolIds: [], sessions: [], reports: [], connectFailures: [] };

function setup(overrides: Partial<CreateFederationRuntimeRequired> = {}) {
  const reloadResults: FederationReloadResult[] = [];
  const coordinatorArgs: Parameters<CreateFederationRuntimeRequired["createReloadCoordinator"]>[0][] = [];
  const required: CreateFederationRuntimeRequired = {
    resolveConnections: async () => [connection("roster-a")],
    boot: vi.fn(async () => empty),
    resolvePresetConnections: () => [connection("preset-p")],
    createReloadCoordinator: (args) => {
      coordinatorArgs.push(args);
      return { reload: async () => reloadResults.shift() ?? { newlyAdmittedConnectionIds: [], reports: [], connectFailures: [] } };
    },
    messages, log: "[test]",
    ...overrides,
  };
  return { required, reloadResults, coordinatorArgs };
}

describe("createFederationRuntime", () => {
  test("start is single-flight and hands the roster to boot as extraConnections", async () => {
    const { required } = setup();
    const runtime = createFederationRuntime(required, { logger: silent });
    expect(runtime.configuredConnectionIds()).toBeUndefined();
    await Promise.all([runtime.start(), runtime.start()]);
    expect(required.boot).toHaveBeenCalledTimes(1);
    expect(vi.mocked(required.boot).mock.calls[0]![0].extraConnections.map(c => c.config.connectionId)).toEqual(["roster-a"]);
    expect(runtime.configuredConnectionIds()).toEqual(["roster-a"]);
    expect(runtime.started).toBe(true);
  });

  test("a failed roster read still completes boot and logs through the prefixed console", async () => {
    const warn = vi.fn();
    const { required } = setup({ resolveConnections: async () => { throw new Error("db down"); } });
    const runtime = createFederationRuntime(required, { logger: createFederationConsoleLogger({ prefix: "[test]" }, { sink: { log: vi.fn(), warn } }) });
    await expect(runtime.start()).resolves.toBeUndefined();
    expect(runtime.started).toBe(true);
    expect(warn).toHaveBeenCalledWith("[test] mcp-federation: boot pass failed, continuing without federated tools — db down");
  });

  test("reload before start reads nothing and returns an empty pass", async () => {
    const { required, coordinatorArgs } = setup();
    const runtime = createFederationRuntime(required, { logger: silent });
    expect(await runtime.reload()).toEqual({ newlyAdmittedConnectionIds: [], reports: [], connectFailures: [] });
    expect(coordinatorArgs).toHaveLength(0);
  });

  test("the reload coordinator is seeded with admitted ids, empty-grant roster ids and stamped presets", async () => {
    const boot = vi.fn(async () => ({ ...empty, reports: [
      { connectionId: "roster-a", report: report(), isPreset: false },
      { connectionId: "roster-b", report: report(), isPreset: false },
    ] }));
    const { required, coordinatorArgs } = setup({ boot, resolveConnections: async () => [connection("roster-a"), connection("roster-b", { allowed: ["t"] })] });
    await createFederationRuntime(required, { logger: silent }).start();
    expect(coordinatorArgs[0]!.initiallyAdmitted).toEqual(["roster-a", "roster-b"]);
    expect(coordinatorArgs[0]!.initiallyAwaitingGrants).toEqual(["roster-a"]);
    const resolved = await coordinatorArgs[0]!.resolveConnections();
    expect(resolved.map(c => [c.config.connectionId, c.config.origin?.kind])).toEqual([["preset-p", "preset"], ["roster-a", undefined], ["roster-b", undefined]]);
  });

  test("an admitting reload replaces that connection's report, recomputes the prefix and notifies", async () => {
    const onAdmitted = vi.fn();
    const boot = vi.fn(async () => ({ ...empty, reports: [{ connectionId: "roster-a", report: report({ drift: ["ghost"] }), isPreset: false }] }));
    const { required, reloadResults } = setup({ boot });
    const runtime = createFederationRuntime(required, { logger: silent, onAdmitted });
    await runtime.start();
    expect(runtime.refusalPrefix()).not.toBe("");
    reloadResults.push({ newlyAdmittedConnectionIds: [], reports: [], connectFailures: [] });
    await runtime.reload();
    expect(onAdmitted).not.toHaveBeenCalled();
    const fresh = { newlyAdmittedConnectionIds: ["roster-a"], reports: [{ connectionId: "roster-a", report: report({ admitted: 1 }), isPreset: false }], connectFailures: [] };
    reloadResults.push(fresh);
    await runtime.reload();
    expect(onAdmitted).toHaveBeenCalledWith(fresh);
    expect(runtime.reports()).toEqual(fresh.reports);
    expect(runtime.refusalPrefix()).toBe("");
  });
});

describe("pure accounting helpers", () => {
  test("mergeReloadConnectFailures drops every attempted id before appending this pass's failures", () => {
    const previous = [{ connectionId: "a", reason: "old" }, { connectionId: "b", reason: "old" }, { connectionId: "c", reason: "keep" }];
    const result = { newlyAdmittedConnectionIds: ["a"], reports: [], connectFailures: [{ connectionId: "b", reason: "new" }] };
    expect(mergeReloadConnectFailures({ previous, result })).toEqual([{ connectionId: "c", reason: "keep" }, { connectionId: "b", reason: "new" }]);
    const idle = { newlyAdmittedConnectionIds: [], reports: [], connectFailures: [] };
    expect(mergeReloadConnectFailures({ previous, result: idle })).toBe(previous);
  });

  test("selectAwaitingGrantConnectionIds ignores presets and connections that admitted tools", () => {
    const connections = [connection("a"), connection("p"), connection("z")];
    const reports = [
      { connectionId: "a", report: report(), isPreset: false },
      { connectionId: "p", report: report(), isPreset: true },
      { connectionId: "z", report: report({ admitted: 1 }), isPreset: false },
    ];
    expect(selectAwaitingGrantConnectionIds({ connections, reports })).toEqual(["a"]);
  });

  test("the console logger forwards the original error as a second argument only when present", () => {
    const sink = { log: vi.fn(), warn: vi.fn() };
    const logger = createFederationConsoleLogger({ prefix: "[p]" }, { sink });
    const error = new Error("boom");
    logger.info({ message: "hi" });
    logger.warn({ message: "bad" }, { error });
    expect(sink.log).toHaveBeenCalledWith("[p] hi");
    expect(sink.warn).toHaveBeenCalledWith("[p] bad", error);
  });
});
