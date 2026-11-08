/**
 * @file Public surface of `@jini-ai/agent-plugins/lifecycle/mail`: Agent Plugin mail adapters (the
 * adapter file parser and loader, the provider catalog, the configuration record, the host mailer and
 * provider selection). Its runtime effects are supplied by the host. Not re-exported from `./lifecycle`, so
 * a host that sends no mail never loads it.
 *
 * The entry exists before its contents so the export resolves; each piece arrives with the batch
 * that moves it.
 */
export {
  asMailAdapterModule, defaultMailCredentialLabel, parseMailAdaptersFile,
  type MailAdapterDescriptor, type MailAdaptersParseResult, type MailCredentialCard,
} from "./adapter-descriptors.js";

export * from "./contribution.js";
export * from "./catalog.js";
export * from "./configuration.js";
export * from "./selection.js";
export * from "./host-mailer.js";
