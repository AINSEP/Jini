import { messages as federationMessages, testPermissionGate } from "./fixtures.js";
import assert from "node:assert/strict";
import { test } from "vitest";
import { InMemoryMcpSession } from "../testing/adapter.memory.js";
import { createFederatedConnectionRevocationGate } from "../approvals/index.js";
import type { ConnectionRosterSnapshot } from "../approvals/index.js";
import { federateSession, type FederationDeps } from "../registrations.js";
import type { FederatedCallConfirmationOutcome, FederatedCallConfirmationRequest, FederatedCallTarget, RemoteToolDescriptor } from "../ports.js";
import {
  federatedToolRequiresWriteGrant,
  refusalForAdmittedToolUnderCurrentGrants,
  strongestFederatedConfirmation,
  type FederatedCallConfirmation,
} from "../trust.js";

// Lot fed-security (2026-10-27): three security bugs from the MCP design check.
// 1. "May write" is a grant the per-call current-grants check enforces.
// 2. Host policy may ADD a confirmation card, never remove one Jini requires.
// 3. A revocation, lost permission or cancelled run while a card is parked stops the call.

const ROSTER = { kind: "roster" as const, admissionRevision: "revision-1" };

type Harness = {
  tool: RemoteToolDescriptor;
  writeAllowed?: readonly string[];
  readOnlyRemoteNames?: ReadonlySet<string>;
  confirm?: (request: FederatedCallConfirmationRequest) => Promise<FederatedCallConfirmationOutcome>;
  hostConfirmation?: FederationDeps["hostConfirmation"];
  assertConnectionUsable?: FederationDeps["assertConnectionUsable"];
  allow?: () => boolean;
  signal?: AbortSignal;
  /** No host gate at all: the handler has only the grants the connection was admitted with. */
  noGate?: boolean;
};

async function run(options: Harness) {
  const { tool } = options;
  const session = new InMemoryMcpSession({ tools: [tool] });
  const events: string[] = [];
  const cards: FederatedCallConfirmationRequest[] = [];
  const allow = options.allow ?? (() => true);
  const deps: FederationDeps = {
    messages: federationMessages, errorCode: "EXTERNAL_MCP", scope: "workspace",
    permissionGate: testPermissionGate({ scope: "workspace", authorize: async () => {
      events.push("permission");
      return allow() ? { allowed: true, reason: "matched" } : { allowed: false, reason: "not authorized" };
    } }),
    ...(options.noGate ? {} : { assertConnectionUsable: async (input: Parameters<NonNullable<FederationDeps["assertConnectionUsable"]>>[0]) => {
      events.push("liveness"); return options.assertConnectionUsable?.(input);
    } }),
    confirmCall: async ({ request }) => {
      events.push("card"); cards.push(request);
      return options.confirm ? options.confirm(request) : { confirmed: true };
    },
    ...(options.hostConfirmation ? { hostConfirmation: options.hostConfirmation } : {}),
  };
  const { registrations } = await federateSession({ session, nativeToolIds: new Set(), deps, config: {
    connectionId: "service", label: "Service", allowedToolNames: [tool.name], writeAllowedToolNames: options.writeAllowed ?? [],
    maxTools: 5, maxResultBytes: 4096, connectTimeoutMs: 100, callTimeoutMs: 100, origin: ROSTER,
    ...(options.readOnlyRemoteNames ? { readOnlyRemoteNames: options.readOnlyRemoteNames } : {}),
  } });
  const result = registrations[0]!.handler({
    executionId: "execution", run: { id: "run" }, principal: { id: "owner" }, input: { id: "one" },
    signal: options.signal ?? new AbortController().signal,
  });
  return { session, events, cards, result };
}

const schema = { type: "object" };

// ---- 1. "May write" is enforced -----------------------------------------------------------------

