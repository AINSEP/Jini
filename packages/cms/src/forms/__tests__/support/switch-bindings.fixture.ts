/** Narrow host options for unchanged moved wrapper tests. Production host wiring stays in Tovu. */
import { createHash } from "node:crypto";
import type { Clock, Logger } from "@jini-ai/core/primitives";
import { createMemoryCounterStore, createRateLimiter as createLimiter } from "@jini-ai/http-kit/rate-limit";
import { createFormDefinition as create, updateFormDefinition as update } from "./host-ports.fixture.js";
import { setFormDefinitionStatus as setStatus } from "../../write-service.js";
import { submitForm as submit, type SubmitFormDeps, type SubmitFormInput } from "../../submit-service.js";
import { registerFormNotifySubscriber as notify, type RegisterFormNotifySubscriberDeps } from "../../notify-subscriber.js";
import { FormFieldValidationError } from "../../errors.js";
import { createSubmissionAttempts as attempts, submissionAttemptKey as attemptKey, type SubmissionAttempts } from "../../submission-attempts.js";
import { htmlSubmissionDefinition } from "../../html/index.js";
import { InMemoryOutbox as OutboxFixture } from "../eventing.fixture.js";
import type { EventBusPort } from "../../../core/index.js";
import type { OutboundEmail, MailerSendOptions, MailerSendResult } from "../../ports.js";

export { executeCommand } from "../../../core/index.js";
export { InMemoryChangeSetRepo } from "../change-set.fixture.js";
export { InMemoryEventBus } from "../eventing.fixture.js";
export { DUPLICATE_ATTEMPT, DUPLICATE_SUBMISSION_WINDOW_MS, FORM_ATTEMPT_FIELD } from "../../submission-attempts.js";
export type { OutboundEmail, MailerSendOptions, MailerSendResult };
export interface MailerPort { send(message: OutboundEmail, options: MailerSendOptions): Promise<MailerSendResult>; }
export const FORMS_SUBMIT_PROFILE = { windowSeconds: 60, max: 5, burst: 0 };
export function createRateLimiter(required: { profile: typeof FORMS_SUBMIT_PROFILE; clock: Clock }) {
  return createLimiter({ ...required, store: createMemoryCounterStore({}, {}) }, {});
}
export class InMemoryOutbox extends OutboxFixture {
  async markDelivered(_required: { id: string }): Promise<void> {}
}

export async function createFormDefinition(required: Parameters<typeof create>[0]) {
  try { return await create(required); }
  catch (error) {
    if (error instanceof FormFieldValidationError && required.input.slug === "new") {
      throw new FormFieldValidationError({ message: error.message, fieldErrors: error.fieldErrors.map(detail =>
        detail.field === "slug" && detail.reason === "'new' is reserved by the host"
          ? { ...detail, reason: "'new' is reserved for the admin editor's own URL" } : detail) });
    }
    throw error;
  }
}
export const updateFormDefinition = update;
export function setFormDefinitionStatus({ deps, input }: {
  deps: Parameters<typeof create>[0]["deps"];
  input: Parameters<typeof setStatus>[0]["input"] & { idempotencyKey?: string };
}) {
  const { idempotencyKey, ...values } = input;
  return setStatus({ deps: { ...deps, permission: "admin.forms.manage", reservedSlugs: new Set(["new"]) }, input: values }, {
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }), ...(deps.outbox === undefined ? {} : { outbox: deps.outbox }),
  });
}

const hash = (input: string) => createHash("sha256").update(input).digest("hex");
export function createSubmissionAttempts(required: Record<string, never> = {}, optional: Parameters<typeof attempts>[1] = {}) {
  return attempts({ ...required, hash }, optional);
}
export function submissionAttemptKey(required: Omit<Parameters<typeof attemptKey>[0], "hash">) {
  return attemptKey({ ...required, hash }, {});
}
const attemptsByStore = new WeakMap<SubmitFormDeps["submissionRepo"], SubmissionAttempts>();
export function submitForm({ deps, input }: {
  deps: Omit<SubmitFormDeps, "dispatcher" | "logger" | "outbox"> & { bus: EventBusPort; outbox: InMemoryOutbox };
  input: SubmitFormInput;
}, optional: { logger?: Pick<Logger, "warn">; attempts?: SubmissionAttempts } = {}) {
  let storeAttempts = optional.attempts ?? attemptsByStore.get(deps.submissionRepo);
  if (!storeAttempts) { storeAttempts = createSubmissionAttempts(); attemptsByStore.set(deps.submissionRepo, storeAttempts); }
  // The injected dispatcher deliberately has no worker policy: these assertions own service timing,
  // payload forwarding and notification boundaries, not outbox retry/lease behavior.
  const dispatch = async () => {
    for (const event of deps.outbox.events.splice(0)) {
      await deps.bus.publish(event);
      await deps.outbox.markDelivered({ id: event.id });
    }
  };
  return submit({ deps: { ...deps, transaction: work => deps.submissionRepo.transaction!(work), dispatcher: { dispatch },
    logger: optional.logger ?? { warn: ({ message }, { error } = {}) => console.warn(message, error) },
  }, input }, { attempts: storeAttempts, definitionView: htmlSubmissionDefinition, validateEmails: true, dispatch });
}
export function registerFormNotifySubscriber(required: Omit<RegisterFormNotifySubscriberDeps, "sender" | "logger" | "mailer"> & { mailer: MailerPort },
  optional: { logger?: Pick<Logger, "warn"> } = {}) {
  return notify({ ...required, sender: { email: "no-reply@forms.local", name: "Forms" },
    logger: optional.logger ?? { warn: ({ message }, { error } = {}) => console.warn(message, ...(error === undefined ? [] : [error])) },
    mailer: { send: ({ message, options }) => required.mailer.send(message, options) },
  }, {});
}
