import type { MailAdapterCredential } from "./adapter-module.js";
import type { MailDomainState, MailProviderCapabilities, MailProviderRegistry, MailProviderSetting, MailStatus } from "./provider.js";

// Host-facing engine contracts live in this leaf module: they reference the registry and status
// projection, and keeping them out of types.ts/ports.ts avoids type-edge cycles with provider.ts.

/** Metadata only: the host reads these facts before decrypting a credential. */
export interface MailCredentialFact {
  readonly id: string;
  readonly label: string;
  readonly vaultRevision?: number;
  readonly updatedAt: string;
}

/** Credential presence exposed in configuration reports; never a token or username. */
export interface MailProviderCredentialFacts {
  readonly required: boolean;
  readonly saved: boolean;
  readonly label?: string;
  readonly credentialId?: string;
  readonly updatedAt?: string;
}

/** Declarative setup copy belongs to the host or plugin. */
export interface MailProviderField {
  readonly key: string;
  readonly label: string;
  readonly type: "secret" | "text" | "url" | "email";
  readonly required: boolean;
  readonly defaultValue?: string;
  readonly placeholder?: string;
  readonly help?: string;
  readonly helpUrl?: string;
}

export interface MailProviderSetup {
  readonly fields: readonly MailProviderField[];
  readonly helpUrl?: string;
}

/** Safe host-supplied projection; configuration building and product copy stay in the host. */
export interface MailProviderConfiguration {
  readonly pluginId?: string;
  readonly id: string;
  readonly label: string;
  readonly origin: "core" | "plugin";
  readonly hosted: boolean;
  readonly lanes: readonly ("transactional" | "bulk")[];
  readonly capabilities: Pick<MailProviderCapabilities, "feedback" | "domainVerification" | "rateLimit">;
  readonly credential: MailProviderCredentialFacts;
  readonly selectable: boolean;
  readonly refusal?: string;
  readonly setup: MailProviderSetup;
}

export interface MailProviderConfigurationReport {
  readonly setting: MailProviderSetting;
  readonly providers: readonly MailProviderConfiguration[];
  readonly refusals: readonly string[];
}

/** A provider failure safe for callers; contains neither credentials nor message bodies. */
export interface MailProviderError {
  readonly at: string;
  readonly providerId: string | null;
  readonly source: "send" | "check";
  readonly code?: string;
  readonly message: string;
}

/** Alias the provider's existing verdict vocabulary instead of defining another taxonomy. */
export type ProviderDomainState = MailDomainState;

/** Provider verification is independent of DNS answers and credential presence. */
export type SenderDomainVerification =
  | { state: ProviderDomainState; domain: string; providerId: string }
  | { state: "no_sender"; providerId: string | null }
  | { state: "no_provider"; domain: string; providerId: string | null }
  | { state: "unsupported"; domain: string; providerId: string }
  | { state: "unknown"; domain?: string; providerId: string | null; reason: string };

export interface MailStatusReport extends MailStatus {
  readonly senderDomainVerification?: SenderDomainVerification;
  readonly providers: readonly MailProviderConfiguration[];
  readonly refusals: readonly string[];
  readonly checkedAt: string;
  readonly lastError?: MailProviderError;
}

export type MailProviderCheck = { ok: true; label: string } | { ok: false; reason: string };

/** Host-built catalog: trusted loading, labels and setup copy remain outside the engine. */
export interface MailProviderCatalog {
  readonly registry: MailProviderRegistry;
  readonly pluginIds: readonly string[];
  readonly refusals: readonly string[];
  credentialLabelFor(required: { id: string }): string | undefined;
  setupFor(required: { id: string }): MailProviderSetup;
}

/** Host settings adapter; reads do not infer provider selection from saved credentials. */
export interface MailProviderSettingPort {
  read(required: Record<string, never>): Promise<MailProviderSetting | null>;
  write(required: { setting: MailProviderSetting }): Promise<void>;
}

/** Host owns metadata lookup and decryption. Metadata may fail independently of key resolution. */
export interface MailCredentialPort {
  readFact(required: { label: string }): Promise<MailCredentialFact | undefined>;
  resolve(required: { catalog: MailProviderCatalog; id: string }): Promise<MailAdapterCredential | null>;
}

/** Read-only provider verdict; implementations return unknown on lookup/provider failures. */
export type SenderDomainVerificationPort = () => Promise<SenderDomainVerification>;
