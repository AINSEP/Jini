/**
 * @file Pins `createFormDeliverySubscriptions().start()`: it installs once, a failed install is not
 * cached (a later start retries), and a failure never escapes as an unhandled rejection when a
 * host fires `start()` without awaiting it.
 */
import { afterEach, describe, expect, test } from "vitest";
import type { DomainEvent, EventBusPort } from "../../../core/index.js";
import { createFormDeliverySubscriptions, FORM_DELIVERY_EVENT, FORM_SUBMISSION_RECEIVED_EVENT, FormDeliveryError, type FormDeliveryJob,
  type FormDeliveryResult } from "../../index.js";

/** Typed bus fake: the subscribe calls numbered in `failCalls` (1-based) reject; `subscribed` lists live handlers. */
class FlakyBus implements EventBusPort {
  readonly subscribed: string[] = [];
  private calls = 0;
  constructor(private readonly failCalls: number[]) {}
  async publish<TPayload>(_event: DomainEvent<TPayload>): Promise<void> {}
  async publishBatch<TPayload>(_required: { events: Array<DomainEvent<TPayload>> }): Promise<void> {}
  async subscribeAll(_required: { handler: (event: DomainEvent) => Promise<void> }): Promise<() => Promise<void>> {
    throw new Error("delivery subscriptions never subscribe to every event");
  }
  async subscribe<TPayload>(required: { eventName: string; handler: (event: DomainEvent<TPayload>) => Promise<void> }): Promise<() => Promise<void>> {
    if (this.failCalls.includes(++this.calls)) throw new Error("bus not ready");
    this.subscribed.push(required.eventName);
    return async () => { this.subscribed.splice(this.subscribed.indexOf(required.eventName), 1); };
  }
}
const subscriptionsOn = (bus: EventBusPort) =>
  createFormDeliverySubscriptions({ bus, plan: async () => undefined, deliver: async () => undefined });

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
afterEach(() => { process.off("unhandledRejection", onUnhandled); unhandled.length = 0; });

describe("event names", () => {
  test("the planner listens on the forms-owned received-submission event name", async () => {
    expect(FORM_SUBMISSION_RECEIVED_EVENT).toBe("form.submission.received");
    const bus = new FlakyBus([]);
    await subscriptionsOn(bus).start();
    expect(bus.subscribed).toEqual([FORM_SUBMISSION_RECEIVED_EVENT, FORM_DELIVERY_EVENT]);
  });
});

describe("start", () => {
  test("installs both handlers once however often it is called", async () => {
    const bus = new FlakyBus([]);
    const subscriptions = subscriptionsOn(bus);
    await Promise.all([subscriptions.start(), subscriptions.start()]);
    await subscriptions.start();
    expect(bus.subscribed).toEqual(["form.submission.received", "form.submission.delivery"]);
  });

  test("a failed install is not cached: the next start retries and succeeds", async () => {
    const bus = new FlakyBus([1]);
    const subscriptions = subscriptionsOn(bus);
    await expect(subscriptions.start()).rejects.toThrow("bus not ready");
    await subscriptions.start();
    expect(bus.subscribed).toEqual(["form.submission.received", "form.submission.delivery"]);
  });

  test("a half install is undone before the retry, so the planner is never subscribed twice", async () => {
    const bus = new FlakyBus([2]);
    const subscriptions = subscriptionsOn(bus);
    await expect(subscriptions.start()).rejects.toThrow("bus not ready");
    expect(bus.subscribed).toEqual([]);
    await subscriptions.start();
    expect(bus.subscribed).toEqual(["form.submission.received", "form.submission.delivery"]);
  });

  test("a failed install started without await raises no unhandled rejection", async () => {
    process.on("unhandledRejection", onUnhandled);
    void subscriptionsOn(new FlakyBus([1])).start();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(unhandled).toEqual([]);
  });
});

