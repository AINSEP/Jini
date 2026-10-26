/**
 * @file Product analytics: how PEOPLE USE THE PRODUCT (an owner started an assistant chat, a tool
 * call succeeded), as opposed to this package's root entry, which is VISITOR analytics for the sites
 * a product serves (cookie-less pageview hits, salted visitor hashes, ADR-035).
 *
 * A new, small contract rather than an extension of the hit-ingest one (decided 2026-10-25): the
 * subject differs (an identified, pseudonymous product user vs an anonymous site visitor), so does
 * the consent (the operator's vendor-telemetry decision vs the visitor's cookie choice), and so do
 * the vendors (PostHog/Amplitude-style event tools vs pageview counters). Sharing the hit shape
 * would force visitor fields (path, referrer, device class) onto product events and identity onto
 * hits. What IS shared is reused: the PII-shape property check (`validateEventProps`) and core's
 * secret redaction.
 *
 * Every input is ONE object (owner 2026-10-25), so a field added later (a `groups` key, a
 * timestamp) changes no call site and no signature. `userId` is WHO did it: the principal's opaque
 * id, never an e-mail or name.
 *
 * Vendor adapters are provider plugins (`analytics-posthog` in `@jini-ai/provider-plugins`), loaded
 * by the host only when installed, enabled and configured; the contract names no vendor.
 */
import { redactSecrets, redactSecretsWithCounts } from "@jini-ai/core";
import type { JsonObject } from "@jini-ai/core/primitives";

import { validateEventProps } from "../privacy.js";
export { createAiGenerationSink } from "./ai-generations.js";

export type ProductEventProperties = Readonly<Record<string, string | number | boolean>>;

/** One thing a user did. `name` is a fixed snake_case label (`assistant_tool_call`), never user text. */
export interface ProductEvent { name: string; userId: string; properties?: ProductEventProperties; }
/** Who the user is, in pseudonymous traits only (a plan, a role, a locale — never a name or e-mail). */
export interface ProductIdentity { userId: string; traits?: ProductEventProperties; }

/** A model generation's neutral metadata. Text is separate so metadata-only providers cannot leak it. */
export interface ProductAiGeneration { userId: string; properties: ProductEventProperties; input?: string; output?: string; }

/** The port features call. Never throws, never blocks: delivery is the adapter's background job. */
export interface ProductAnalyticsPort {
  capture(event: ProductEvent): void;
  identify(identity: ProductIdentity): void;
  /** Optional capability; providers without LLM analytics keep their existing contract. */
  captureAiGeneration?(required: ProductAiGeneration, optional?: Record<string, never>): void;
  /** Explicit provider opt-in only. The default records counts and metadata, never transcript text. */
  readonly includeAiContent?: boolean;
}

/** What a vendor provider subpath returns: the port plus the host-owned teardown (flush + close). */
export interface ProductAnalyticsAdapter { port: ProductAnalyticsPort; dispose(): Promise<void>; }

const NOOP: ProductAnalyticsPort = Object.freeze({ capture: () => {}, identify: () => {} });

/** The default: does nothing, allocates nothing. One shared frozen object.
 * @returns The shared noop port. @complexity O(1). */
export function createNoopProductAnalytics(_required: Record<string, never>): ProductAnalyticsPort {
  return NOOP;
}

/** True for the shared noop, so a host can skip wrapping a feature at all. */
export function isNoopProductAnalytics(port: ProductAnalyticsPort): boolean {
  return port === NOOP;
}

/** May this user's activity be sent to the product-analytics vendor? The host's consent record decides.
 * A promise is fine (a settings read) when `consentRevision` is also given: the event waits for the
 * answer and is dropped unless it is `true`. */
export type ProductAnalyticsConsent = (input: { userId: string }) => boolean | Promise<boolean>;

/** Synchronous snapshot of the host's consent revision, checked again immediately before delivery.
 * Change it on EVERY consent update, including revoke/regrant, before old reads can settle.
 * Use a global revision for global telemetry settings or a per-user revision for per-user consent. */
export type ProductAnalyticsConsentRevision = (input: { userId: string }) => string | number;

export interface ProductAnalyticsGuardOptions {
  /** Required for async consent: the guard cannot observe settings changes on its own, so without
   * it every promised answer is dropped (fail closed) and the wrapper warns once on the console.
   * Synchronous consent needs none. A failed
   * revision read drops the event, just like a failed consent read. */
  consentRevision?: ProductAnalyticsConsentRevision;
}

const EVENT_NAME = /^[a-z][a-z0-9_.]{0,63}$/;
const MAX_ID = 128;
const PRIVACY = { maxEventPropCount: 20, maxEventPropStringLength: 200, sessionWindowMinutes: 30 };

/** Pseudonymous ids only: e-mail-shaped, over-long or secret-shaped ids are refused (the event is dropped). */
function isPseudonymousId(id: string): boolean {
  return id.length > 0 && id.length <= MAX_ID && !id.includes("@") && redactSecrets({ input: id }) === id;
}

/** Properties after the shared PII check (PII-named keys, e-mail-shaped strings, bounds) and secret
 * redaction, or undefined when the check refuses them: drop the event, never send a partial one. */
