/**
 * @file Wires delivery onto the event bus: the received-submission event only plans (fast, one
 * transaction), and each child job event delivers independently, so one slow or failing
 * destination never delays or blocks another.
 */
import type { EventBusPort } from "../../core/index.js";
import { deliverFormJob } from "./deliver-job.js";
import { FORM_DELIVERY_EVENT, type FormDeliveryJob, type FormDeliveryResult } from "./types.js";

// Same literal as the notify subscriber: domain code owns its event names (see types.ts in forms).
const FORM_SUBMISSION_RECEIVED_EVENT = "form.submission.received";

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
    await required.bus.subscribe<FormSubmissionReceivedPayload>({ eventName: FORM_SUBMISSION_RECEIVED_EVENT, handler: async event => {
      await required.plan({ workspaceId: event.workspaceId, submissionId: event.payload.submissionId, formId: event.payload.formDefinitionId });
    } });
    await required.bus.subscribe<FormDeliveryJob>({ eventName: FORM_DELIVERY_EVENT, handler: event =>
      deliverFormJob({ job: event.payload, deliver: job => required.deliver({ workspaceId: event.workspaceId, job }) }) });
  };
  return { start: () => (started ??= install()) };
}