/** Typed bus fake that keeps each subscribed handler so a test can deliver an event to it. */
class HandlerBus implements EventBusPort {
  readonly handlers = new Map<string, (event: DomainEvent<unknown>) => Promise<void>>();
  async publish<TPayload>(_event: DomainEvent<TPayload>): Promise<void> {}
  async publishBatch<TPayload>(_required: { events: Array<DomainEvent<TPayload>> }): Promise<void> {}
  async subscribeAll(_required: { handler: (event: DomainEvent) => Promise<void> }): Promise<() => Promise<void>> {
    throw new Error("delivery subscriptions never subscribe to every event");
  }
  async subscribe<TPayload>(required: { eventName: string; handler: (event: DomainEvent<TPayload>) => Promise<void> }): Promise<() => Promise<void>> {
    this.handlers.set(required.eventName, required.handler as (event: DomainEvent<unknown>) => Promise<void>);
    return async () => { this.handlers.delete(required.eventName); };
  }
  emit(name: string, payload: unknown): Promise<void> {
    return this.handlers.get(name)!({ id: "evt-1", name, occurredAt: "2026-10-20T00:00:00.000Z", workspaceId: "w-1", aggregateId: "s-1", payload });
  }
}

const job: FormDeliveryJob = {
  binding: { bindingId: "b-1", adapterId: "rows", connectionRef: "conn-1", enabled: true, config: {} },
  snapshot: { form: { slug: "contact", fields: [] }, submission: { id: "s-1", answers: {}, submittedAt: "2026-10-20T00:00:00.000Z" } },
  idempotencyKey: '["s-1","b-1"]',
};

describe("handlers", () => {
  test("a received submission is planned with its workspace, submission and form ids", async () => {
    const bus = new HandlerBus();
    const plans: Array<{ workspaceId: string; submissionId: string; formId: string }> = [];
    await createFormDeliverySubscriptions({ bus, plan: async input => { plans.push(input); }, deliver: async () => undefined }).start();
    await bus.emit(FORM_SUBMISSION_RECEIVED_EVENT, { workspaceId: "w-1", submissionId: "s-1", formDefinitionId: "f-1" });
    expect(plans).toEqual([{ workspaceId: "w-1", submissionId: "s-1", formId: "f-1" }]);
  });

  test("a planner failure rejects the handler so the source event retries", async () => {
    const bus = new HandlerBus();
    await createFormDeliverySubscriptions({ bus, plan: async () => { throw new Error("plan store locked"); }, deliver: async () => undefined }).start();
    await expect(bus.emit(FORM_SUBMISSION_RECEIVED_EVENT, { submissionId: "s-1", formDefinitionId: "f-1" })).rejects.toThrow("plan store locked");
  });

  test("a child job is delivered with the event's workspace and its frozen payload", async () => {
    const bus = new HandlerBus();
    const delivered: Array<{ workspaceId: string; job: FormDeliveryJob }> = [];
    await createFormDeliverySubscriptions({ bus, plan: async () => undefined, deliver: async input => { delivered.push(input); } }).start();
    await bus.emit(FORM_DELIVERY_EVENT, job);
    expect(delivered).toEqual([{ workspaceId: "w-1", job }]);
  });

  test("a failed delivery rejects the job handler with only the safe code", async () => {
    const bus = new HandlerBus();
    const deliver = async (): Promise<FormDeliveryResult> => ({ ok: false, error: { code: "destination-limit", retryable: false } });
    await createFormDeliverySubscriptions({ bus, plan: async () => undefined, deliver }).start();
    const error = await bus.emit(FORM_DELIVERY_EVENT, job).then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(FormDeliveryError);
    expect([(error as FormDeliveryError).message, (error as FormDeliveryError).retryable]).toEqual(["destination-limit", false]);
  });

  test("a host deliver that throws raw text is reduced to delivery-failed", async () => {
    const bus = new HandlerBus();
    const deliver = async (): Promise<void> => { throw new Error("credential vault said: " + "sk" + "-" + "y".repeat(40)); };
    await createFormDeliverySubscriptions({ bus, plan: async () => undefined, deliver }).start();
    await expect(bus.emit(FORM_DELIVERY_EVENT, job)).rejects.toThrow(/^delivery-failed$/);
  });
});
