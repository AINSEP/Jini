import assert from "node:assert/strict";
import { test } from "vitest";

import { ToolInputError, type ToolExecutionContext, type ToolHandler, type ToolRegistration } from "@jini-ai/core";
import { InMemoryWebhookDeliveryRepo, InMemoryWebhookSubscriptionRepo } from "../../__tests__/memory-fixtures.js";
import type { WebhookDeliveryRecord, WebhookSubscriptionRecord } from "../../types.js";
import { getWebhooksAgentToolCatalog } from "../agent-tools.js";
import type { WebhooksDeleteSteps, WebhooksNotConfirmedResult, WebhooksPackageToolDeps } from "../tool-handlers.types.js";
import { buildWebhooksToolRegistrations, webhooksDerivedRisk } from "../tool-registrations.js";
import { toWebhookDeliveryView } from "../tool-views.js";

/**
 * @file The webhook tool registrations over in-memory fakes of their ports: the catalog's ids and
 * the authored risk map, the permission refusal of every tool, one success view per tool, that no
 * view exposes signing material, the typed-error mapping, the stale-version conflict, and the
 * delete's three confirmation outcomes against a fake confirmation port. Host metadata is
 * deliberately absent from these registrations: a host binds it around them.
 */

const WORKSPACE_ID = "ws-webhook-tools";
const PRINCIPAL_ID = "principal-under-test";
const NOW = "2026-11-17T00:00:00.000Z";
const SECRET_MARKERS = ["MARKER-SIGNING-SECRET", "MARKER-PREVIOUS-SECRET", "MARKER-SEALED-BLOB", "MARKER-DELIVERY-SIGNATURE"] as const;

const TOOL_IDS = [
  "webhooks_list_subscriptions",
  "webhooks_get_deliveries",
  "webhooks_create_subscription",
  "webhooks_update_subscription",
  "webhooks_pause_subscription",
  "webhooks_delete_subscription",
] as const;

type Outcome = "confirm" | "declined" | "expired" | "abandoned";

/** Runs the delete's steps the way a host's approval handler would, with the human's answer fixed. */
function fakeConfirmDelete(outcome: Outcome, seen: { runs: number; prepared: unknown[] }): (steps: WebhooksDeleteSteps) => ToolHandler {
  return (steps) => async (ctx, options) => {
    const prepared = await steps.prepare({ ctx }, options ?? {});
    seen.prepared.push(prepared);
    if (outcome !== "confirm") return steps.declined({ reason: outcome, prepared });
    seen.runs += 1;
    return steps.run({ ctx, prepared, confirmer: { id: ctx.principal.id, kind: "user" } }, options ?? {});
  };
}

const notConfirmedResult: WebhooksNotConfirmedResult = ({ reason }) =>
  reason === "declined" ? { cancelled: true, note: "not confirmed: declined" } : { cancelled: false, reason, note: `not confirmed: ${reason}` };

function seededRecord(id: string): WebhookSubscriptionRecord {
  return {
    id, workspaceId: WORKSPACE_ID, ownerPrincipalId: "owner-1", label: `Hook ${id}`, targetUrl: "https://example.test/hooks/orders",
    topics: ["order.created"], secretVersion: 3, previousSecretVersion: 2, status: "active", createdByPrincipalId: "creator-1",
    createdByPluginId: "plugin-1", createdAt: NOW, updatedAt: NOW, disabledAt: null, version: 1,
    signingSecret: SECRET_MARKERS[0], previousSecret: SECRET_MARKERS[1], sealedSecret: SECRET_MARKERS[2],
  } as WebhookSubscriptionRecord;
}

function seededDelivery(id: string, createdAt: string): WebhookDeliveryRecord {
  return {
    id, workspaceId: WORKSPACE_ID, subscriptionId: "sub-1", eventId: `evt-${id}`, topic: "order.created", status: "delivered", attempts: 1,
    nextAttemptAt: createdAt, lastResponseStatus: 200, lastError: null, signedWithVersion: 3, createdAt, deliveredAt: createdAt, deadAt: null,
    signature: SECRET_MARKERS[3],
  } as WebhookDeliveryRecord;
}

interface Fixture {
  deps: WebhooksPackageToolDeps;
  repo: InMemoryWebhookSubscriptionRepo;
  deliveries: InMemoryWebhookDeliveryRepo;
  saves: { count: number };
  allow: { value: boolean };
  confirm: { runs: number; prepared: unknown[] };
  registrations: () => ToolRegistration[];
}