for (const [label, remoteName, annotations] of [
  ["a declared write", "create_project", { readOnlyHint: false }],
  ["a declared destructive tool", "trash_item", { destructiveHint: true }],
  ["an unannotated opaque tool", "generate_image", undefined],
  ["a read-named tool that declares a write", "get_or_create_project", { readOnlyHint: false }],
] as const) {
  test(`fed-security 1: ${label} without a write grant is refused under current grants`, () => {
    const grants = { allowedToolNames: [remoteName], writeAllowedToolNames: [] };
    assert.equal(refusalForAdmittedToolUnderCurrentGrants({ tool: { remoteName, declaredAnnotations: annotations }, grants }), "remote-declares-not-read-only");
  });

  test(`fed-security 1: ${label} with a write grant is not refused`, () => {
    const grants = { allowedToolNames: [remoteName], writeAllowedToolNames: [remoteName] };
    assert.equal(refusalForAdmittedToolUnderCurrentGrants({ tool: { remoteName, declaredAnnotations: annotations }, grants }), null);
  });
}

for (const [label, remoteName, annotations] of [
  ["a declared read-only tool", "lookup", { readOnlyHint: true }],
  ["a read-verb tool", "list_tables", undefined],
  ["an assistant-prefixed read-verb tool", "assistant_get_permissions", undefined],
] as const) {
  test(`fed-security 1: ${label} is unaffected by an empty write list`, () => {
    const grants = { allowedToolNames: [remoteName], writeAllowedToolNames: [] };
    assert.equal(refusalForAdmittedToolUnderCurrentGrants({ tool: { remoteName, declaredAnnotations: annotations }, grants }), null);
  });
}

test("fed-security 1: the write grant never admits a tool the allowlist dropped", () => {
  const grants = { allowedToolNames: [], writeAllowedToolNames: ["create_project"] };
  assert.equal(refusalForAdmittedToolUnderCurrentGrants({ tool: { remoteName: "create_project", declaredAnnotations: undefined }, grants }), "not-in-operator-allowlist");
});

test("fed-security 1: the registration-time classification (with the operator's read list) is honoured; absent, it is re-derived", () => {
  const grants = { allowedToolNames: ["models_explore"], writeAllowedToolNames: [] };
  assert.equal(refusalForAdmittedToolUnderCurrentGrants({ tool: { remoteName: "models_explore", declaredAnnotations: undefined, requiresWriteGrant: false }, grants }), null);
  assert.equal(refusalForAdmittedToolUnderCurrentGrants({ tool: { remoteName: "models_explore", declaredAnnotations: undefined }, grants }), "remote-declares-not-read-only");
});

test("fed-security 1: an operator read list cannot override a remote's own write or destructive declaration", () => {
  const readList = new Set(["models_explore"]);
  assert.equal(federatedToolRequiresWriteGrant({ remoteName: "models_explore", annotations: undefined }, { readList }), false);
  assert.equal(federatedToolRequiresWriteGrant({ remoteName: "models_explore", annotations: { readOnlyHint: false } }, { readList }), true);
  assert.equal(federatedToolRequiresWriteGrant({ remoteName: "list_tables", annotations: { destructiveHint: true } }, { readList }), true);
});

test("fed-security 1: the handler hands the gate its write classification, made with the operator's read list", async () => {
  const seen: FederatedCallTarget[] = [];
  const h = await run({ tool: { name: "models_explore", inputSchema: schema }, readOnlyRemoteNames: new Set(["models_explore"]),
    assertConnectionUsable: ({ call }) => { seen.push(call); } });
  await h.result;
  assert.deepEqual(seen, [{ remoteName: "models_explore", declaredAnnotations: undefined, origin: ROSTER, requiresWriteGrant: false }]);
});

const roster = (writeAllowedToolNames: string[]): ConnectionRosterSnapshot => ({
  label: "Service", enabled: true, admissionRevision: "revision-1", disconnected: false,
  grants: { allowedToolNames: ["create_project", "list_tables"], writeAllowedToolNames },
});

function revocationGate(record: () => ConnectionRosterSnapshot | null) {
  return createFederatedConnectionRevocationGate({
    roster: { findByServerId: async () => record() },
    errorFactory: { create: ({ reason }) => Object.assign(new Error(`refused:${reason}`), { reason }) },
  }, { scope: "workspace" });
}

