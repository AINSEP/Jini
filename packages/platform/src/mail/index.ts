export type * from "./types.js";
export type * from "./ports.js";
export type * from "./adapter-module.js";
export { wrapMailerWithPurposeGate } from "./purpose-scoped-mailer.js";
export type { WrapMailerWithPurposeGateOptions } from "./purpose-scoped-mailer.js";
export { isMailDeliveryAvailable } from "./delivery-availability.js";
export { createMailSenderIdentityResolver, NON_DELIVERING_MAIL_DRIVERS, SenderIdentityNotConfiguredError } from "./sender-identity.js";
export type { ConfiguredMailSender, CreateMailSenderIdentityResolverOptional, MailSenderIdentityPort } from "./sender-identity.js";