async function makeFixture(outcome: Outcome = "confirm"): Promise<Fixture> {
  let counter = 0;
  const repo = new InMemoryWebhookSubscriptionRepo();
  const deliveries = new InMemoryWebhookDeliveryRepo();
  const saves = { count: 0 };
  const originalSave = repo.save.bind(repo);
  repo.save = async (...args: Parameters<typeof repo.save>) => { saves.count += 1; return originalSave(...args); };
  const allow = { value: true };
  const confirm = { runs: 0, prepared: [] as unknown[] };
  const deps: WebhooksPackageToolDeps = {
    workspaceId: WORKSPACE_ID,
    clock: { nowMs: () => Date.parse(NOW) },
    idGen: { newId: () => `id-${++counter}` },
    webhookSubscriptionRepo: repo,
    webhookDeliveryRepo: deliveries,
    originRegistry: { isAllowedEgressTarget: async ({ url }: { url: string }) => !url.includes("blocked") } as unknown as WebhooksPackageToolDeps["originRegistry"],
    authorize: async () => (allow.value ? { allowed: true, reason: "matched" } : { allowed: false, reason: "insufficient_permission" }),
    confirmDelete: fakeConfirmDelete(outcome, confirm),
    notConfirmedResult,
  };
  await repo.insert(seededRecord("sub-1"));
  const surfaces = { surfaceExchanges: {} as never };
  return { deps, repo, deliveries, saves, allow, confirm, registrations: () => buildWebhooksToolRegistrations({ deps, surfaces }, { hostReads: HOST_READS }) };
}

function ctx(input: unknown, signal: AbortSignal = new AbortController().signal): ToolExecutionContext {
  return { executionId: "exec-1", principal: { id: PRINCIPAL_ID }, run: { id: "run-1" }, input, signal };
}

function caller(fixture: Fixture) {
  const registrations = fixture.registrations();
  return (id: string, input: unknown, signal?: AbortSignal): Promise<unknown> => {
    const found = registrations.find((registration) => registration.descriptor.id === id);
    assert.ok(found, `expected '${id}' to be wired`);
    return Promise.resolve(found.handler(ctx(input, signal)));
  };
}

const HOST_READS = { readRef: ({ entity }: { entity: string }) => `host_read.${entity}` };

test("the published text names the host's read, or a neutral one, never a placeholder or a tool id of its own", async () => {
  const { deps } = await makeFixture();
  const surfaces = { surfaceExchanges: {} as never };
  const text = (hostReads?: { readRef: (required: { entity: string }) => string }) =>
    JSON.stringify(buildWebhooksToolRegistrations({ deps, surfaces }, { hostReads }).map((registration) => registration.descriptor));
  assert.ok(text({ readRef: ({ entity }) => `host_read.${entity}` }).includes("host_read.webhook_subscription"));
  assert.ok(text().includes("the webhook subscription read tool"));
  for (const published of [text(), text({ readRef: ({ entity }) => `host_read.${entity}` })]) {
    assert.ok(!published.includes("{{read:"));
    assert.ok(!published.includes("content_read"));
  }
});

test("the registrations are the six catalog tools, in order, with the authored risk map", async () => {
  const fixture = await makeFixture();
  assert.deepEqual(fixture.registrations().map((registration) => registration.descriptor.id), [...TOOL_IDS]);
  assert.deepEqual([...webhooksDerivedRisk.entries()], [
    ["webhooks_list_subscriptions", "none"],
    ["webhooks_get_deliveries", "none"],
    ["webhooks_create_subscription", "mutates-durable-state"],
    ["webhooks_update_subscription", "mutates-durable-state"],
    ["webhooks_pause_subscription", "mutates-durable-state"],
    ["webhooks_delete_subscription", "deletes-durable-state"],
  ]);
  assert.deepEqual(getWebhooksAgentToolCatalog().map((entry) => entry.name).sort(), [...TOOL_IDS].sort());
  for (const registration of fixture.registrations()) {
    assert.equal(Object.hasOwn(registration.descriptor, "metadata"), false, "host metadata is bound by the host, not here");
  }
});

const REFUSAL_INPUTS: Record<(typeof TOOL_IDS)[number], unknown> = {
  webhooks_list_subscriptions: {},
  webhooks_get_deliveries: { subscriptionId: "sub-1" },
  webhooks_create_subscription: { label: "L", targetUrl: "https://example.test/h", topics: ["a"] },
  webhooks_update_subscription: { subscriptionId: "sub-1", expectedVersion: 1, label: "L", targetUrl: "https://example.test/h", topics: ["a"] },
  webhooks_pause_subscription: { subscriptionId: "sub-1" },
  webhooks_delete_subscription: { subscriptionId: "sub-1" },
};

