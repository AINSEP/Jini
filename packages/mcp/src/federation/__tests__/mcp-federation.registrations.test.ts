import { createDefaultConnect } from "../stdio/default-connect.js";
import { IDENTITY_STDIO_LAUNCH_RESOLVER } from "../stdio/stdio-launch-resolver.js";
import { messages as federationMessages, clientInfo, testPermissionGate } from "./fixtures.js";
import assert from "node:assert/strict";
import { test, onTestFinished, vi } from "vitest";

import type {
  ToolExecutionContext,
  ToolDescriptor,
  ToolRegistration,
  ToolRegistry,
} from "@jini-ai/core";

import { TestPermissionDeniedError as ForbiddenError } from "./fixtures.js";
import { InMemoryMcpSession } from "../testing/adapter.memory.js";
import { attachFederatedMcpTools } from "../bootstrap.js";
import type { ResolvedFederatedConnection } from "../config.js";
import { McpAuthFailedError } from "../mcp-protocol.js";
import type { FederatedMcpConnectionConfig, RemoteToolDescriptor } from "../ports.js";
import {
  registerFederatedMcpPreset,
  resetFederatedMcpPresetsForTests,
} from "../presets.js";
import { buildFederatedMcpRegistrations, federateSession } from "../registrations.js";
import { FEDERATED_ENTITY_TYPE, FEDERATED_TOOL_PERMISSION } from "../trust.js";

/**
 * @file The federation wiring half: that an admitted remote tool becomes a real `ToolRegistration`,
 * that its handler runs Example's OWN authorization before anything crosses the network, that the
 * remote sees its own name rather than Example's namespaced id, that results come back inside the
 * untrusted envelope — plus the preset-registry seam and the fail-open bootstrap.
 *
 * Vendor-blind by construction: nothing here imports a preset module. Where a preset is needed, the
 * test registers its own fake one through `presets.ts`, which is also the most direct check that the
 * seam works for a vendor core has never heard of.
 *
 * The `fakeDeps` here follows `tool-registrations.database-recovery.test.ts`'s technique exactly:
 * an `order` array recording every authorize call and every outbound tool call, so "authorized
 * BEFORE anything left the building" is a directly observable sequence rather than an inference.
 */

const WORKSPACE_ID = "ws-federation";
const PRINCIPAL_ID = "principal-under-test";

const OBJECT_SCHEMA = { type: "object", properties: { schemas: { type: "array" } }, additionalProperties: false } as const;

const CONFIG: FederatedMcpConnectionConfig = {
  connectionId: "supabase",
  label: "Supabase (project abcdefghijklmnop)",
  allowedToolNames: ["list_tables", "get_advisors"],
  // No write-authorized tools in this suite's fixture — none of the cases here are about R3's
  // write-list override, which is covered by `mcp-federation.trust.test.ts`.
  writeAllowedToolNames: [],
  connectTimeoutMs: 1_000,
  callTimeoutMs: 1_000,
  maxResultBytes: 4_096,
  maxTools: 8,
};

const REMOTE_TOOLS: RemoteToolDescriptor[] = [
  { name: "list_tables", description: "Lists all tables in the database.", inputSchema: OBJECT_SCHEMA, annotations: { readOnlyHint: true } },
  { name: "get_advisors", description: "Security and performance advisors.", inputSchema: OBJECT_SCHEMA },
  // Advertised but never allowlisted — the tool an operator did not ask for.
  { name: "execute_sql", description: "Runs arbitrary SQL.", inputSchema: OBJECT_SCHEMA, annotations: { readOnlyHint: true } },
];

function fakeDeps(options: { allow?: boolean | undefined } = {}) {
  const allow = options.allow ?? true;
  const order: string[] = [];
  const authorizeCalls: Array<Record<string, unknown>> = [];

  const authorize = async (params: Record<string, unknown>) => {
    authorizeCalls.push(params);
    order.push("authorize");
    return allow ? { allowed: true, reason: "matched" } : { allowed: false, reason: "insufficient_permission" };
  };

  return { deps: { messages: federationMessages, errorCode: "EXTERNAL_MCP", permissionGate: testPermissionGate({ authorize: authorize, scope: WORKSPACE_ID }), scope: WORKSPACE_ID }, order, authorizeCalls };
}

function toolContext(input: unknown): ToolExecutionContext {
  return {
    executionId: "exec-1",
    principal: { id: PRINCIPAL_ID },
    run: { id: "run-1" },
    input,
    signal: new AbortController().signal,
  };
}

function sessionFor(order?: string[] | undefined): InMemoryMcpSession {
  return new InMemoryMcpSession({ tools: REMOTE_TOOLS }, { onCall: ({ name, args }) => {
      order?.push(`remote:${name}`);
      return { content: [{ type: "text", text: `rows for ${name} ${JSON.stringify(args)}` }] };
    } });
}

function registrationFor(registrations: ToolRegistration[], toolId: string): ToolRegistration {
  const found = registrations.find((registration) => registration.descriptor.id === toolId);
  assert.ok(found, `expected a registration for ${toolId}`);
  return found;
}

// ---------------------------------------------------------------------------
// Liveness gate — `FederationDeps.assertConnectionUsable`
//
// Nothing in `mcp-federation/` unregisters a federated tool, and it must not: `buildToolCatalogQuery`
// snapshots the registry into a one-shot FTS index, so a removed tool would stay discoverable while
// becoming unexecutable. The gate is what makes a dead connection refuse AT THE CALL with something
// a model can act on, instead of a transient-looking transport error it will retry forever.
// ---------------------------------------------------------------------------

test("with no gate configured, behaviour is exactly what it was before the gate existed", async () => {
  const order: string[] = [];
  const { deps } = fakeDeps();
  const { registrations } = await federateSession({ session: sessionFor(order), config: CONFIG, deps, nativeToolIds: new Set() });

  await registrationFor(registrations, "mcp__supabase__list_tables").handler(toolContext({}));

  assert.deepEqual(order, ["remote:list_tables"]);
});

