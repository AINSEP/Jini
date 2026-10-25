/** Platform-neutral privacy rules shared by visitor ingestion and product analytics.
 * Keep Node hashing and salt custody in ingest; importing these guards must work in browsers. */
import type { JsonObject } from "@jini-ai/core/primitives";
import { AnalyticsPiiRejectedError } from "./ports.js";
import type { AnalyticsPrivacyPolicy } from "./types.js";

/** Validate host privacy bounds shared by ingestion and product properties.
 * @throws RangeError for non-positive or non-integer bounds. @complexity O(1). */
export function validatePrivacyPolicy({ privacyPolicy: policy }: { privacyPolicy: AnalyticsPrivacyPolicy }, _optional: Record<string, never> = {}): void {
  for (const bound of [policy.maxEventPropCount, policy.maxEventPropStringLength, policy.sessionWindowMinutes]) {
    if (!Number.isSafeInteger(bound) || bound <= 0) throw new RangeError("analytics privacy bounds must be positive integers");
  }
}

/** Loose email-shape check — deliberately simple for v1, not a general PII classifier. */
const EMAIL_SHAPE_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** Decodes one path segment for the shape check; a malformed escape is checked as written. */
function decodedSegment(segment: string): string {
  try { return decodeURIComponent(segment); } catch { return segment; }
}

/**
 * Replaces every email-shaped path segment (literal or percent-encoded) with `:redacted`. The local
 * sink keeps the path as ingested; this is the shared check for data leaving the host (vendor
 * forwarding), where `/users/alice@example.com` would otherwise reach a third party.
 * @complexity O(n) over the path's characters.
 */
export function redactPiiPathSegments(required: { path: string }, _optional: Record<string, never> = {}): string {
  return required.path.split("/").map((segment) => (EMAIL_SHAPE_PATTERN.test(decodedSegment(segment)) ? ":redacted" : segment)).join("/");
}

/** Property-key names that read as PII by themselves, regardless of value. */
const PII_KEY_NAME_PATTERN =
  /email|phone|ssn|social[-_]?security|password|credit[-_]?card|street[-_]?address|full[-_]?name|first[-_]?name|last[-_]?name/i;

/** Check one property or beacon label using the shared PII and string bounds; queue nested values.
 * @throws AnalyticsPiiRejectedError for PII-shaped keys/values or excessive length.
 * @complexity O(n) in the key and string-value length; nested bags are visited by the caller. */
export function validateEventPropEntry(required: {
  key: string;
  value: unknown;
  maxLength: number;
  pending: Record<string, unknown>[];
}, _optional: Record<string, never> = {}): void {
  const { key, value, maxLength, pending } = required;
  /** A PII-suggestive key name is rejected regardless of its value type or shape. */
  if (PII_KEY_NAME_PATTERN.test(key)) {
    throw new AnalyticsPiiRejectedError({ message: `event property key '${key}' looks PII-shaped` });
  }
  /** String values additionally get a length bound and an email-shape rejection. */
  if (typeof value === "string") {
    if (value.length > maxLength) {
      throw new AnalyticsPiiRejectedError({ message: `event property '${key}' exceeds ${maxLength} characters` });
    }
    if (EMAIL_SHAPE_PATTERN.test(value)) {
      throw new AnalyticsPiiRejectedError({ message: `event property '${key}' looks like an email address` });
    }
  }
  if (value !== null && typeof value === "object") pending.push(value as Record<string, unknown>);
}

/**
 * Validate bounded custom properties with a simple heuristic: PII-shaped keys, email-shaped
 * strings, and aggregate property-count/string-length bounds. This is not a general PII classifier.
 * Traverses nested objects/arrays so identifiers cannot bypass the sink boundary inside a bag.
 * @param required - Properties (null/undefined when absent) and explicit host privacy bounds.
 * @returns The same object after validation, or null for absent properties.
 * @throws AnalyticsPiiRejectedError for policy violations; RangeError for invalid privacy bounds.
 * @complexity O(k) over properties, bounded by privacyPolicy.maxEventPropCount.
 */
export function validateEventProps(required: { props: JsonObject | null | undefined; privacyPolicy: AnalyticsPrivacyPolicy }, _optional: Record<string, never> = {}): JsonObject | null {
  const { props, privacyPolicy } = required;
  validatePrivacyPolicy({ privacyPolicy });
  const maxCount = privacyPolicy.maxEventPropCount;
  if (props === null || props === undefined) return null;

  const keys = Object.keys(props);
  if (keys.length > maxCount) {
    throw new AnalyticsPiiRejectedError({ message: `event properties exceed the ${maxCount}-key bound (${keys.length} given)` });
  }

  const pending: Record<string, unknown>[] = [props];
  let propertyCount = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    const currentKeys = Object.keys(current);
    propertyCount += currentKeys.length;
    if (propertyCount > maxCount) {
      throw new AnalyticsPiiRejectedError({ message: `event properties exceed the ${maxCount}-key bound` });
    }
    for (const key of currentKeys) {
      const value = current[key];
      validateEventPropEntry({ key, value, maxLength: privacyPolicy.maxEventPropStringLength, pending });
    }
  }

  return props;
}