for (const toolId of TOOL_IDS) {
  test(`${toolId}: a principal without the permission is refused, nothing is written and no confirmation is raised`, async () => {
    const fixture = await makeFixture();
    const call = caller(fixture);
    fixture.allow.value = false;
    await assert.rejects(call(toolId, REFUSAL_INPUTS[toolId]), (error: unknown) => {
      assert.ok(error instanceof ToolInputError, `got ${(error as Error)?.constructor?.name}`);
      assert.equal(error.message, `WEBHOOKS_FORBIDDEN: principal '${PRINCIPAL_ID}' is not authorized for 'admin.integrations.manage' (insufficient_permission)`);
      return true;
    });
    assert.equal(fixture.saves.count, 0);
    assert.equal(fixture.confirm.runs, 0);
  });
}

test("one success call per non-delete tool returns the model-facing view", async () => {
  const fixture = await makeFixture();
  const call = caller(fixture);
  // The delivery port lists newest first; this fake keeps insertion order, so insert the newest first.
  await fixture.deliveries.enqueue({ record: seededDelivery("d-new", "2026-11-02T00:00:00.000Z") });
  await fixture.deliveries.enqueue({ record: seededDelivery("d-old", "2026-11-01T00:00:00.000Z") });
  const deliveryView = (id: string, createdAt: string) => ({
    id, subscriptionId: "sub-1", eventId: `evt-${id}`, topic: "order.created", status: "delivered", attempts: 1, nextAttemptAt: createdAt,
    lastResponseStatus: 200, lastError: null, signedWithVersion: 3, createdAt, deliveredAt: createdAt, deadAt: null,
  });
  const view = (over: Record<string, unknown>) => ({
    id: "sub-1", label: "Hook sub-1", targetUrl: "https://example.test/hooks/orders", topics: ["order.created"], status: "active", secretVersion: 3,
    previousSecretVersion: 2, createdAt: NOW, updatedAt: NOW, disabledAt: null, version: 1, lastDelivery: null, ...over,
  });
  const newest = deliveryView("d-new", "2026-11-02T00:00:00.000Z");

  assert.deepEqual(await call("webhooks_list_subscriptions", {}), { subscriptions: [view({ lastDelivery: newest })] });
  assert.deepEqual(await call("webhooks_get_deliveries", { subscriptionId: "sub-1" }), { deliveries: [newest, deliveryView("d-old", "2026-11-01T00:00:00.000Z")] });
  const created = (await call("webhooks_create_subscription", { label: "  New hook  ", targetUrl: "https://example.test/new", topics: ["a", "a", " b "] })) as { subscription: { id: string } };
  assert.deepEqual(created, { subscription: view({ id: created.subscription.id, label: "New hook", targetUrl: "https://example.test/new", topics: ["a", "b"], secretVersion: 1, previousSecretVersion: null }) });
  assert.deepEqual(
    await call("webhooks_update_subscription", { subscriptionId: "sub-1", expectedVersion: 1, label: "Renamed", targetUrl: "https://example.test/renamed", topics: ["c"] }),
    { subscription: view({ label: "Renamed", targetUrl: "https://example.test/renamed", topics: ["c"], version: 2, lastDelivery: newest }) },
  );
  assert.deepEqual(await call("webhooks_pause_subscription", { subscriptionId: "sub-1" }), {
    subscription: view({ label: "Renamed", targetUrl: "https://example.test/renamed", topics: ["c"], status: "paused", version: 3 }),
  });
});

test("get_deliveries: the limit is defaulted, floored and capped, and an unknown subscription is a typed not-found", async () => {
  const fixture = await makeFixture();
  const limits: number[] = [];
  fixture.deliveries.listBySubscription = async (required) => { limits.push(required.limit); return []; };
  const call = caller(fixture);
  for (const limit of [undefined, 0, -5, 7.9, 999]) await call("webhooks_get_deliveries", { subscriptionId: "sub-1", ...(limit === undefined ? {} : { limit }) });
  assert.deepEqual(limits, [50, 50, 50, 7, 200]);
  await assert.rejects(call("webhooks_get_deliveries", { subscriptionId: "nope" }), /WEBHOOKS_SUBSCRIPTION_NOT_FOUND: webhook subscription 'nope' was not found/);
});