test("a gate that refuses stops the call BEFORE anything crosses the network", async () => {
  const order: string[] = [];
  const base = fakeDeps();
  const deps = {
    ...base.deps,
    assertConnectionUsable: ({ connectionId }: { connectionId: string }) => {
      order.push(`gate:${connectionId}`);
      throw new Error("supabase is disconnected: its authorization expired. Do not retry this tool.");
    },
  };
  const { registrations } = await federateSession({ session: sessionFor(order), config: CONFIG, deps, nativeToolIds: new Set() });

  await assert.rejects(
    () => registrationFor(registrations, "mcp__supabase__list_tables").handler(toolContext({})),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "supabase is disconnected: its authorization expired. Do not retry this tool.",
  );

  // The gate ran, and nothing else did — no authorize, no outbound call.
  assert.deepEqual(order, ["gate:supabase"]);
  assert.deepEqual(base.order, []);
});

test("the gate runs BEFORE the permission check, so a disconnected server is not reported as a permission problem", async () => {
  const order: string[] = [];
  const base = fakeDeps({ allow: false });
  const deps = {
    ...base.deps,
    assertConnectionUsable: ({ connectionId }: { connectionId: string }) => {
      order.push(`gate:${connectionId}`);
      throw new Error("disconnected");
    },
  };
  const { registrations } = await federateSession({ session: sessionFor(), config: CONFIG, deps, nativeToolIds: new Set() });

  await assert.rejects(
    () => registrationFor(registrations, "mcp__supabase__list_tables").handler(toolContext({})),
    (error: unknown) => error instanceof Error && error.message === "disconnected",
  );
  assert.deepEqual(order, ["gate:supabase"]);
});

test("a gate that passes lets the call through unchanged, and is asked about THIS connection", async () => {
  const asked: string[] = [];
  const order: string[] = [];
  const base = fakeDeps();
  const deps = {
    ...base.deps,
    assertConnectionUsable: async ({ connectionId }: { connectionId: string }) => {
      asked.push(connectionId);
    },
  };
  const { registrations } = await federateSession({ session: sessionFor(order), config: CONFIG, deps, nativeToolIds: new Set() });

  await registrationFor(registrations, "mcp__supabase__list_tables").handler(toolContext({}));

  assert.deepEqual(asked, ["supabase"]);
  assert.deepEqual(order, ["remote:list_tables"]);
});

// ---------------------------------------------------------------------------
// onAuthFailed — a token valid at CONNECT time (so the gate above lets the call through) can still
// die mid-session, since there is no periodic refresh. Discovered only when the live call itself
// rejects with `McpAuthFailedError` — this is what stops THAT failure reading like a generic,
// retry-worthy transport error.
// ---------------------------------------------------------------------------

test("with no onAuthFailed configured, a live auth failure propagates unchanged", async () => {
  const { deps } = fakeDeps();
  const session = new InMemoryMcpSession({ tools: REMOTE_TOOLS }, { onCall: () => {
      throw new McpAuthFailedError({ message: "mcp-federation: the server refused 'tools/call' with 401" });
    } });
  const { registrations } = await federateSession({ session, config: CONFIG, deps, nativeToolIds: new Set() });

  await assert.rejects(
    () => registrationFor(registrations, "mcp__supabase__list_tables").handler(toolContext({})),
    (error: unknown) => error instanceof McpAuthFailedError,
  );
});

test("onAuthFailed runs on a live McpAuthFailedError, naming the connection, and its thrown result replaces the propagated error", async () => {
  const seen: Array<{ connectionId: string; error: unknown }> = [];
  const base = fakeDeps();
  const translated = new Error("supabase is disconnected: its authorization expired or was revoked. Do not retry this tool.");
  const deps = {
    ...base.deps,
    onAuthFailed: async ({ connectionId, error }: { connectionId: string; error: McpAuthFailedError }): Promise<never> => {
      seen.push({ connectionId, error });
      throw translated;
    },
  };
  const session = new InMemoryMcpSession({ tools: REMOTE_TOOLS }, { onCall: () => {
      throw new McpAuthFailedError({ message: "mcp-federation: the server refused 'tools/call' with 401" });
    } });
  const { registrations } = await federateSession({ session, config: CONFIG, deps, nativeToolIds: new Set() });

  await assert.rejects(() => registrationFor(registrations, "mcp__supabase__list_tables").handler(toolContext({})), (error: unknown) => error === translated);

  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.connectionId, "supabase");
  assert.ok(seen[0]?.error instanceof McpAuthFailedError);
});

test("onAuthFailed does NOT run for an ordinary transport failure — only an auth failure is durable", async () => {
  const seen: string[] = [];
  const base = fakeDeps();
  const deps = {
    ...base.deps,
    onAuthFailed: async ({ connectionId }: { connectionId: string }): Promise<never> => {
      seen.push(connectionId);
      throw new Error("must not be reached");
    },
  };
  const ordinary = new Error("mcp-federation: the request timed out after 1000ms");
  const session = new InMemoryMcpSession({ tools: REMOTE_TOOLS }, { onCall: () => {
      throw ordinary;
    } });
  const { registrations } = await federateSession({ session, config: CONFIG, deps, nativeToolIds: new Set() });

  await assert.rejects(() => registrationFor(registrations, "mcp__supabase__list_tables").handler(toolContext({})), (error: unknown) => error === ordinary);

  assert.deepEqual(seen, [], "a transient transport fault must not be treated as a durable auth failure");
});

test("the liveness gate receives the tool's remote name, declared annotations and the connection origin — external-mcp-revocation.ts's per-call input", async () => {
  const seenCalls: unknown[] = [];
  const base = fakeDeps();
  const deps = {
    ...base.deps,
    assertConnectionUsable: ({ connectionId: _connectionId, call }: { connectionId: string; call: unknown }) => {
      seenCalls.push(call);
    },
  };
  const configWithOrigin = { ...CONFIG, origin: { kind: "roster" as const, admissionRevision: "rev-abc" } };
  const { registrations } = await federateSession({ session: sessionFor(), config: configWithOrigin, deps, nativeToolIds: new Set() });

  await registrationFor(registrations, "mcp__supabase__list_tables").handler(toolContext({}));

  assert.deepEqual(seenCalls, [
    { remoteName: "list_tables", declaredAnnotations: { readOnlyHint: true }, origin: configWithOrigin.origin },
  ]);
});

// ---------------------------------------------------------------------------
// Registration shape
// ---------------------------------------------------------------------------

test("only allowlisted remote tools become registrations, and their ids are namespaced", async () => {
  const { deps } = fakeDeps();
  const { registrations, report } = await federateSession({ session: sessionFor(), config: CONFIG, deps, nativeToolIds: new Set() });

  assert.deepEqual(
    registrations.map((registration) => registration.descriptor.id),
    ["mcp__supabase__list_tables", "mcp__supabase__get_advisors"],
  );
  assert.equal(report.refused.find((entry) => entry.remoteName === "execute_sql")?.reason, "not-in-operator-allowlist");
});

