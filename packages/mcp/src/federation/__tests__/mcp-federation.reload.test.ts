import { messages as federationMessages, clientInfo, testPermissionGate } from "./fixtures.js";
import assert from "node:assert/strict";
import { test, onTestFinished, vi } from "vitest";

import type { ToolDescriptor, ToolRegistration, ToolRegistry } from "@jini-ai/core";

import type { AttachFederatedMcpToolsParams, AttachFederatedToolsResult } from "../bootstrap.js";
import { FEDERATED_CONNECTION_DEFAULTS, type ResolvedFederatedConnection } from "../config.js";
import type { FederatedMcpConnectionConfig, McpHttpLaunchSpec } from "../ports.js";
import { createFederationReloadCoordinator, selectUnadmittedConnections } from "../reload.js";

/**
 * @file `mcp-federation/reload.ts` — the coordinator that lets an operator-authorized event (an
 * OAuth callback completing, an admin save) admit a federated connection into an already-running
 * daemon without a restart, and the diffing this feature's whole "never touch an already-admitted
 * connection" guarantee (trust.ts R5, restated in that file's own header) rests on.
 *
 * Deliberately does not boot `agent-daemon-server.ts` (a top-level side-effecting script — see that
 * file's own doc) or connect to a real MCP server: `attach` is injected exactly the way `connect` is
 * in `mcp-federation.bootstrap.test.ts`, so every assertion below is about the coordinator's own
 * diffing/bookkeeping/concurrency logic, never about a real handshake.
 */

function connection(connectionId: string): ResolvedFederatedConnection {
  const config: FederatedMcpConnectionConfig = {
    connectionId,
    label: connectionId,
    allowedToolNames: [],
    writeAllowedToolNames: [],
    connectTimeoutMs: FEDERATED_CONNECTION_DEFAULTS.connectTimeoutMs,
    callTimeoutMs: FEDERATED_CONNECTION_DEFAULTS.callTimeoutMs,
    maxResultBytes: FEDERATED_CONNECTION_DEFAULTS.maxResultBytes,
    maxTools: FEDERATED_CONNECTION_DEFAULTS.maxTools,
  };
  const launch: McpHttpLaunchSpec = { url: `https://example.invalid/${connectionId}`, headers: {} };
  return { config, launch };
}

function fakeRegistry(): ToolRegistry & { registered: ToolRegistration[] } {
  const registered: ToolRegistration[] = [];
  const descriptors: ToolDescriptor[] = [];
  return {
    registered,
    register(registration) {
      if (descriptors.some((d) => d.id === registration.descriptor.id)) {
        throw new Error(`ToolRegistry: tool "${registration.descriptor.id}" is already registered`);
      }
      registered.push(registration);
      descriptors.push(registration.descriptor);
    },
    has: ({ toolId }: { toolId: string }) => descriptors.some((descriptor) => descriptor.id === toolId),
    list: () => descriptors,
  };
}

/** Deterministic `resolve` for an artificial pause point mid-`resolveConnections`/`attach`, without
 *  a real timer — matches this repo's own preference for controllable async over `setTimeout`-based
 *  races in a unit test. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** A minimal `attach` stand-in: admits every connection it's handed, one report each, no refusals —
 *  the coordinator's own diffing is what's under test, not `trust.ts`'s classification. */
async function admitAllImpl(params: AttachFederatedMcpToolsParams): Promise<AttachFederatedToolsResult> {
  const reports = (params.extraConnections ?? []).map((c) => {
    params.registry.register({
      descriptor: { id: `mcp__${c.config.connectionId}__tool` },
      handler: async () => "ok",
      policy: { authorize: async () => "allow" as const },
    });
    return {
      connectionId: c.config.connectionId,
      report: { admitted: [], refused: [], allowlistedButAbsent: [], writeAllowedButNotAllowlisted: [] },
      isPreset: false,
    };
  });
  return { registeredToolIds: reports.map((r) => `mcp__${r.connectionId}__tool`), sessions: [], reports, connectFailures: [] };
}

const FEDERATION_DEPS = { errorCode: "EXTERNAL_MCP", messages: federationMessages, permissionGate: testPermissionGate({ authorize: async () => ({ allowed: true, reason: "matched" }), scope: "ws-reload" }), scope: "ws-reload" };

test("selectUnadmittedConnections keeps only connections whose id is not already admitted", () => {
  const all = [connection("a"), connection("b"), connection("c")];
  const result = selectUnadmittedConnections({ allConnections: all, admittedConnectionIds: new Set(["b"]) });
  assert.deepEqual(
    result.map((c) => c.config.connectionId),
    ["a", "c"],
  );
});

test("selectUnadmittedConnections returns everything when nothing has been admitted yet", () => {
  const all = [connection("a"), connection("b")];
  assert.deepEqual(
    selectUnadmittedConnections({ allConnections: all, admittedConnectionIds: new Set() }).map((c) => c.config.connectionId),
    ["a", "b"],
  );
});

