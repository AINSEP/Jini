import type { DomainRequirement, ProviderContext, ProviderRegistry, ProviderResult } from '../../provider-registry.js';
import type { HttpClientPort } from '../../primitives/index.js';
import type { MailAdapterCredential, MailAdapterModule } from './adapter-module.js';
import type { MailDeliveryLane } from './ports.js';
import type { MailerFeedbackEvent } from '../mail.js';
/** @agent-note Types only. The runtime parts come from the host; this area usually from `@jini-ai/platform`. */



/** Provider token bucket: sustained rate plus burst. Absent = no provider-declared limit. */
export interface MailRateLimit {
  readonly perSecond: number;
  readonly burst: number;
}


export interface MailProviderCapabilities {
  /** False for local drivers (console): they never count as real delivery. */
  readonly hosted: boolean;
  /** True exactly when the module ships a {@link MailFeedbackParser}. */
  readonly feedback: boolean;
  /** True exactly when the module implements domainRequirements + domainStatus. */
  readonly domainVerification: boolean;
  readonly rateLimit?: MailRateLimit;
}


export interface MailFeedbackParser {
  /** Raw bytes in; never throws. Any of `secrets` may match so a webhook secret can rotate. */
  verify(required: {
    rawBody: Uint8Array; headers: Readonly<Record<string, string>>; secrets: readonly string[]; now: number;
  }): boolean;
  /** Headers are passed so a parser can key events on a delivery id (e.g. `svix-id`).
   * Each event must carry eventId + recipient, or the ingest drops it (no dedup key, no suppression key). */
  parse(required: { rawBody: Uint8Array; workspaceId: string; headers: Readonly<Record<string, string>> }): readonly MailerFeedbackEvent[] | { error: string };
}


/** Per-call context: who the call acts for plus the host-resolved credential and guarded HTTP. */
export interface MailProviderCallContext extends ProviderContext {
  readonly credential: MailAdapterCredential;
  readonly httpClient: HttpClientPort;
}


export type MailDomainState = "verified" | "pending" | "failed" | "not_found";


export interface MailProviderModule extends MailAdapterModule {
  readonly id: string;
  readonly label: string;
  /** Credential fields the host must resolve (e.g. `token`, `username`, `baseUrl`). */
  readonly credentialKeys: readonly string[];
  /** Separate vault key for the webhook signing secret, so it rotates independently of the API key. */
  readonly webhookSecretKey?: string;
  readonly capabilities: MailProviderCapabilities;
  readonly feedback?: MailFeedbackParser;
  /** DNS records the provider needs before it will send as `domain`; satisfied through the DNS port. */
  domainRequirements?(ctx: MailProviderCallContext, required: { domain: string }): Promise<ProviderResult<DomainRequirement>>;
  domainStatus?(ctx: MailProviderCallContext, required: { domain: string }): Promise<ProviderResult<{ domain: string; state: MailDomainState }>>;
}


export type MailProviderRegistry = ProviderRegistry<MailProviderModule>;


/** One provider per lane; equal ids today, separable later without a data migration. null = unconfigured. */
export interface MailProviderSetting {
  readonly transactional: string | null;
  readonly bulk: string | null;
}


export type MailLaneState = "ready" | "unconfigured" | "unknown_provider" | "missing_credential" | "local_only";


export interface MailLaneStatus {
  readonly lane: MailDeliveryLane;
  readonly providerId: string | null;
  readonly state: MailLaneState;
}


export type MailStatusWarning = "sender_unverified" | "sender_unknown";


export interface MailStatus {
  /** `unconfigured` drives the blocking admin banner; owner sign-in must never depend on mail. */
  readonly state: "ready" | "unconfigured" | "degraded";
  readonly lanes: readonly MailLaneStatus[];
  readonly warnings: readonly MailStatusWarning[];
}