test("the published descriptor carries the remote's schema and a provenance-labelled description", async () => {
  const { deps } = fakeDeps();
  const { registrations } = await federateSession({ session: sessionFor(), config: CONFIG, deps, nativeToolIds: new Set() });

  const descriptor: ToolDescriptor = registrationFor(registrations, "mcp__supabase__list_tables").descriptor;
  assert.deepEqual(descriptor.inputSchema, OBJECT_SCHEMA);
  assert.ok(String(descriptor.description).startsWith("[EXTERNAL TOOL — provided by 'Supabase (project abcdefghijklmnop)'"));
  assert.ok(String(descriptor.description).includes("Lists all tables in the database."));
});

test("the ToolPolicy is a pass-through, because the handler is this tool's one authorization evaluator", async () => {
  const { deps } = fakeDeps();
  const { registrations } = await federateSession({ session: sessionFor(), config: CONFIG, deps, nativeToolIds: new Set() });

  for (const registration of registrations) {
    assert.equal(
      registration.policy.authorize({ principal: { id: PRINCIPAL_ID }, run: { id: "run-1" }, tool: registration.descriptor, input: {} }),
      "allow",
    );
  }
});

// ---------------------------------------------------------------------------
// Authorization — the §2 half. See docs/decisions/DR-003-trusted-federation-composition.md.
// ---------------------------------------------------------------------------

test("a federated call authorizes against Example's own evaluator BEFORE anything reaches the remote", async () => {
  const { deps, order, authorizeCalls } = fakeDeps();
  const session = sessionFor(order);
  const { registrations } = await federateSession({ session, config: CONFIG, deps, nativeToolIds: new Set() });

  await registrationFor(registrations, "mcp__supabase__list_tables").handler(toolContext({ schemas: ["public"] }));

  assert.deepEqual(order, ["authorize", "remote:list_tables"]);
  assert.deepEqual(authorizeCalls[0], {
    principalId: PRINCIPAL_ID,
    permission: FEDERATED_TOOL_PERMISSION,
    scope: WORKSPACE_ID,
    entityType: FEDERATED_ENTITY_TYPE,
    entityId: "supabase",
  });
});

test("a denied principal gets ForbiddenError and the remote is never contacted at all", async () => {
  const { deps, order } = fakeDeps({ allow: false });
  const session = sessionFor(order);
  const { registrations } = await federateSession({ session, config: CONFIG, deps, nativeToolIds: new Set() });

  await assert.rejects(
    () => registrationFor(registrations, "mcp__supabase__list_tables").handler(toolContext({})),
    (error: unknown) => error instanceof ForbiddenError,
  );

  // The point of checking before the network call: a denied principal's arguments never leave Example.
  assert.deepEqual(order, ["authorize"]);
  assert.equal(session.calls.length, 0);
});

test("the federated permission is deliberately not the permission of whatever the remote tool resembles", () => {
  // A federated `list_tables` reads somebody else's database, so gating it on `database.read` —
  // Example's statement about THIS site's database — would be the confused-deputy error in permission
  // form. This asserts the choice so a future edit has to argue with it.
  assert.equal(FEDERATED_TOOL_PERMISSION, "admin.integrations.manage");
  assert.notEqual(FEDERATED_TOOL_PERMISSION, "database.read");
});

// ---------------------------------------------------------------------------
// The call itself
// ---------------------------------------------------------------------------

test("the remote receives its OWN tool name, never Example's namespaced id", async () => {
  const { deps } = fakeDeps();
  const session = sessionFor();
  const { registrations } = await federateSession({ session, config: CONFIG, deps, nativeToolIds: new Set() });

  await registrationFor(registrations, "mcp__supabase__list_tables").handler(toolContext({ schemas: ["public"] }));

  assert.deepEqual(session.calls, [{ name: "list_tables", arguments: { schemas: ["public"] } }]);
});

test("a federated result reaches the model inside the untrusted-data envelope, tagged with its provenance", async () => {
  const { deps } = fakeDeps();
  const { registrations } = await federateSession({ session: sessionFor(), config: CONFIG, deps, nativeToolIds: new Set() });

  const result = (await registrationFor(registrations, "mcp__supabase__list_tables").handler(toolContext({}))) as {
    federated: { connectionId: string; tool: string; remoteReportedError: boolean };
    untrusted: string;
  };

  assert.deepEqual(result.federated, { connectionId: "supabase", tool: "list_tables", remoteReportedError: false });
  assert.match(result.untrusted, /<untrusted-data-[0-9a-f-]{36}>/);
  assert.ok(result.untrusted.includes("UNTRUSTED third-party data"));
  assert.ok(result.untrusted.includes("rows for list_tables"));
});

test("a remote result claiming isError is reported as data rather than acted on", async () => {
  const { deps } = fakeDeps();
  const session = new InMemoryMcpSession({ tools: REMOTE_TOOLS }, { onCall: () => ({ content: "denied", isError: true }) });
  const { registrations } = await federateSession({ session, config: CONFIG, deps, nativeToolIds: new Set() });

  const result = (await registrationFor(registrations, "mcp__supabase__list_tables").handler(toolContext({}))) as {
    federated: { remoteReportedError: boolean };
  };

  assert.equal(result.federated.remoteReportedError, true);
});

// ---------------------------------------------------------------------------
// Media — image blocks bypass the untrusted-data TEXT envelope
//
// R7 wraps everything in a JSON-stringified, byte-capped text boundary because that boundary
// defends against prompt injection in TEXT a model reads as instructions. Base64 image bytes are
// not that, and stringifying them into the SAME byte cap only bloats the envelope and then
// truncates the base64 stream at an arbitrary byte, corrupting the image (task #18's actual bug: a
// successful image generation arrived as a wall of truncated base64 text). Images must instead
// reach `@jini-ai/daemon`'s `extractResultMedia` through a top-level `content` array — the exact
// shape `demo-image-tool.ts` already proves end to end through the chat pane.
// ---------------------------------------------------------------------------