test("reload() is a no-op — attach is never called — when the roster has nothing beyond what was already admitted", async () => {
  let attachCalls = 0;
  const coordinator = createFederationReloadCoordinator({ coordDeps: {connect: async () => { throw new Error("test must inject attach or connect"); }, 
      registry: fakeRegistry(),
      deps: FEDERATION_DEPS,
      resolveConnections: async () => [connection("already-admitted")],
      attach: async (requiredArgs, optionalArgs) => {
        const params = { ...requiredArgs, ...optionalArgs };
        attachCalls += 1;
        return admitAllImpl(params);
      },
    }, initiallyAdmitted: ["already-admitted"] });

  const result = await coordinator.reload({});

  assert.equal(attachCalls, 0, "attach must not be called when every roster connection is already admitted");
  assert.deepEqual(result, { newlyAdmittedConnectionIds: [], reports: [], connectFailures: [] });
});

test("reload() admits only the NEW connection — attach's extraConnections excludes the already-admitted one, and connections is always empty", async () => {
  let seenExtra: readonly ResolvedFederatedConnection[] | undefined;
  let seenConnections: readonly ResolvedFederatedConnection[] | undefined;
  const coordinator = createFederationReloadCoordinator({ coordDeps: {connect: async () => { throw new Error("test must inject attach or connect"); }, 
      registry: fakeRegistry(),
      deps: FEDERATION_DEPS,
      resolveConnections: async () => [connection("old"), connection("higgsfield")],
      attach: async (requiredArgs, optionalArgs) => {
        const params = { ...requiredArgs, ...optionalArgs };
        seenExtra = params.extraConnections;
        seenConnections = params.connections;
        return admitAllImpl(params);
      },
    }, initiallyAdmitted: ["old"] });

  const result = await coordinator.reload({});

  assert.deepEqual(
    seenExtra?.map((c) => c.config.connectionId),
    ["higgsfield"],
    "only the connection NOT already admitted should ever reach attach",
  );
  assert.deepEqual(seenConnections, [], "connections must stay empty so attach never re-resolves (and re-attempts) preset connections");
  assert.deepEqual(result.newlyAdmittedConnectionIds, ["higgsfield"]);
});

test("a failed connect remains retryable and is admitted by the next successful reload", async () => {
  const registry = fakeRegistry();
  const attempts: string[][] = [];
  const failure = { connectionId: "higgsfield", reason: "sign-in not ready" };
  const coordinator = createFederationReloadCoordinator({ coordDeps: {connect: async () => { throw new Error("test must inject attach or connect"); }, 
      registry,
      deps: FEDERATION_DEPS,
      resolveConnections: async () => [connection("higgsfield")],
      attach: async (requiredArgs, optionalArgs) => {
        const params = { ...requiredArgs, ...optionalArgs };
        attempts.push((params.extraConnections ?? []).map((c) => c.config.connectionId));
        if (attempts.length === 1) {
          return { registeredToolIds: [], sessions: [], reports: [], connectFailures: [failure] };
        }
        return admitAllImpl(params);
      },
    }, initiallyAdmitted: [] });

  assert.deepEqual(await coordinator.reload({}), { newlyAdmittedConnectionIds: [], reports: [], connectFailures: [failure] });
  assert.equal(coordinator.admittedConnectionIds().has("higgsfield"), false);
  const second = await coordinator.reload({});
  assert.deepEqual(attempts, [["higgsfield"], ["higgsfield"]]);
  assert.deepEqual(second.newlyAdmittedConnectionIds, ["higgsfield"]);
  assert.deepEqual(second.connectFailures, []);
  assert.equal(coordinator.admittedConnectionIds().has("higgsfield"), true);
  assert.equal(registry.registered.length, 1);
});

test("admittedConnectionIds() grows after a successful reload, so a second reload never re-attempts the same connection", async () => {
  const registry = fakeRegistry();
  const coordinator = createFederationReloadCoordinator({ coordDeps: {connect: async () => { throw new Error("test must inject attach or connect"); },  registry, deps: FEDERATION_DEPS, resolveConnections: async () => [connection("higgsfield")], attach: (requiredArgs, optionalArgs) => admitAllImpl({ ...requiredArgs, ...optionalArgs }) }, initiallyAdmitted: [] });

  assert.equal(coordinator.admittedConnectionIds().has("higgsfield"), false);
  await coordinator.reload({});
  assert.equal(coordinator.admittedConnectionIds().has("higgsfield"), true);

  // A second reload against the SAME unchanged roster must not re-register — the append-only
  // `ToolRegistry.register` above throws if it does, so a passing assertion here is proof, not
  // merely a plausible claim.
  const second = await coordinator.reload({});
  assert.deepEqual(second, { newlyAdmittedConnectionIds: [], reports: [], connectFailures: [] });
  assert.equal(registry.registered.length, 1, "the connection must have been registered exactly once across both reload() calls");
});

