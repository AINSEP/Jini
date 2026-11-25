import assert from "node:assert/strict";
import type { DomainEvent } from "@jini-ai/core/contracts/events";
import test from "../support/test-runner.js";
import { widgetHostFixture, InMemoryEntryRefsRepo, InMemoryOutbox } from "../support/host.fixture.js";
import { InMemoryContentTypeRepo } from "../../../content-types/index.js";
import { InMemoryEntryRepo } from "../../../entries/index.js";
import { ConflictingMutationActorError } from "../../../core/mutation-actor.js";
import { createWidgetInstance, type WidgetWriteServiceDeps } from "../../write-service.js";
import { InMemoryWidgetRegionBindingRepo } from "../../repo.memory.js";
import { WIDGETS_SYSTEM_ACTOR_ID } from "../../authorize-helper.js";
import { bindWidgetArea, type RegionAreaServiceDeps } from "../support/compat/region-area-service.js";
import { widgetsCreateInstanceHandler } from "../../tool-handlers.instances.js";

/**
 * @file P10-H2.J — widget writes stamp the trusted actor their caller vouches for on the entry
 * event. The execution channel supplies attribution, the principal ID still governs authorization,
 * and the two are not interchangeable: a system write says `system` because its writer acts for
 * nobody, an assistant write says `agent` because the tool channel says so, and a write whose
 * caller vouched for no kind records no actor rather than one guessed from the id.
 */

const WORKSPACE_ID = "ws-1";

function makeDeps(): { deps: RegionAreaServiceDeps & WidgetWriteServiceDeps; events: DomainEvent[] } {
  let counter = 0;
  const events: DomainEvent[] = [];
  const outbox = new InMemoryOutbox();
  const enqueue = outbox.enqueue.bind(outbox);
  outbox.enqueue = async (event) => { events.push(event); await enqueue(event); };
  const deps = {
    host: widgetHostFixture,
    entryRepo: new InMemoryEntryRepo(),
    contentTypeRepo: new InMemoryContentTypeRepo(),
    entryRefsRepo: new InMemoryEntryRefsRepo(),
    bindingRepo: new InMemoryWidgetRegionBindingRepo(),
    clock: { nowMs: () => Date.parse("2026-11-25T00:00:00.000Z") },
    ids: { newId: () => `id-${++counter}` },
    authorize: async () => ({ allowed: true, reason: "test: always allow" }),
    outbox,
  };
  return { deps, events };
}

function entryEvents(events: DomainEvent[]): DomainEvent[] {
  return events.filter((event) => event.name.startsWith("entry."));
}

test("a widget system write records kind system", async () => {
  const { deps, events } = makeDeps();
  await bindWidgetArea({ deps, input: { workspaceId: WORKSPACE_ID, regionKey: "footer" } });

  const [created] = entryEvents(events);
  assert.equal(created?.name, "entry.created");
  assert.deepEqual(created?.actor, { id: WIDGETS_SYSTEM_ACTOR_ID, kind: "system" });
  assert.equal(created?.actorId, WIDGETS_SYSTEM_ACTOR_ID);
});

test("an assistant widget create records kind agent for the same principal it authorizes", async () => {
  const { deps, events } = makeDeps();
  await createWidgetInstance({
    deps,
    input: { workspaceId: WORKSPACE_ID, actor: { principalId: "owner-1", kind: "agent" }, widgetType: "text", title: "Hello", config: { body: "hi" } },
  });

  const [created] = entryEvents(events);
  assert.deepEqual(created?.actor, { id: "owner-1", kind: "agent" });
});

test("a widget write whose caller vouched for no kind is refused at the entry seam, never recorded unattributed (FIX 19 / H2)", async () => {
  const { deps, events } = makeDeps();
  await assert.rejects(
    createWidgetInstance({
      deps,
      // @ts-expect-error — `kind` is required: a widget write must name the trusted origin it writes for.
      input: { workspaceId: WORKSPACE_ID, actor: { principalId: "owner-1" }, widgetType: "text", title: "Hello", config: { body: "hi" } },
    }),
    { name: "MissingMutationActorError" },
  );
  assert.equal(entryEvents(events).length, 0);
});

test("an entry write handed an actor naming another principal is refused before anything is stored", async () => {
  const { deps, events } = makeDeps();
  await assert.rejects(
    widgetHostFixture.entries.createEntry({
      deps: { ...deps, outbox: widgetHostFixture.entries.toEntryOutbox({ outbox: deps.outbox, clock: deps.clock, idGen: deps.ids, workspaceId: WORKSPACE_ID }) },
      input: { workspaceId: WORKSPACE_ID, actorId: "owner-1", actor: { id: "someone-else", kind: "user" }, type: "widget", slug: "x", title: "x", fieldsJson: {} },
    } as never),
    ConflictingMutationActorError,
  );
  assert.deepEqual(events, []);
});

test("the assistant's widget create tool vouches kind agent for the principal it acts for", async () => {
  const { deps, events } = makeDeps();
  // The tool channel is the assistant: an assistant acting for an owner does not turn the action into an owner click.
  const handler = widgetsCreateInstanceHandler({
    deps: { workspaceId: WORKSPACE_ID, composeWriteDeps: () => deps } as never,
    withSchema: (async ({ fn }: { fn: () => Promise<unknown> }) => fn()) as never,
  });
  await handler({ executionId: "e1", principal: { id: "owner-1" }, run: { id: "r1" }, signal: new AbortController().signal,
    input: { widgetType: "text", title: "Hello", config: { body: "hi" } } });

  const [created] = entryEvents(events);
  assert.deepEqual(created?.actor, { id: "owner-1", kind: "agent" });
});