test("a federated image result is exposed as a top-level `content` array with the image intact — not stringified, not truncated", async () => {
  const { deps } = fakeDeps();
  // Comfortably under CONFIG.maxResultBytes (4096), so a failure here cannot be explained by size.
  const imageData = "A".repeat(200);
  const session = new InMemoryMcpSession({ tools: REMOTE_TOOLS }, { onCall: () => ({
      content: [
        { type: "text", text: "Generated an image." },
        // Deliberately not PNG — the fix must not assume a mime type.
        { type: "image", mimeType: "image/jpeg", data: imageData },
      ],
    }) });
  const { registrations } = await federateSession({ session, config: CONFIG, deps, nativeToolIds: new Set() });

  const result = (await registrationFor(registrations, "mcp__supabase__list_tables").handler(toolContext({}))) as {
    content: Array<{ type: string; mimeType: string; data: string }>;
    untrusted: string;
  };

  assert.deepEqual(result.content, [{ type: "image", mimeType: "image/jpeg", data: imageData }]);
  assert.ok(result.untrusted.includes("Generated an image."));
  // The image bytes must reach the model exactly once — via `content` — never duplicated into the
  // wrapped text too.
  assert.ok(!result.untrusted.includes(imageData));
});

test("an image over maxResultBytes is dropped rather than truncated into a corrupt image, and the drop is reported", async () => {
  const { deps } = fakeDeps();
  const oversizedData = "B".repeat(CONFIG.maxResultBytes + 1);
  const session = new InMemoryMcpSession({ tools: REMOTE_TOOLS }, { onCall: () => ({ content: [{ type: "image", mimeType: "image/png", data: oversizedData }] }) });
  const { registrations } = await federateSession({ session, config: CONFIG, deps, nativeToolIds: new Set() });

  const result = (await registrationFor(registrations, "mcp__supabase__list_tables").handler(toolContext({}))) as {
    content?: unknown[] | undefined;
    untrusted: string;
  };

  // Never truncated into `content` — a partial base64 stream is a corrupt image, not a degraded one.
  assert.equal(result.content, undefined);
  assert.ok(result.untrusted.includes("image/png"));
  assert.ok(result.untrusted.includes(String(CONFIG.maxResultBytes)));
  // Dropped whole, not partially stringified-then-truncated into the envelope — the failure mode
  // this pins is a wrapped text that STARTS WITH a chunk of the oversized base64 stream, which is
  // exactly what JSON-stringifying-then-byte-capping would produce.
  assert.ok(!result.untrusted.includes(oversizedData.slice(0, 100)));
});

test("a text-only federated result gets no `content` key at all — nothing for extractResultMedia to touch, and R7's shape is unchanged", async () => {
  const { deps } = fakeDeps();
  const { registrations } = await federateSession({ session: sessionFor(), config: CONFIG, deps, nativeToolIds: new Set() });

  const result = (await registrationFor(registrations, "mcp__supabase__list_tables").handler(toolContext({}))) as Record<string, unknown>;

  assert.equal("content" in result, false);
});

test("an omitted input is sent as {}, and a non-object input is refused rather than coerced", async () => {
  const { deps } = fakeDeps();
  const session = sessionFor();
  const { registrations } = await federateSession({ session, config: CONFIG, deps, nativeToolIds: new Set() });
  const registration = registrationFor(registrations, "mcp__supabase__list_tables");

  await registration.handler(toolContext(undefined));
  assert.deepEqual(session.calls[0], { name: "list_tables", arguments: {} });

  await assert.rejects(() => registration.handler(toolContext("just a string")), /input must be an object/);
  await assert.rejects(() => registration.handler(toolContext([1, 2, 3])), /input must be an object/);
});

// ---------------------------------------------------------------------------
// R1 collision, at the registration layer
// ---------------------------------------------------------------------------

test("a federated id colliding with a natively-registered one refuses the whole connection", () => {
  assert.throws(
    () =>
      buildFederatedMcpRegistrations({
        tools: [{ name: "list_tables", inputSchema: OBJECT_SCHEMA }],
        session: sessionFor(),
        config: CONFIG,
        deps: fakeDeps().deps,
        // Simulates a future world where a native tool happens to be called this.
        nativeToolIds: new Set(["mcp__supabase__list_tables"]),
      }),
    /must never be able to shadow/,
  );
});

// ---------------------------------------------------------------------------
// The preset registry — the core/plugin seam
// ---------------------------------------------------------------------------

const FAKE_LAUNCH = { command: "unused", args: [] as string[], env: {} };

/** A vendor core has never heard of, resolved entirely through the public seam. */
function fakePreset(options: { presetId: string; resolve: (required: { env: NodeJS.ProcessEnv }) => ResolvedFederatedConnection | null }) {
  registerFederatedMcpPreset({ preset: { presetId: options.presetId, resolve: options.resolve } });
}

test("a preset registered from outside core is resolved and connected without core knowing the vendor", async () => {
  onTestFinished(() => resetFederatedMcpPresetsForTests({}));
  resetFederatedMcpPresetsForTests({});

  const seenEnv: NodeJS.ProcessEnv[] = [];
  fakePreset({
    presetId: "acme",
    resolve: ({ env }) => {
      seenEnv.push(env);
      return { config: { ...CONFIG, connectionId: "acme" }, launch: FAKE_LAUNCH };
    },
  });

  const registry = fakeRegistry(["database_get_health"]);
  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: async () => sessionFor() }, { logger: collectingLogger().logger, env: { SOME_VENDOR_SETTING: "1" } });

  assert.deepEqual(result.registeredToolIds, ["mcp__acme__list_tables", "mcp__acme__get_advisors"]);
  // The env bag reaches the preset by injection, not by the preset reading `process.env` itself.
  assert.deepEqual(seenEnv, [{ SOME_VENDOR_SETTING: "1" }]);
});

test("a preset that declines contributes nothing, silently — 'not configured' is the default state", async () => {
  onTestFinished(() => resetFederatedMcpPresetsForTests({}));
  resetFederatedMcpPresetsForTests({});

  fakePreset({ presetId: "acme", resolve: () => null });

  const { messages, logger } = collectingLogger();
  const registry = fakeRegistry();
  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: createDefaultConnect({ resolver: IDENTITY_STDIO_LAUNCH_RESOLVER, clientInfo, messages: federationMessages, bearerToken: () => undefined }) }, { logger, env: {} });

  assert.deepEqual(result.registeredToolIds, []);
  assert.deepEqual(messages, [], "an unconfigured preset must not log every boot");
});