test("fed-security 1: through the revocation gate, a write tool without 'may write' is refused and never sent", async () => {
  const h = await run({ tool: { name: "create_project", inputSchema: schema, annotations: { readOnlyHint: false } },
    assertConnectionUsable: revocationGate(() => roster([])) });
  await assert.rejects(h.result, /refused:write-not-allowed/);
  assert.deepEqual(h.session.calls, []);
});

test("fed-security 1: through the revocation gate, the same write tool runs once 'may write' is granted", async () => {
  const h = await run({ tool: { name: "create_project", inputSchema: schema, annotations: { readOnlyHint: false } },
    writeAllowed: ["create_project"], assertConnectionUsable: revocationGate(() => roster(["create_project"])) });
  await h.result;
  assert.deepEqual(h.session.calls, [{ name: "create_project", arguments: { id: "one" } }]);
});

test("fed-security 1: a write grant added after boot takes effect on the next call, without a restart", async () => {
  const h = await run({ tool: { name: "create_project", inputSchema: schema, annotations: { readOnlyHint: false } },
    writeAllowed: [], assertConnectionUsable: revocationGate(() => roster(["create_project"])) });
  await h.result;
  assert.deepEqual(h.session.calls, [{ name: "create_project", arguments: { id: "one" } }]);
});

test("fed-security 1: a liveness-only gate does not vouch for grants, so a roster write tool admitted without 'may write' is refused", async () => {
  const h = await run({ tool: { name: "create_project", inputSchema: schema, annotations: { readOnlyHint: false } }, writeAllowed: [],
    assertConnectionUsable: async () => {} });
  await assert.rejects(h.result, /EXTERNAL_MCP_WRITE_NOT_ALLOWED/);
  assert.deepEqual(h.session.calls, []);
});

test("fed-security 1: with no host gate to read current grants, a roster write tool admitted without 'may write' is refused", async () => {
  const h = await run({ tool: { name: "create_project", inputSchema: schema, annotations: { readOnlyHint: false } }, writeAllowed: [], noGate: true });
  await assert.rejects(h.result, /EXTERNAL_MCP_WRITE_NOT_ALLOWED/);
  assert.deepEqual(h.session.calls, []);
});

test("fed-security 1: through the revocation gate, a read tool runs with no write grant", async () => {
  const h = await run({ tool: { name: "list_tables", inputSchema: schema }, assertConnectionUsable: revocationGate(() => roster([])) });
  await h.result;
  assert.deepEqual(h.session.calls, [{ name: "list_tables", arguments: { id: "one" } }]);
});

// ---- 2. Host policy may add a card, never remove one ---------------------------------------------

for (const [required, host, expected] of [
  ["none", "none", "none"], ["none", "confirm", "confirm"], ["none", "confirm-destructive", "confirm-destructive"],
  ["confirm", "none", "confirm"], ["confirm-destructive", "none", "confirm-destructive"],
  ["confirm-destructive", "confirm", "confirm-destructive"], ["confirm", "confirm-destructive", "confirm-destructive"],
] as const satisfies readonly (readonly [FederatedCallConfirmation, FederatedCallConfirmation, FederatedCallConfirmation])[]) {
  test(`fed-security 2: Jini ${required} + host ${host} = ${expected}`, () => {
    assert.equal(strongestFederatedConfirmation({ required, host }), expected);
  });
}

test("fed-security 2: a Jini-required card still shows when the host policy says no confirmation", async () => {
  const host: string[] = [];
  const h = await run({ tool: { name: "agent_restore_permissions", inputSchema: schema }, writeAllowed: ["agent_restore_permissions"],
    hostConfirmation: ({ remoteName }) => { host.push(remoteName); return "none"; },
    confirm: async () => ({ confirmed: false, result: { cancelled: true } }) });
  assert.deepEqual(await h.result, { federated: { connectionId: "service", tool: "agent_restore_permissions" }, ran: false, cancelled: true });
  assert.deepEqual(host, ["agent_restore_permissions"]);
  assert.deepEqual(h.cards.map((card) => card.remoteName), ["agent_restore_permissions"]);
  assert.deepEqual(h.session.calls, []);
});

