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
 * Vendor adapters are provider subpaths (`./product/posthog`), loaded by the host only when
 * configured; the contract names no vendor.
 */
import { redactSecrets } from "@jini-ai/core";
import type { JsonObject } from "@jini-ai/core/primitives";

import { validateEventProps } from "../ingest.js";

export type ProductEventProperties = Readonly<Record<string, string | number | boolean>>;

/** One thing a user did. `name` is a fixed snake_case label (`assistant_tool_call`), never user text. */
export interface ProductEvent { name: string; userId: string; properties?: ProductEventProperties; }
/** Who the user is, in pseudonymous traits only (a plan, a role, a locale — never a name or e-mail). */
export interface ProductIdentity { userId: string; traits?: ProductEventProperties; }

/** The port features call. Never throws, never blocks: delivery is the adapter's background job. */
export interface ProductAnalyticsPort {
  capture(event: ProductEvent): void;
  identify(identity: ProductIdentity): void;
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

/** May this user's activity be sent to the product-analytics vendor? The host's consent record decides. */
export type ProductAnalyticsConsent = (input: { userId: string }) => boolean;

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

/**
 * Wraps a vendor port with the rules every product-analytics vendor must get, so no adapter and no
 * call site can skip them: CONSENT first (no consent, nothing leaves — checked per event, so a
 * revoked consent stops the next one), then fixed event names, pseudonymous ids, and the PII/secret
 * property rules. Anything refused is dropped silently: analytics must never fail the feature.
 * @param required The vendor port and the host's consent decision.
 * @returns A guarded port; the noop stays the noop (zero cost when no vendor is configured).
 * @complexity O(p) per event in its property count.
 */
export function withProductAnalyticsGuards({ inner, consent }: { inner: ProductAnalyticsPort; consent: ProductAnalyticsConsent }, _optional: Record<string, never> = {}): ProductAnalyticsPort {
  if (isNoopProductAnalytics(inner)) return inner;
  const allowed = (userId: string): boolean => {
    try { return isPseudonymousId(userId) && consent({ userId }); } catch { return false; }
  };
  return {
    capture({ name, userId, properties }) {
      if (!EVENT_NAME.test(name) || !allowed(userId)) return;
      const safe = safeProperties(properties);
      if (safe === null) return;
      try { inner.capture({ name, userId, ...(safe ? { properties: safe } : {}) }); } catch { /* never fail the feature */ }
    },
    identify({ userId, traits }) {
      if (!allowed(userId)) return;
      const safe = safeProperties(traits);
      if (safe === null) return;
      try { inner.identify({ userId, ...(safe ? { traits: safe } : {}) }); } catch { /* never fail the feature */ }
    },
  };
}