test("two presets both contribute, and one vendor's broken config does not disable the other's working one", async () => {
  onTestFinished(() => resetFederatedMcpPresetsForTests({}));
  resetFederatedMcpPresetsForTests({});

  fakePreset({
    presetId: "broken",
    resolve: () => {
      throw new Error("BROKEN_VENDOR_TOKEN is empty");
    },
  });
  fakePreset({ presetId: "working", resolve: () => ({ config: { ...CONFIG, connectionId: "working" }, launch: FAKE_LAUNCH }) });

  const { messages, logger } = collectingLogger();
  const registry = fakeRegistry();
  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: async () => sessionFor() }, { logger, env: {} });

  assert.deepEqual(result.registeredToolIds, ["mcp__working__list_tables", "mcp__working__get_advisors"]);
  assert.ok(messages.some((message) => message.includes("preset 'broken' configuration is invalid, continuing without federated tools")));
});

test("re-registering the same presetId replaces it, so a module imported twice cannot self-collide", async () => {
  onTestFinished(() => resetFederatedMcpPresetsForTests({}));
  resetFederatedMcpPresetsForTests({});

  // Two connections with the same `connectionId` would make R1's collision assertion drop the
  // second one for shadowing what is really itself.
  fakePreset({ presetId: "acme", resolve: () => ({ config: { ...CONFIG, connectionId: "acme" }, launch: FAKE_LAUNCH }) });
  fakePreset({ presetId: "acme", resolve: () => ({ config: { ...CONFIG, connectionId: "acme" }, launch: FAKE_LAUNCH }) });

  const { messages, logger } = collectingLogger();
  const registry = fakeRegistry();
  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: async () => sessionFor() }, { logger, env: {} });

  assert.deepEqual(result.registeredToolIds, ["mcp__acme__list_tables", "mcp__acme__get_advisors"]);
  assert.equal(
    messages.some((message) => message.includes("must never be able to shadow")),
    false,
  );
});

// ---------------------------------------------------------------------------
// Bootstrap — fail-open, because a third party must never break Example's boot
// ---------------------------------------------------------------------------

function fakeRegistry(seed: string[] = []): ToolRegistry & { registered: ToolRegistration[] } {
  const registered: ToolRegistration[] = [];
  const descriptors: ToolDescriptor[] = seed.map((id) => ({ id }));
  return {
    registered,
    register(registration) {
      registered.push(registration);
      descriptors.push(registration.descriptor);
    },
    has: ({ toolId }: { toolId: string }) => descriptors.some((descriptor) => descriptor.id === toolId),
    list: () => descriptors,
  };
}

function collectingLogger() {
  const messages: string[] = [];
  return { messages, logger: { error: () => undefined, info: ({ message: m }: { message: string }) => messages.push(`info:${m}`), warn: ({ message: m }: { message: string }) => messages.push(`warn:${m}`) } };
}

test("with no configuration, the daemon boots exactly as it did before federation existed", async () => {
  const registry = fakeRegistry(["database_get_health"]);
  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: createDefaultConnect({ resolver: IDENTITY_STDIO_LAUNCH_RESOLVER, clientInfo, messages: federationMessages, bearerToken: () => undefined }) }, { env: {} });

  assert.deepEqual(result.registeredToolIds, []);
  assert.equal(registry.registered.length, 0);
});

test("omitting `env` reads the real process.env, not just the explicit `env: {}` every other test here supplies", async () => {
  resetFederatedMcpPresetsForTests({});
  onTestFinished(() => resetFederatedMcpPresetsForTests({}));
  const key = "EXAMPLE_TEST_FEDERATION_ENV_SENTINEL";
  const prior = process.env[key];
  process.env[key] = "env-from-process";
  onTestFinished(() => { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; });
  let seen: NodeJS.ProcessEnv | undefined;
  registerFederatedMcpPreset({ preset: { presetId: "env-observer", resolve: ({ env }) => { seen = env; return null; } } });
  const registry = fakeRegistry(["database_get_health"]);
  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: createDefaultConnect({ resolver: IDENTITY_STDIO_LAUNCH_RESOLVER, clientInfo, messages: federationMessages, bearerToken: () => undefined }) }, {  });
  assert.equal(seen, process.env, "the preset must receive the real environment");
  assert.equal(seen?.[key], "env-from-process");
  assert.deepEqual(result.registeredToolIds, []);
  assert.equal(registry.registered.length, 0);
});

test("a configured connection registers its admitted tools into the daemon's registry", async () => {
  const registry = fakeRegistry(["database_get_health"]);
  const { messages, logger } = collectingLogger();

  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: async () => sessionFor() }, { logger, connections: [{ config: CONFIG, launch: { command: "unused", args: [], env: {} } }] });

  assert.deepEqual(result.registeredToolIds, ["mcp__supabase__list_tables", "mcp__supabase__get_advisors"]);
  assert.equal(registry.registered.length, 2);
  // Refusals are logged rather than swallowed, so an operator can see what the remote tried to expose.
  assert.ok(messages.some((message) => message.includes("refused remote tool 'execute_sql'")));
});

test("an unreachable or broken remote is stepped over — Example's own catalog is never held hostage", async () => {
  const registry = fakeRegistry(["database_get_health"]);
  const { messages, logger } = collectingLogger();

  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: async () => {
      throw new Error("connect timed out after 15000ms");
    } }, { logger, connections: [{ config: CONFIG, launch: { command: "unused", args: [], env: {} } }] });

  assert.deepEqual(result.registeredToolIds, []);
  assert.equal(registry.registered.length, 0);
  assert.ok(messages.some((message) => message.includes("failed, continuing without its tools")));
});

test("a remote that connects but cannot enumerate is stepped over, and its session is closed", async () => {
  const registry = fakeRegistry();
  const { logger } = collectingLogger();
  const session = new InMemoryMcpSession({ tools: [] }, { onListTools: async () => {
      throw new Error("remote returned JSON-RPC error -32000: invalid access token");
    } });

  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: async () => session }, { logger, connections: [{ config: CONFIG, launch: { command: "unused", args: [], env: {} } }] });

  assert.deepEqual(result.registeredToolIds, []);
  assert.equal(session.closed, true, "a session that failed mid-setup must not leak its child process");
});