test("create and update refuse an empty topic list, a non-array topics value and a disallowed egress target with real reasons", async () => {
  const fixture = await makeFixture();
  const call = caller(fixture);
  await assert.rejects(call("webhooks_create_subscription", { label: "L", targetUrl: "https://example.test/h", topics: "a" }), /WEBHOOKS_VALIDATION_FAILED: at least one topic is required/);
  await assert.rejects(call("webhooks_create_subscription", { label: "L", targetUrl: "https://blocked.example/h", topics: ["a"] }), /WEBHOOKS_VALIDATION_FAILED: .*not an allowed egress target/);
  for (const topics of [undefined, "a", ["a", 3]]) {
    await assert.rejects(
      call("webhooks_update_subscription", { subscriptionId: "sub-1", expectedVersion: 1, label: "L", targetUrl: "https://example.test/h", topics }),
      /WEBHOOKS_VALIDATION_FAILED: topics must be an array of strings/,
    );
  }
  assert.equal(fixture.saves.count, 0);
});

test("no tool result exposes signing material; the numeric secret versions stay public", async () => {
  const fixture = await makeFixture("declined");
  const call = caller(fixture);
  await fixture.deliveries.enqueue({ record: seededDelivery("d-1", "2026-11-01T00:00:00.000Z") });
  const results: unknown[] = [
    await call("webhooks_list_subscriptions", {}),
    await call("webhooks_get_deliveries", { subscriptionId: "sub-1" }),
    await call("webhooks_create_subscription", { label: "N", targetUrl: "https://example.test/n", topics: ["a"] }),
    await call("webhooks_update_subscription", { subscriptionId: "sub-1", expectedVersion: 1, label: "R", targetUrl: "https://example.test/r", topics: ["c"] }),
    await call("webhooks_pause_subscription", { subscriptionId: "sub-1" }),
    await call("webhooks_delete_subscription", { subscriptionId: "sub-1" }),
  ];
  for (const result of results) {
    const text = JSON.stringify(result);
    for (const marker of SECRET_MARKERS) assert.equal(text.includes(marker), false, `a result leaked ${marker}`);
  }
  const listed = (await call("webhooks_list_subscriptions", {})) as { subscriptions: Array<{ id: string; secretVersion: number; previousSecretVersion: number | null }> };
  const seeded = listed.subscriptions.find((item) => item.id === "sub-1");
  assert.deepEqual([seeded?.secretVersion, seeded?.previousSecretVersion], [3, 2]);
});

test("update with a stale expectedVersion reaches the model as the conflict envelope; a missing version is refused first", async () => {
  const fixture = await makeFixture();
  const call = caller(fixture);
  const input = { subscriptionId: "sub-1", label: "First", targetUrl: "https://example.test/r", topics: ["c"] };
  await call("webhooks_update_subscription", { ...input, expectedVersion: 1 });
  await assert.rejects(call("webhooks_update_subscription", { ...input, label: "Second", expectedVersion: 1 }), (error: unknown) => {
    assert.ok(error instanceof ToolInputError, `got ${(error as Error)?.constructor?.name}`);
    assert.match(error.message, /NOT applied/);
    assert.match(error.message, /host_read\.webhook_subscription/);
    return true;
  });
  assert.equal((await fixture.repo.findById({ workspaceId: WORKSPACE_ID, id: "sub-1" }))?.label, "First");
  await assert.rejects(call("webhooks_update_subscription", input), /host_read\.webhook_subscription/);
});

test("delete confirmed: the prepared snapshot is frozen, the subscription is soft-deleted once and reported", async () => {
  const fixture = await makeFixture("confirm");
  const result = await caller(fixture)("webhooks_delete_subscription", { subscriptionId: "sub-1" });
  assert.deepEqual(result, {
    deleted: true, cancelled: false,
    subscription: {
      id: "sub-1", label: "Hook sub-1", targetUrl: "https://example.test/hooks/orders", topics: ["order.created"], status: "disabled", secretVersion: 3,
      previousSecretVersion: 2, createdAt: NOW, updatedAt: NOW, disabledAt: NOW, version: 2, lastDelivery: null,
    },
  });
  assert.equal(fixture.confirm.runs, 1);
  assert.equal(fixture.saves.count, 1);
  assert.equal((fixture.confirm.prepared[0] as { subscriptionId: string }).subscriptionId, "sub-1");
});