test("fed-security 2: host policy adds a card to a call Jini would run directly", async () => {
  const h = await run({ tool: { name: "update_post", inputSchema: schema }, writeAllowed: ["update_post"], hostConfirmation: () => "confirm-destructive",
    confirm: async () => ({ confirmed: false, result: { cancelled: true } }) });
  await h.result;
  assert.equal(h.cards.length, 1);
  assert.equal(h.cards[0]!.destructive, true);
  assert.deepEqual(h.session.calls, []);
});

test("fed-security 2: host policy receives the frozen call arguments and the admitted hints", async () => {
  const seen: unknown[] = [];
  const h = await run({ tool: { name: "update_post", inputSchema: schema, annotations: { readOnlyHint: false } }, writeAllowed: ["update_post"],
    hostConfirmation: (call) => { seen.push(call); return "none"; } });
  await h.result;
  assert.deepEqual(seen, [{ remoteName: "update_post", arguments: { id: "one" }, declaredAnnotations: { readOnlyHint: false } }]);
  assert.deepEqual(h.cards, []);
  assert.equal(h.session.calls.length, 1);
});

// ---- 3. Nothing parked behind a card outlives a revocation ---------------------------------------

test("fed-security 3: a connection revoked while the card is parked refuses the approved call and sends nothing", async () => {
  let revoked = false;
  const h = await run({ tool: { name: "delete_project", inputSchema: schema, annotations: { destructiveHint: true } }, writeAllowed: ["delete_project"],
    assertConnectionUsable: () => { if (revoked) throw new Error("refused:removed"); },
    confirm: async () => { revoked = true; return { confirmed: true }; } });
  await assert.rejects(h.result, /refused:removed/);
  assert.deepEqual(h.events, ["liveness", "permission", "card", "liveness"]);
  assert.deepEqual(h.session.calls, []);
});

test("fed-security 3: a write grant withdrawn while the card is parked refuses the approved call", async () => {
  let current = roster(["create_project"]);
  const h = await run({ tool: { name: "create_project", inputSchema: schema, annotations: { readOnlyHint: false, destructiveHint: true } },
    writeAllowed: ["create_project"], assertConnectionUsable: revocationGate(() => current),
    confirm: async () => { current = roster([]); return { confirmed: true }; } });
  await assert.rejects(h.result, /refused:write-not-allowed/);
  assert.equal(h.cards.length, 1);
  assert.deepEqual(h.session.calls, []);
});

test("fed-security 3: a permission lost while the card is parked refuses the approved call", async () => {
  let allowed = true;
  const h = await run({ tool: { name: "delete_project", inputSchema: schema, annotations: { destructiveHint: true } }, writeAllowed: ["delete_project"],
    allow: () => allowed, confirm: async () => { allowed = false; return { confirmed: true }; } });
  await assert.rejects(h.result, /not authorized/);
  assert.deepEqual(h.events, ["liveness", "permission", "card", "liveness", "permission"]);
  assert.deepEqual(h.session.calls, []);
});

test("fed-security 3: a run cancelled while the card is parked is abandoned, not sent", async () => {
  const controller = new AbortController();
  const h = await run({ tool: { name: "delete_project", inputSchema: schema, annotations: { destructiveHint: true } }, writeAllowed: ["delete_project"],
    signal: controller.signal, confirm: async () => { controller.abort(); return { confirmed: true }; } });
  assert.deepEqual(await h.result, { federated: { connectionId: "service", tool: "delete_project" }, ran: false, cancelled: false, reason: "abandoned" });
  assert.deepEqual(h.session.calls, []);
});

test("fed-security 3: an approved call that still clears every check is sent once, after the re-check", async () => {
  const h = await run({ tool: { name: "delete_project", inputSchema: schema, annotations: { destructiveHint: true } }, writeAllowed: ["delete_project"] });
  await h.result;
  assert.deepEqual(h.events, ["liveness", "permission", "card", "liveness", "permission"]);
  assert.deepEqual(h.session.calls, [{ name: "delete_project", arguments: { id: "one" } }]);
});

test("fed-security 3: a call with no card is checked once — the re-check belongs to the approval wait", async () => {
  const h = await run({ tool: { name: "list_tables", inputSchema: schema } });
  await h.result;
  assert.deepEqual(h.events, ["liveness", "permission"]);
  assert.equal(h.session.calls.length, 1);
});