test("a remote that fails mid-setup AND whose own close() also rejects still resolves cleanly — cleanup failure is swallowed, not left to crash or unhandled-reject the boot", async () => {
  const registry = fakeRegistry();
  const { logger } = collectingLogger();
  const session = {
    listTools: async () => {
      throw new Error("remote returned JSON-RPC error -32000: invalid access token");
    },
    callTool: async () => {
      throw new Error("must not be called");
    },
    close: async () => {
      throw new Error("close failed too — the child process was already dead");
    },
  };

  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: async () => session }, { logger, connections: [{ config: CONFIG, launch: { command: "unused", args: [], env: {} } }] });

  assert.deepEqual(result.registeredToolIds, []);
  assert.deepEqual(result.sessions, [], "a session that failed mid-setup is never returned as a live session to close again");
});

test("an invalid-but-enabled configuration warns and continues rather than throwing out of boot", async () => {
  onTestFinished(() => resetFederatedMcpPresetsForTests({}));
  resetFederatedMcpPresetsForTests({});

  // A preset THROWS (rather than returning null) exactly when the operator asked for a connection
  // and got the settings wrong — the one case that must be loud without being fatal.
  fakePreset({
    presetId: "acme",
    resolve: () => {
      throw new Error("ACME_MCP_ENABLED is set but ACME_MCP_TOKEN is empty");
    },
  });

  const registry = fakeRegistry();
  const { messages, logger } = collectingLogger();

  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: createDefaultConnect({ resolver: IDENTITY_STDIO_LAUNCH_RESOLVER, clientInfo, messages: federationMessages, bearerToken: () => undefined }) }, { logger, env: {} });

  assert.deepEqual(result.registeredToolIds, []);
  assert.ok(messages.some((message) => message.includes("configuration is invalid, continuing without federated tools")));
});

test("a remote whose id would collide with a native tool loses the whole connection, not just that tool", async () => {
  const registry = fakeRegistry(["mcp__supabase__list_tables"]);
  const { messages, logger } = collectingLogger();

  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: async () => sessionFor() }, { logger, connections: [{ config: CONFIG, launch: { command: "unused", args: [], env: {} } }] });

  // Dropping the connection whole is the safe direction: "no federated tools" is always acceptable.
  assert.deepEqual(result.registeredToolIds, []);
  assert.equal(registry.registered.length, 0);
  assert.ok(messages.some((message) => message.includes("must never be able to shadow")));
});

// ---------------------------------------------------------------------------
// Bootstrap defaults — the production `logger`/`connect` a caller gets when it omits both
// ---------------------------------------------------------------------------

test("omitting `logger` uses the real console logger — info and warn both reach console.info/console.warn", async () => {
  onTestFinished(() => { vi.restoreAllMocks(); });
  const logLines: string[] = [];
  const warnLines: string[] = [];
  vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnLines.push(args.map(String).join(" "));
  });

  const registry = fakeRegistry(["database_get_health"]);
  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: async () => sessionFor() }, { connections: [{ config: CONFIG, launch: { command: "unused", args: [], env: {} } }] });

  assert.deepEqual(result.registeredToolIds, ["mcp__supabase__list_tables", "mcp__supabase__get_advisors"]);
  assert.ok(
    logLines.some((line) => line.includes("agent-daemon") && line.includes("registered 2 federated tool(s)")),
    `expected an info line through console.info; got: ${JSON.stringify(logLines)}`,
  );
  assert.ok(
    warnLines.some((line) => line.includes("agent-daemon") && line.includes("refused remote tool 'execute_sql'")),
    `expected a warn line through console.warn; got: ${JSON.stringify(warnLines)}`,
  );
});

// ---------------------------------------------------------------------------
// defaultConnect — the real production session factory: a genuine spawn + handshake, not a double.
// Exercises `spawnMcpStdioChannel`'s real child-process path too, not just the scripted channel
// seam every other test in this file (and adapter.stdio.ts's own tests) use.
// ---------------------------------------------------------------------------

/** A real MCP stdio fixture: handshake, one read-only echo tool, and tools/call replies. */
const MINIMAL_MCP_SERVER_SCRIPT = `
process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\\n")) !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.id === undefined) continue;
    if (message.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "fixture", version: "1" } } }) + "\\n");
    } else if (message.method === "tools/list") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "echo_fixture", description: "Echoes the supplied input.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }] } }) + "\\n");
    } else if (message.method === "tools/call") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: JSON.stringify(message.params) }] } }) + "\\n");
    }
  }
});
`;

/** A real child process that never answers anything — for exercising `defaultConnect`'s own
 *  connect-timeout race, as opposed to the adapter's per-request timeout. */
const NEVER_RESPONDS_SCRIPT = `setInterval(() => {}, 1000);`;

test("injected production `connect` uses the real defaultConnect — a genuine spawn + handshake against a real child process", async () => {
  const registry = fakeRegistry();
  const { messages, logger } = collectingLogger();

  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: createDefaultConnect({ resolver: IDENTITY_STDIO_LAUNCH_RESOLVER, clientInfo, messages: federationMessages, bearerToken: () => undefined }) }, { logger, connections: [
      {
        config: { ...CONFIG, allowedToolNames: ["echo_fixture"] },
        launch: { command: process.execPath, args: ["-e", MINIMAL_MCP_SERVER_SCRIPT], env: {} },
      },
    ] });

  try {
    assert.deepEqual(result.registeredToolIds, ["mcp__supabase__echo_fixture"]);
    assert.equal(result.sessions.length, 1);
    const registration = registrationFor(registry.registered, "mcp__supabase__echo_fixture");
    const called = await registration.handler(toolContext({ token: "round-trip-sentinel" })) as { federated: unknown; untrusted: string };
    assert.deepEqual(called.federated, { connectionId: "supabase", tool: "echo_fixture", remoteReportedError: false });
    const payload = called.untrusted.split("\n").find((line) => line.startsWith('{"content":'));
    assert.ok(payload, "the registered handler must carry the child's tool reply");
    const remote = JSON.parse(payload) as { content: Array<{ type: string; text: string }> };
    assert.equal(remote.content.length, 1);
    assert.equal(remote.content[0]!.type, "text");
    assert.deepEqual(JSON.parse(remote.content[0]!.text), { name: "echo_fixture", arguments: { token: "round-trip-sentinel" } });
    assert.equal(
      messages.some((message) => message.includes("failed")),
      false,
      `a real handshake against a well-behaved server must not be reported as a failure; got: ${JSON.stringify(messages)}`,
    );
  } finally {
    // `attachFederatedMcpTools` hands live sessions back for the CALLER to close at shutdown (see
    // its own doc) — it never closes them itself. Leaving this open would leak the real child
    // process and its stdio pipes, which keeps the test runner's event loop alive indefinitely.
    await Promise.all(result.sessions.map((session) => session.close({})));
  }
});

