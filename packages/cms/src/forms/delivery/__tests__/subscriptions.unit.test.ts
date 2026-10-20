/**
 * @file Pins `createFormDeliverySubscriptions().start()`: it installs once, a failed install is not
 * cached (a later start retries), and a failure never escapes as an unhandled rejection when a
 * host fires `start()` without awaiting it.
 */
import { afterEach, describe, expect, test } from "vitest";
import type { DomainEvent, EventBusPort } from "../../../core/index.js";
import { createFormDeliverySubscriptions, FORM_DELIVERY_EVENT, FORM_SUBMISSION_RECEIVED_EVENT } from "../../index.js";

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