function safeProperties(properties: ProductEventProperties | undefined): ProductEventProperties | undefined | null {
  if (properties === undefined) return undefined;
  try { validateEventProps({ props: properties as JsonObject, privacyPolicy: PRIVACY }); } catch { return null; }
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(properties)) safe[key] = typeof value === "string" ? redactSecrets({ input: value }) : value;
  return safe;
}

/** Explicit opt-in text is still redacted and bounded before delivery. O(n) in supplied text. */
function generationContent({ input, output }: { input?: string; output?: string }, _optional: Record<string, never> = {}): { input?: string; output?: string } {
  const content: { input?: string; output?: string } = {};
  // Redact before truncating: a cut through a credential can hide its recognizable shape.
  if (input !== undefined) content.input = redactSecretsWithCounts({ input }).redacted.slice(0, 16_000);
  if (output !== undefined) content.output = redactSecretsWithCounts({ input: output }).redacted.slice(0, 16_000);
  return content;
}

/**
 * Wraps a vendor port with the rules every product-analytics vendor must get, so no adapter and no
 * call site can skip them: CONSENT first (no consent, nothing leaves — checked per event, so a
 * revoked consent stops the next one and invalidates pending approvals), then fixed event names,
 * pseudonymous ids, and the PII/secret property rules. Anything refused is dropped silently:
 * analytics must never fail the feature.
 * @param required The vendor port and the host's consent decision.
 * @param options A synchronous host consent revision for revocation without a subsequent event.
 * @returns A guarded port; the noop stays the noop (zero cost when no vendor is configured).
 * @complexity O(p + t) per event for properties and opt-in text; O(d) in-flight consent decisions.
 */
export function withProductAnalyticsGuards({ inner, consent }: { inner: ProductAnalyticsPort; consent: ProductAnalyticsConsent }, { consentRevision }: ProductAnalyticsGuardOptions = {}): ProductAnalyticsPort {
  if (isNoopProductAnalytics(inner)) return inner;
  // Keep generations only while decisions are in flight; past users do not accumulate here.
  const pending = new Map<string, { generation: number; count: number }>();
  let reportedMissingRevision = false;
  /** Once per wrapper: an async consent with no revision is a host misconfiguration (every promised
   * approval is dropped), so say so instead of losing all events silently. The wrapper has no
   * diagnostic hook, hence the console. Guarded locally: a throw escaping into `whenAllowed`'s catch
   * would skip attaching handlers to the consent promise and leave a rejection unhandled. */
  const reportMissingRevision = (): void => {
    if (reportedMissingRevision) return;
    reportedMissingRevision = true;
    try {
      console.warn("[analytics/product] async consent without consentRevision: every promised approval is dropped (fail closed). Pass { consentRevision } to withProductAnalyticsGuards.");
    } catch { /* Diagnostics never fail the feature. */ }
  };
  /** Runs `send` only after a current explicit approval; synchronous answers stay synchronous. */
  const whenAllowed = ({ userId, send }: { userId: string; send: () => void }): void => {
    if (!isPseudonymousId(userId)) return;
    const state = pending.get(userId) ?? { generation: 0, count: 0 };
    pending.set(userId, state);
    state.count += 1;
    const generation = state.generation;
    let revision: string | number | undefined;
    const settle = ({ allowed }: { allowed: boolean }): void => {
      try {
        if (allowed !== true) { state.generation += 1; return; }
        if (generation !== state.generation) return;
        if (consentRevision && consentRevision({ userId }) !== revision) return;
        try { send(); } catch { /* A vendor failure must not invalidate other pending approvals. */ }
      } catch {
        state.generation += 1; // Failed checks fail closed; analytics never fails the feature.
      } finally {
        state.count -= 1;
        if (state.count === 0) pending.delete(userId);
      }
    };
    try {
      revision = consentRevision?.({ userId });
      const decision = consent({ userId });
      if (typeof decision === "boolean") return settle({ allowed: decision });
      // Without a revision an async approval cannot see a revoke that lands while it is in flight
      // (no later denial need ever arrive), so it fails closed: analytics only after consent.
      const canSeeRevoke = consentRevision !== undefined;
      if (!canSeeRevoke) reportMissingRevision();
      void Promise.resolve(decision).then((allowed) => settle({ allowed: canSeeRevoke && allowed }), () => settle({ allowed: false }));
    } catch { settle({ allowed: false }); }
  };
  return {
    ...(inner.captureAiGeneration ? {
      includeAiContent: inner.includeAiContent === true,
      captureAiGeneration({ userId, properties, ...content }: ProductAiGeneration, _optional: Record<string, never> = {}) {
        const safe = safeProperties(properties);
        if (!safe) return;
        const safeContent = inner.includeAiContent === true ? generationContent(content) : {};
        whenAllowed({ userId, send: () => inner.captureAiGeneration?.({ userId, properties: safe, ...safeContent }) });
      },
    } : {}),
    capture({ name, userId, properties }) {
      if (!EVENT_NAME.test(name)) return;
      const safe = safeProperties(properties);
      if (safe === null) return;
      whenAllowed({ userId, send: () => inner.capture({ name, userId, ...(safe ? { properties: safe } : {}) }) });
    },
    identify({ userId, traits }) {
      const safe = safeProperties(traits);
      if (safe === null) return;
      whenAllowed({ userId, send: () => inner.identify({ userId, ...(safe ? { traits: safe } : {}) }) });
    },
  };
}