test("defaultConnect's own connect-timeout fires when the child never completes the handshake, and the child is killed", async () => {
  const registry = fakeRegistry();
  const { messages, logger } = collectingLogger();

  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: createDefaultConnect({ resolver: IDENTITY_STDIO_LAUNCH_RESOLVER, clientInfo, messages: federationMessages, bearerToken: () => undefined }) }, { logger, connections: [
      {
        config: { ...CONFIG, connectTimeoutMs: 50 },
        launch: { command: process.execPath, args: ["-e", NEVER_RESPONDS_SCRIPT], env: {} },
      },
    ] });

  assert.deepEqual(result.registeredToolIds, []);
  assert.ok(
    messages.some((message) => message.includes("failed, continuing without its tools") && message.includes("connect timed out after 50ms")),
    `expected defaultConnect's own timeout message; got: ${JSON.stringify(messages)}`,
  );
});

test("defaultConnect: a launch command that does not exist fails the connection through the CHILD PROCESS's own error event, not a hang or an uncaught exception", async () => {
  const registry = fakeRegistry();
  const { messages, logger } = collectingLogger();

  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: createDefaultConnect({ resolver: IDENTITY_STDIO_LAUNCH_RESOLVER, clientInfo, messages: federationMessages, bearerToken: () => undefined }) }, { logger, connections: [
      {
        config: CONFIG,
        launch: { command: "example-mcp-federation-test-nonexistent-binary-xyz", args: [], env: {} },
      },
    ] });

  assert.deepEqual(result.registeredToolIds, []);
  assert.ok(
    messages.some((message) => message.includes("failed, continuing without its tools") && message.includes("child process error")),
    `expected the spawn failure to be reported as a child process error, not silently swallowed or hung on; got: ${JSON.stringify(messages)}`,
  );
});

/** Same handshake as `MINIMAL_MCP_SERVER_SCRIPT`, plus writing to stderr before answering —
 *  `spawnMcpStdioChannel`'s own doc: "stderr is a diagnostic channel... consumed so the pipe cannot
 *  fill and deadlock the child." A server that emits diagnostic noise on stderr must not cause the
 *  handshake to fail, hang, or have that noise misinterpreted as protocol traffic. */
const SERVER_SCRIPT_WITH_STDERR_NOISE = `
// Install the protocol listener only after diagnostics have drained through the pipe.
process.stderr.write("D".repeat(2 * 1024 * 1024), () => {
  ${MINIMAL_MCP_SERVER_SCRIPT}
});
`;

test("defaultConnect: a real child writing to stderr does not fail, hang, or leak into the protocol stream", async () => {
  const registry = fakeRegistry();
  const { messages, logger } = collectingLogger();

  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: createDefaultConnect({ resolver: IDENTITY_STDIO_LAUNCH_RESOLVER, clientInfo, messages: federationMessages, bearerToken: () => undefined }) }, { logger, connections: [
      {
        config: { ...CONFIG, allowedToolNames: [] },
        launch: { command: process.execPath, args: ["-e", SERVER_SCRIPT_WITH_STDERR_NOISE], env: {} },
      },
    ] });

  try {
    assert.deepEqual(result.registeredToolIds, []);
    assert.equal(result.sessions.length, 1, "stderr must drain before the handshake completes");
    const tools = await result.sessions[0]!.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), ["echo_fixture"], "the session remains live after draining diagnostics");
    assert.equal(
      messages.some((message) => message.includes("failed")),
      false,
      `stderr noise must not fail the handshake; got: ${JSON.stringify(messages)}`,
    );
  } finally {
    await Promise.all(result.sessions.map((session) => session.close({})));
  }
});

// ---------------------------------------------------------------------------
// The hosted transport, end to end through the production connect path
// ---------------------------------------------------------------------------

/**
 * A real MCP server over HTTP on loopback, for the same reason the stdio cases spawn a real child:
 * to prove `defaultConnect` picks the right adapter and that a genuine network handshake completes.
 * Everything below the assertion is production code — real fetch, real JSON-RPC, real admission.
 */
async function startLoopbackMcpServer(options: { requireBearer?: string | undefined } = {}): Promise<{
  url: string;
  /** Every Authorization header the server saw, so a test can prove the token really travelled. */
  seenAuth: (string | undefined)[];
  close: () => Promise<void>;
}> {
  const { createServer } = await import("node:http");
  const seenAuth: (string | undefined)[] = [];

  const server = createServer((request, response) => {
    seenAuth.push(request.headers.authorization);
    if (options.requireBearer !== undefined && request.headers.authorization !== `Bearer ${options.requireBearer}`) {
      response.writeHead(401).end();
      return;
    }

    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const message = body === "" ? {} : (JSON.parse(body) as { id?: number | undefined; method?: string | undefined });

      if (message.method === "notifications/initialized") {
        response.writeHead(202).end();
        return;
      }
      const result =
        message.method === "initialize"
          ? { protocolVersion: "2025-06-18", serverInfo: { name: "loopback", version: "1" } }
          : message.method === "tools/list"
            ? { tools: [{ name: "list_tables", description: "Lists all tables.", inputSchema: OBJECT_SCHEMA }] }
            : {};

      response
        .writeHead(200, { "content-type": "application/json", "mcp-session-id": "loopback-session-1" })
        .end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    seenAuth,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("omitting `connect` routes a HOSTED connection to the HTTP adapter — a real handshake over loopback", async () => {
  const registry = fakeRegistry();
  const { messages, logger } = collectingLogger();
  const server = await startLoopbackMcpServer({ requireBearer: "at-live-1" });

  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: createDefaultConnect({ resolver: IDENTITY_STDIO_LAUNCH_RESOLVER, clientInfo, messages: federationMessages, bearerToken: () => undefined }) }, { logger, connections: [
      {
        config: { ...CONFIG, allowedToolNames: ["list_tables"] },
        launch: { url: server.url, headers: { authorization: "Bearer at-live-1" } },
      },
    ] });

  try {
    assert.deepEqual(
      result.registeredToolIds,
      ["mcp__supabase__list_tables"],
      `the hosted tool should have been admitted and registered; log was: ${JSON.stringify(messages)}`,
    );
    // The server refused anything without the bearer, so reaching this line at all proves the token
    // travelled — but assert it directly rather than inferring it from a 200.
    assert.ok(
      server.seenAuth.every((header) => header === "Bearer at-live-1"),
      `every request must carry the token; saw ${JSON.stringify(server.seenAuth)}`,
    );
  } finally {
    await Promise.all(result.sessions.map((session) => session.close({})));
    await server.close();
  }
});

// ---------------------------------------------------------------------------
// `AttachFederatedToolsResult.reports` — the boot admission accounting that was previously computed
// and immediately discarded. Asserted entirely through `attachFederatedMcpTools`'s existing. See docs/decisions/DR-003-trusted-federation-composition.md.
// injectable `connect`/fixture seam — no live daemon process anywhere in this file.
// ---------------------------------------------------------------------------

test("attachFederatedMcpTools returns one report per connection that reached admission, keyed by connectionId", async () => {
  const registry = fakeRegistry();
  const { logger } = collectingLogger();

  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: async () => sessionFor() }, { logger, connections: [{ config: CONFIG, launch: { command: "unused", args: [], env: {} } }] });

  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0]?.connectionId, "supabase");
  assert.deepEqual(
    result.reports[0]?.report.admitted.map((tool) => tool.remoteName),
    ["list_tables", "get_advisors"],
  );
  assert.equal(result.reports[0]?.report.refused.find((entry) => entry.remoteName === "execute_sql")?.reason, "not-in-operator-allowlist");
});