test("delete declined, expired or abandoned: the model is told so and the repo is never written", async () => {
  const wording = {
    declined: { deleted: false, cancelled: true },
    expired: { deleted: false, cancelled: false, reason: "expired", note: "The user did not respond to the confirmation dialog before it expired. Nothing was deleted." },
    abandoned: { deleted: false, cancelled: false, reason: "abandoned", note: "The confirmation dialog was closed because the run ended. Nothing was deleted." },
  } as const;
  for (const outcome of ["declined", "expired", "abandoned"] as const) {
    const fixture = await makeFixture(outcome);
    const result = (await caller(fixture)("webhooks_delete_subscription", { subscriptionId: "sub-1" })) as Record<string, unknown>;
    assert.deepEqual(outcome === "declined" ? { deleted: result.deleted, cancelled: result.cancelled } : result, wording[outcome]);
    if (outcome === "declined") assert.equal((result.subscription as { status: string }).status, "active");
    assert.equal(fixture.saves.count, 0, outcome);
    assert.equal(fixture.confirm.runs, 0, outcome);
  }
});

test("delete: an unknown id is refused before any confirmation, and a target that changed while the card was open is refused after it", async () => {
  const unknown = await makeFixture("confirm");
  await assert.rejects(caller(unknown)("webhooks_delete_subscription", { subscriptionId: "nope" }), /WEBHOOKS_SUBSCRIPTION_NOT_FOUND/);
  assert.deepEqual(unknown.confirm.prepared, []);

  const fixture = await makeFixture("confirm");
  const original = fixture.deps.confirmDelete;
  fixture.deps.confirmDelete = (steps) => async (context, options) => {
    const prepared = await steps.prepare({ ctx: context }, options ?? {});
    await fixture.repo.save({ ...seededRecord("sub-1"), label: "Changed while open" });
    return steps.run({ ctx: context, prepared, confirmer: { id: PRINCIPAL_ID, kind: "user" } }, options ?? {});
  };
  await assert.rejects(caller(fixture)("webhooks_delete_subscription", { subscriptionId: "sub-1" }), {
    message: "webhooks_delete_subscription: target changed while confirmation was open. Request a new confirmation; nothing was deleted.",
  });
  fixture.deps.confirmDelete = original;
  assert.equal((await fixture.repo.findById({ workspaceId: WORKSPACE_ID, id: "sub-1" }))?.label, "Changed while open");
});

test("delete: a write conflict after the confirmed snapshot check asks for a new confirmation", async () => {
  const fixture = await makeFixture("confirm");
  const find = fixture.repo.findById.bind(fixture.repo);
  let reads = 0;
  fixture.repo.findById = async (required) => {
    if (++reads === 3) await fixture.repo.save({ ...seededRecord("sub-1"), label: "Edited", version: 2 }, { expectedVersion: 1 });
    return find(required);
  };
  await assert.rejects(caller(fixture)("webhooks_delete_subscription", { subscriptionId: "sub-1" }), (error: unknown) => {
    assert.ok(error instanceof ToolInputError);
    assert.equal(error.message, "webhooks_delete_subscription: target changed while confirmation was open. Request a new confirmation; nothing was deleted.");
    return true;
  });
  const current = await find({ workspaceId: WORKSPACE_ID, id: "sub-1" });
  assert.equal(current?.label, "Edited");
  assert.equal(current?.status, "active");
  assert.equal(current?.version, 2);
});

test("delete: a run aborted while the confirmed delete re-checks permission is abandoned and nothing is deleted", async () => {
  const fixture = await makeFixture("confirm");
  const controller = new AbortController();
  let authorizations = 0;
  // The second authorization is the re-check after the human confirmed: abort during it.
  fixture.deps.authorize = async () => { if (++authorizations === 2) controller.abort(); return { allowed: true, reason: "matched" }; };
  const result = await caller(fixture)("webhooks_delete_subscription", { subscriptionId: "sub-1" }, controller.signal);
  assert.deepEqual(result, { deleted: false, cancelled: false, reason: "abandoned", note: "not confirmed: abandoned" });
  assert.equal(fixture.saves.count, 0);
});

test("toWebhookDeliveryView drops the workspace id and keeps the delivery facts", () => {
  const view = toWebhookDeliveryView({ delivery: seededDelivery("d-1", NOW) });
  assert.equal(Object.hasOwn(view, "workspaceId"), false);
  assert.equal(Object.hasOwn(view, "signature"), false);
  assert.deepEqual([view.id, view.subscriptionId, view.signedWithVersion], ["d-1", "sub-1", 3]);
});
