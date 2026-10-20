/**
 * @file Wires delivery onto the event bus: the received-submission event only plans (fast, one
 * transaction), and each child job event delivers independently, so one slow or failing
 * destination never delays or blocks another.
 */
import type { EventBusPort } from "../../core/index.js";
import { deliverFormJob } from "./deliver-job.js";
import { FORM_SUBMISSION_RECEIVED_EVENT } from "../types.js";
import { FORM_DELIVERY_EVENT, type FormDeliveryJob, type FormDeliveryResult } from "./types.js";

interface FormSubmissionReceivedPayload { submissionId: string; formDefinitionId: string }

/**
 * Creates the subscriber pair. `start` is idempotent so a host that builds its app more than once
 * (exporters, tests) still installs one handler per event. Delivery results pass through
 * `deliverFormJob`, so even a host `deliver` that throws raw errors cannot leak text to the ledger.
 * @example const subscriptions = createFormDeliverySubscriptions({ bus, plan, deliver }); await subscriptions.start();
 */
export function createFormDeliverySubscriptions(
  required: {
    bus: EventBusPort;
    plan: (required: { workspaceId: string; submissionId: string; formId: string }) => Promise<unknown>;
    deliver: (required: { workspaceId: string; job: FormDeliveryJob }) => Promise<FormDeliveryResult | void>;
  },
  _optional: Record<string, never> = {},
): { start(required?: Record<string, never>, optional?: Record<string, never>): Promise<void> } {
  let started: Promise<void> | undefined;
  const install = async (): Promise<void> => {
    const installed: Array<() => Promise<void>> = [];
    try {
      installed.push(await required.bus.subscribe<FormSubmissionReceivedPayload>({ eventName: FORM_SUBMISSION_RECEIVED_EVENT, handler: async event => {
        await required.plan({ workspaceId: event.workspaceId, submissionId: event.payload.submissionId, formId: event.payload.formDefinitionId });
      } }));
      installed.push(await required.bus.subscribe<FormDeliveryJob>({ eventName: FORM_DELIVERY_EVENT, handler: event =>
        deliverFormJob({ job: event.payload, deliver: job => required.deliver({ workspaceId: event.workspaceId, job }) }) }));
    } catch (error) {
      // Undo a half install so the retry below cannot leave the planner subscribed twice.
      await Promise.allSettled(installed.map(unsubscribe => unsubscribe()));
      throw error;
    }
  };
  const start = (): Promise<void> => {
    if (started) return started;
    started = install();
    // A failed install is forgotten so a later start retries it. Attaching this handler also marks
    // the promise handled, so a host that fires `void start()` gets no unhandled rejection, while a
    // caller that awaits the returned promise still sees the error.
    started.catch(() => { started = undefined; });
    return started;
  };
  return { start };
}