// `isPreset` (2026-09-07): the admin admissions banner needs to tell "no roster card because this
// is a preset, by design" apart from "no roster card because the operator deleted it" — see
// `AttachFederatedToolsResult.reports`'s own doc. `connections` stands in for the preset list (it
// replaces `resolveRegisteredPresets`'s result) and `extraConnections` is the operator roster, so
// this asserts the tag survives from whichever list a connection actually came from.
test("tags each report with whether it came from a preset or the operator's roster", async () => {
  const registry = fakeRegistry();
  const { logger } = collectingLogger();
  const rosterConfig: FederatedMcpConnectionConfig = { ...CONFIG, connectionId: "roster-connection" };

  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: async () => sessionFor() }, { logger, connections: [{ config: CONFIG, launch: { command: "unused", args: [], env: {} } }], extraConnections: [{ config: rosterConfig, launch: { command: "unused", args: [], env: {} } }] });

  assert.equal(result.reports.length, 2);
  assert.equal(result.reports.find((r) => r.connectionId === "supabase")?.isPreset, true);
  assert.equal(result.reports.find((r) => r.connectionId === "roster-connection")?.isPreset, false);
});

test("a connection that fails before admission (bad handshake) contributes no report entry at all", async () => {
  const registry = fakeRegistry();
  const { logger } = collectingLogger();

  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: async () => {
      throw new Error("connect timed out after 15000ms");
    } }, { logger, connections: [{ config: CONFIG, launch: { command: "unused", args: [], env: {} } }] });

  assert.deepEqual(result.reports, []);
});

test("with no connections at all, reports is empty rather than omitted or throwing", async () => {
  const registry = fakeRegistry();
  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: createDefaultConnect({ resolver: IDENTITY_STDIO_LAUNCH_RESOLVER, clientInfo, messages: federationMessages, bearerToken: () => undefined }) }, { env: {} });

  assert.deepEqual(result.reports, []);
});

test("an admitted write-authorized tool is logged as a WARN, naming the connection and the tool", async () => {
  const registry = fakeRegistry();
  const { messages, logger } = collectingLogger();
  const writeConfig: FederatedMcpConnectionConfig = {
    ...CONFIG,
    allowedToolNames: ["generate_image"],
    writeAllowedToolNames: ["generate_image"],
  };
  const session = new InMemoryMcpSession({ tools: [{ name: "generate_image", description: "Generates an image.", inputSchema: OBJECT_SCHEMA, annotations: { readOnlyHint: false } }] }, { onCall: () => ({ content: [{ type: "text", text: "ok" }] }) });

  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: async () => session }, { logger, connections: [{ config: writeConfig, launch: { command: "unused", args: [], env: {} } }] });

  assert.deepEqual(result.registeredToolIds, ["mcp__supabase__generate_image"]);
  assert.ok(
    messages.some((message) => message.includes("warn:") && message.includes("admitted WRITE tool 'generate_image' (operator-authorized)")),
    `expected a WARN line for the admitted write tool; got: ${JSON.stringify(messages)}`,
  );
});

test("a write-authorized name absent from the allowlist is logged as drift, sibling of the allowlistedButAbsent line", async () => {
  const registry = fakeRegistry();
  const { messages, logger } = collectingLogger();
  const driftConfig: FederatedMcpConnectionConfig = {
    ...CONFIG,
    // Write-authorized but never allowlisted — the operator ticked one box and not the other.
    writeAllowedToolNames: ["forgot_to_allowlist"],
  };

  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: async () => sessionFor() }, { logger, connections: [{ config: driftConfig, launch: { command: "unused", args: [], env: {} } }] });

  assert.equal(result.reports[0]?.report.writeAllowedButNotAllowlisted.length, 1);
  assert.ok(
    messages.some(
      (message) =>
        message.includes("warn:") &&
        message.includes("write-authorizes 'forgot_to_allowlist' but it is not in the allowlist"),
    ),
    `expected a WARN drift line; got: ${JSON.stringify(messages)}`,
  );
});

test("a hosted server that rejects the token is reported as a failed connection, and federation continues", async () => {
  const registry = fakeRegistry();
  const { messages, logger } = collectingLogger();
  const server = await startLoopbackMcpServer({ requireBearer: "the-right-token" });

  const result = await attachFederatedMcpTools({ registry, deps: fakeDeps().deps, connect: createDefaultConnect({ resolver: IDENTITY_STDIO_LAUNCH_RESOLVER, clientInfo, messages: federationMessages, bearerToken: () => undefined }) }, { logger, connections: [{ config: CONFIG, launch: { url: server.url, headers: { authorization: "Bearer the-wrong-token" } } }] });

  try {
    assert.deepEqual(result.registeredToolIds, []);
    // Fail-open per connection, and the reason must name reconnection — a 401 here means the stored
    // authorization stopped working, which is an operator action, not a transient network fault.
    assert.ok(
      messages.some((message) => message.includes("401") && message.includes("reconnect it in Settings → External MCP")),
      `expected a reported 401 naming the fix; got: ${JSON.stringify(messages)}`,
    );
  } finally {
    await server.close();
  }
});