test("two reload() calls racing while one is already in flight never double-register the SAME newly-appeared connection", async () => {
  const registry = fakeRegistry();
  const gate = deferred<void>();
  let resolveConnectionsCalls = 0;

  const coordinator = createFederationReloadCoordinator({ coordDeps: {connect: async () => { throw new Error("test must inject attach or connect"); }, 
      registry,
      deps: FEDERATION_DEPS,
      resolveConnections: async () => {
        resolveConnectionsCalls += 1;
        if (resolveConnectionsCalls === 1) await gate.promise; // hold the FIRST pass open
        return [connection("higgsfield")];
      },
      attach: (requiredArgs, optionalArgs) => admitAllImpl({ ...requiredArgs, ...optionalArgs }),
    }, initiallyAdmitted: [] });

  const first = coordinator.reload({}); // starts running, blocked on `gate`
  const second = coordinator.reload({}); // arrives while the first is in flight — must be QUEUED, not concurrent

  gate.resolve(); // let the first pass proceed
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(registry.registered.length, 1, "higgsfield must be registered exactly once, not once per racing caller");
  // Whichever pass actually admitted it, the OTHER must report nothing new for it — never a second
  // registration attempt (which `fakeRegistry` would have thrown on) and never silently dropped.
  const admittedBy = [...firstResult.newlyAdmittedConnectionIds, ...secondResult.newlyAdmittedConnectionIds];
  assert.deepEqual(admittedBy, ["higgsfield"]);
});

test("a reload() call that arrives after one is already in flight sees roster state committed AFTER it was called, not a stale snapshot", async () => {
  // Models the exact scenario the dispatch calls out: two sign-ins finishing close together. The
  // FIRST reload's `resolveConnections` snapshot is taken before the SECOND connection's row is
  // durable — a naive single-flight (hand every concurrent caller the SAME in-flight promise) would
  // report success to the second caller without its connection ever having been admitted.
  const registry = fakeRegistry();
  const firstPassGate = deferred<void>();
  const firstAttachStarted = deferred<void>();
  const roster: ResolvedFederatedConnection[] = [connection("higgsfield")];
  let attachCalls = 0;

  const coordinator = createFederationReloadCoordinator({ coordDeps: {connect: async () => { throw new Error("test must inject attach or connect"); }, 
      registry,
      deps: FEDERATION_DEPS,
      resolveConnections: async () => [...roster],
      attach: async (requiredArgs, optionalArgs) => {
        const params = { ...requiredArgs, ...optionalArgs };
        attachCalls += 1;
        if (attachCalls === 1) {
          firstAttachStarted.resolve();
          await firstPassGate.promise;
        }
        return admitAllImpl(params);
      },
    }, initiallyAdmitted: [] });

  const first = coordinator.reload({});
  await firstAttachStarted.promise; // the first pass has already captured the old roster
  const second = coordinator.reload({}); // queued — must observe the push below, not the pre-push roster

  roster.push(connection("second-vendor")); // the "just-committed write" the second caller is for
  firstPassGate.resolve();

  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.deepEqual(firstResult.newlyAdmittedConnectionIds, ["higgsfield"]);
  assert.deepEqual(secondResult.newlyAdmittedConnectionIds, ["second-vendor"]);
  const allAdmitted = new Set([...firstResult.newlyAdmittedConnectionIds, ...secondResult.newlyAdmittedConnectionIds]);
  assert.equal(allAdmitted.has("second-vendor"), true, "the connection committed after the second reload() call must end up admitted");
  assert.equal(registry.registered.length, 2, "both connections registered exactly once each, never zero, never twice");
});

test("a pass that throws does not wedge a queued follow-up caller behind a permanently-rejected chain", async () => {
  const registry = fakeRegistry();
  const gate = deferred<void>();
  let attempt = 0;

  const coordinator = createFederationReloadCoordinator({ coordDeps: {connect: async () => { throw new Error("test must inject attach or connect"); }, 
      registry,
      deps: FEDERATION_DEPS,
      resolveConnections: async () => {
        attempt += 1;
        if (attempt === 1) {
          await gate.promise;
          throw new Error("simulated roster read failure");
        }
        return [connection("higgsfield")];
      },
      attach: (requiredArgs, optionalArgs) => admitAllImpl({ ...requiredArgs, ...optionalArgs }),
    }, initiallyAdmitted: [] });

  const first = coordinator.reload({});
  const second = coordinator.reload({});
  gate.resolve();

  await assert.rejects(first, /simulated roster read failure/);
  const secondResult = await second; // must still settle — and succeed — despite the first pass throwing
  assert.deepEqual(secondResult.newlyAdmittedConnectionIds, ["higgsfield"]);
});
