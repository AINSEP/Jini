/**
 * @file Ingest-side normalization and handler logic for the host-independent `analytics` library (ADR-035).
 *
 * Purpose:
 * Implements the ingest half of ADR-035's Round-2 fold split: the beacon endpoint's normalization,
 * PII-death-at-the-sink-boundary, and salt custody. Storage/rollup/dashboards/goals/export are a
 * separate, later Tier-3 concern and are explicitly NOT implemented here.
 *
 * How it relates to the project:
 * - Consumes the stable type/port surface from `./types` and `./ports` (not redesigned here).
 * - `normalizeIngestContext` is the PII-death boundary the ADR is about: raw IP/User-Agent are
 *   accepted as function parameters, folded into a salted hash, and never placed on the returned
 *   object — there is no code path by which they can reach a `NormalizedHit`.
 * - `ingestHit` composes workspace resolution, config-driven DNT/GPC/exclusion checks, PII-shape
 *   validation, and hands the resulting `NormalizedHit` to an injected `AnalyticsSinkPort`. It
 *   never throws for expected/policy outcomes (unresolved workspace, disabled site, excluded
 *   traffic, rejected properties) — those are reported via the `{ accepted, reason }` result, per
 *   the ADR's fire-and-forget beacon contract (§5: "the beacon response never blocks"). Only a
 *   genuinely unexpected error (e.g. the injected sink throwing) propagates.
 */
import { createHash } from "node:crypto";

import type { ISODateTime, JsonObject, UUID } from "@jini-ai/core/primitives";
import type { IngestDeps } from "./ports.js";
import { AnalyticsPiiRejectedError } from "./ports.js";
import { deriveDailySalt, type AnalyticsSaltContext, type AnalyticsHashPort } from "./salt.js";
import type {
  AnalyticsPrivacyPolicy,
  AnalyticsSiteConfig,
  DeviceClass,
  IngestBeacon,
  IngestContext,
  NormalizedHit,
  UtmParams,
} from "./types.js";

/** Native hash adapter is stateless; all app-specific derivation context remains required. */
export function createNodeAnalyticsHash(_required: Record<string, never>): AnalyticsHashPort {
  return {
    deriveDailySalt,
    sha256({ parts }) {
      const digest = createHash("sha256");
      for (const part of parts) digest.update(part);
      return digest.digest("hex");
    },
  };
}
const nodeHash = createNodeAnalyticsHash({});

function validatePrivacyPolicy(policy: AnalyticsPrivacyPolicy): void {
  for (const bound of [policy.maxEventPropCount, policy.maxEventPropStringLength, policy.sessionWindowMinutes]) {
    if (!Number.isSafeInteger(bound) || bound <= 0) throw new RangeError("analytics privacy bounds must be positive integers");
  }
}

/** Loose email-shape check — deliberately simple for v1 (see file header). */
const EMAIL_SHAPE_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** Property-key names that read as PII by themselves, regardless of value. */
const PII_KEY_NAME_PATTERN =
  /email|phone|ssn|social[-_]?security|password|credit[-_]?card|street[-_]?address|full[-_]?name|first[-_]?name|last[-_]?name/i;

/** A PII-suggestive key name is rejected regardless of its value type or shape. */
function validatePropKeyName(key: string): void {
  if (PII_KEY_NAME_PATTERN.test(key)) {
    throw new AnalyticsPiiRejectedError({ message: `event property key '${key}' looks PII-shaped` });
  }
}

/** String values additionally get a length bound and an email-shape rejection. */
function validatePropStringValue(key: string, value: string, maxLength: number): void {
  if (value.length > maxLength) {
    throw new AnalyticsPiiRejectedError({ message: `event property '${key}' exceeds ${maxLength} characters` });
  }
  if (EMAIL_SHAPE_PATTERN.test(value)) {
    throw new AnalyticsPiiRejectedError({ message: `event property '${key}' looks like an email address` });
  }
}

function validateEventPropEntry(key: string, value: unknown, maxLength: number): void {
  validatePropKeyName(key);
  if (typeof value !== "string") return;
  validatePropStringValue(key, value, maxLength);
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
export function validateEventProps(required: { props: JsonObject | null | undefined; privacyPolicy: AnalyticsPrivacyPolicy }): JsonObject | null {
  const { props, privacyPolicy } = required;
  validatePrivacyPolicy(privacyPolicy);
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
      validateEventPropEntry(key, value, privacyPolicy.maxEventPropStringLength);
      if (value !== null && typeof value === "object") pending.push(value as Record<string, unknown>);
    }
  }

  return props;
}

/** Raw per-request signals consumed transiently by `normalizeIngestContext`. */
export interface CoarseIngestInput {
  ip: string;
  userAgent: string;
  siteHost: string;
}

/** The only output of coarse-signal normalization — no `ip`/`userAgent` field exists on this type. */
export interface NormalizedIngestContext {
  visitorHash: string;
  deviceClass: DeviceClass;
  browserFamily: string | null;
  osFamily: string | null;
}

const BOT_UA_PATTERN = /bot|crawler|spider|slurp|bingpreview|facebookexternalhit/i;
const TABLET_UA_PATTERN = /ipad|tablet|kindle|playbook/i;
const MOBILE_UA_PATTERN = /mobi|iphone|android/i;

/** Classifies a User-Agent into a coarse device class; bots/tablets precede mobile. */
function classifyDeviceClass(ua: string): DeviceClass {
  if (!ua) return "unknown";
  if (BOT_UA_PATTERN.test(ua)) return "bot";
  if (TABLET_UA_PATTERN.test(ua)) return "tablet";
  if (MOBILE_UA_PATTERN.test(ua)) return "mobile";
  return "desktop";
}

/**
 * iOS Chrome/Firefox are WebKit-forced (Apple's App Store review rules require every iOS browser
 * to use WebKit) and identify via their own product tokens rather than "chrome/"/"firefox/" —
 * "CriOS/" and "FxiOS/" respectively — while still carrying a trailing "Safari/" token for
 * web-compat. Must be checked BEFORE the safari fallback below, or every iOS Chrome/Firefox
 * visitor falls through and is misclassified "safari" (see ingest.test.ts's real-device-UA
 * regression tests).
 */
function classifyBrowserFamily(ua: string): string | null {
  if (/edg\//i.test(ua)) return "edge";

  if (/crios\//i.test(ua)) return "chrome";
  if (/fxios\//i.test(ua)) return "firefox";
  if (/chrome\//i.test(ua)) return "chrome";
  if (/firefox\//i.test(ua)) return "firefox";
  if (/safari\//i.test(ua) && !/chrome/i.test(ua)) return "safari";
  if (ua) return "other";
  return null;
}

/**
 * Checked BEFORE "mac os|macintosh": a real iPhone/iPad Safari UA always contains the literal
 * substring "like Mac OS X" (WebKit compatibility convention), so testing macOS first would
 * classify every genuine mobile Safari visitor as "macos" and this branch would never fire on
 * real traffic (see ingest.test.ts's real-device-UA regression tests).
 */
function classifyOsFamily(ua: string): string | null {
  if (/windows/i.test(ua)) return "windows";

  if (/iphone|ipad|ios/i.test(ua)) return "ios";
  if (/mac os|macintosh/i.test(ua)) return "macos";
  if (/android/i.test(ua)) return "android";
  if (/linux/i.test(ua)) return "linux";
  if (ua) return "other";
  return null;
}

/**
 * Classifies a User-Agent string into a coarse device class + browser/OS family. Intentionally
 * coarse (family only, never the raw string) — this is the "UA → device class" transient use the
 * ADR describes, not a fingerprinting-grade parser.
 *
 * @complexity O(1) — a fixed, small sequence of regex tests.
 */
function classifyUserAgent(userAgent: string): {
  deviceClass: DeviceClass;
  browserFamily: string | null;
  osFamily: string | null;
} {
  const ua = userAgent ?? "";
  return {
    deviceClass: classifyDeviceClass(ua),
    browserFamily: classifyBrowserFamily(ua),
    osFamily: classifyOsFamily(ua),
  };
}

/** Total hextet groups in a fully-expanded IPv6 address. */
const IPV6_GROUP_COUNT = 8;

/**
 * Expands a `"::"` zero-run shorthand to the hextet groups it represents, so the caller always
 * works with the address's real group order regardless of where (or whether) shorthand was used.
 * An address with no `"::"` is simply split/filtered, unchanged from before.
 *
 * @complexity O(1) — bounded by the fixed 8-group IPv6 shape.
 */
function expandIpv6Groups(ip: string): string[] {
  if (!ip.includes("::")) {
    return ip.split(":").filter((group) => group.length > 0);
  }

  const [head, tail] = ip.split("::");
  const headGroups = head ? head.split(":").filter((group) => group.length > 0) : [];
  const tailGroups = tail ? tail.split(":").filter((group) => group.length > 0) : [];
  const zerosNeeded = Math.max(IPV6_GROUP_COUNT - headGroups.length - tailGroups.length, 0);

  return [...headGroups, ...Array(zerosNeeded).fill("0"), ...tailGroups];
}

/** Matches an RFC 4291 SS2.5.5.2 IPv4-mapped IPv6 address, e.g. `"::ffff:192.168.1.1"`. */
const IPV4_MAPPED_IPV6_PATTERN = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

/** Buckets a dotted-quad IPv4 address to its /24, or `"unknown"` if it isn't a 4-octet address. */
function truncateIpv4(ip: string): string {
  const octets = ip.split(".");
  if (octets.length === 4) {
    return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
  }
  return "unknown";
}

/**
 * Truncates/buckets an IP address to a coarse prefix (IPv4 /24, IPv6 /48) so the request signal
 * folded into `visitorHash` never encodes a full, individually-identifying address.
 *
 * IPv6 addresses are expanded (via {@link expandIpv6Groups}) before bucketing, so a `"::"`-
 * shorthand address and its fully-expanded equivalent (the SAME real address, written two ways)
 * always land in the same bucket — bucketing on the raw, unexpanded groups would otherwise shift
 * a shorthand address's trailing group into the "first 3" slot.
 *
 * An IPv4-mapped IPv6 address (`"::ffff:a.b.c.d"`) is bucketed as the SAME /24 as the bare IPv4
 * form, not run through the IPv6 group-expansion path — the mapped form's head is always six
 * zero groups + `"ffff"`, so slicing its first 3 expanded groups is always `["0","0","0"]`
 * regardless of the mapped address, collapsing every IPv4-mapped visitor into one bucket. This
 * matters in production: a host may bind either dual-stack or loopback-only — both forms are handled here, since a
 * dual-stack entrypoint receives every IPv4 peer as
 * `::ffff:a.b.c.d`.
 *
 * A bracketed address (`"[::1]"`, as seen in host:port contexts) has its brackets stripped before
 * classification rather than being rejected to `"unknown"` — the address itself is otherwise
 * well-formed, so bucketing it normally is more useful than discarding the signal.
 *
 * Deliberately not handled for socket-derived addresses: Node/libuv inet_ntop renders valid,
 * lowercase, non-zero-padded IPv6 syntax, so the following forms are not reachable unless
 * a host enables trust proxy or derives IPs from headers:
 * a zone index (`"fe80::1%eth0"`), two `"::"` in one address (illegal), and case/leading-zero
 * variants (`"2001:0DB8::1"` vs `"2001:db8::1"`). If `trust proxy` / header-derived IPs are ever
 * introduced, these become reachable and this function should canonicalize (lowercase, strip
 * leading zeros) and validate (reject malformed `"::"` usage) before bucketing.
 *
 * @complexity O(1).
 */
function truncateIp(ip: string): string {
  const unwrapped = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;

  const ipv4Mapped = IPV4_MAPPED_IPV6_PATTERN.exec(unwrapped);
  if (ipv4Mapped) {
    return truncateIpv4(ipv4Mapped[1]!);
  }

  if (unwrapped.includes(":")) {
    const groups = expandIpv6Groups(unwrapped);
    return `${groups.slice(0, 3).join(":")}::`;
  }

  return truncateIpv4(unwrapped);
}

/**
 * The PII-death boundary. Accepts the raw per-request IP/User-Agent as transient input fields
 * (never stored or attached to any returned record) and returns only a salted, non-reversible
 * `visitorHash` plus coarse device/browser/os classes. `dailySalt` must come from
 * {@link deriveDailySalt}; the caller is responsible for its 24h rotation.
 *
 * `visitorHash = sha256(dailySalt ‖ siteHost ‖ coarseRequestSignal)`, where `coarseRequestSignal`
 * is the bucketed IP prefix plus the coarse browser-family/device-class pair (never the raw
 * IP/UA string) — see ADR-035 §4 / OQ-2.
 *
 * @param required.input - `{ ip, userAgent, siteHost }`, consumed transiently only within this call.
 * @param required.dailySalt - The current day's derived salt (never persisted; see `salt.ts`).
 * @returns `{ visitorHash, deviceClass, browserFamily, osFamily }` — deliberately has no `ip` or
 *   `userAgent` field, by type, so raw request identifiers cannot leak downstream by accident.
 * @complexity O(1).
 */
export function normalizeIngestContext(
  required: { input: CoarseIngestInput; dailySalt: Buffer },
  optional: { hash?: AnalyticsHashPort } = {}
): NormalizedIngestContext {
  const { input, dailySalt } = required;
  const { ip, userAgent, siteHost } = input;

  const truncatedIp = truncateIp(ip);
  const uaClass = classifyUserAgent(userAgent);
  const coarseRequestSignal = `${truncatedIp}|${uaClass.deviceClass}|${uaClass.browserFamily ?? "none"}`;

  const visitorHash = (optional.hash ?? nodeHash).sha256({ parts: [dailySalt, siteHost, coarseRequestSignal] });

  return {
    visitorHash,
    deviceClass: uaClass.deviceClass,
    browserFamily: uaClass.browserFamily,
    osFamily: uaClass.osFamily,
  };
}

/** Resolves a site host to a workspace id. Real host-based routing is out of scope for this slice. */
export type ResolveWorkspaceForHost = (required: { host: string }) => Promise<UUID | null> | UUID | null;

/** Raw payload the ingest handler accepts: the beacon plus the per-request transient context. */
export interface RawHitInput {
  beacon: IngestBeacon;
  context: IngestContext;
}

/**
 * Deps for `ingestHit`. Extends the port-declared {@link IngestDeps} (sink/config)
 * with the host seams this slice needs that are not yet modeled as ports: host→workspace
 * resolution (real routing is out of scope) and the salt root-key seed (the host retains custody and supplies explicit derivation context).
 */
export interface IngestHitDeps extends IngestDeps {
  resolveWorkspaceForHost: ResolveWorkspaceForHost;

  rootKeySeed: string;
  saltContext: AnalyticsSaltContext;
  privacyPolicy: AnalyticsPrivacyPolicy;
}

export interface IngestHitOptional { hooks?: import("./ports.js").AnalyticsHooks; hash?: AnalyticsHashPort }

export interface IngestHitRequired {
  input: RawHitInput;
  deps: IngestHitDeps;
}

/** Machine-readable drop reasons. `accepted: true` never carries a `reason`. */
export type IngestDropReason =
  | "workspace_unresolved"
  | "analytics_disabled"
  | "dnt"
  | "gpc"
  | "excluded_path"
  | "excluded_ip"
  | "pii_rejected"
  | "dropped_by_hook";

export interface IngestHitResult {
  accepted: boolean;
  reason?: IngestDropReason;
}

/**
 * Finds the first policy reason a hit should be dropped for (DNT/GPC/path/IP exclusion), or
 * `null` when none apply. Kept as a pure decision function (no I/O, no side effects) separate
 * from `ingestHit`'s effects, per the coding-foundations decision/effect-separation rule.
 *
 * @complexity O(p + r) over the excluded-paths and excluded-IP-ranges config lists (both small,
 *   operator-configured lists — not user-variable-sized collections).
 */
function findExclusionReason(input: {
  beacon: IngestBeacon;
  ip: string;
  config: AnalyticsSiteConfig;
}): IngestDropReason | null {
  const { beacon, ip, config } = input;

  if (config.honorDoNotTrack && beacon.dnt) return "dnt";
  if (config.honorGlobalPrivacyControl && beacon.gpc) return "gpc";
  if (isPathExcluded(beacon.path, config.excludedPaths)) return "excluded_path";
  if (isIpExcluded(ip, config.excludedIpRanges)) return "excluded_ip";
  return null;
}

/** Matches a path against a small set of glob patterns (`*` wildcard only — v1 simplicity). */
function isPathExcluded(path: string, excludedPaths: readonly string[]): boolean {
  return excludedPaths.some((pattern) => pathMatchesGlob(path, pattern));
}

function pathMatchesGlob(path: string, pattern: string): boolean {
  if (!pattern.includes("*")) return path === pattern;
  const regexBody = pattern
    .split("*")
    .map((segment) => segment.replace(/[.+^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${regexBody}$`).test(path);
}

/** Matches an IP against a small set of exact addresses or IPv4 CIDR ranges (v1: IPv4 CIDR only). */
function isIpExcluded(ip: string, excludedRanges: readonly string[]): boolean {
  return excludedRanges.some((range) => ipMatchesRange(ip, range));
}

function ipMatchesRange(ip: string, range: string): boolean {
  const mapped = IPV4_MAPPED_IPV6_PATTERN.exec(ip);
  if (mapped) ip = mapped[1]!;
  if (!range.includes("/")) return ip === range;

  const [rangeIp = "", prefixRaw] = range.split("/");
  const prefix = Number(prefixRaw);
  if (ip.includes(":") || rangeIp.includes(":") || Number.isNaN(prefix)) return false;

  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(rangeIp);
  if (ipInt === null || rangeInt === null) return false;

  const mask = prefix <= 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return null;
  }
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

/** `YYYY-MM-DD` slice of an ISO timestamp — the salt-rotation boundary (ADR-035 §4, 24h). */
function toUtcDate(iso: ISODateTime): string {
  return iso.slice(0, 10);
}

/**
 * Derives a session id from the visitor hash plus a bounded, same-day time window, so it is never
 * cross-day linkable (the session contract requires no cross-day linkability). This is a v1 simplification of session
 * boundary logic (true session stitching — extending a session across window edges — is a
 * rollup/session-table concern, out of scope for the ingest-only slice); it is deterministic and
 * good enough to satisfy `NormalizedHit.sessionId` at ingest time.
 *
 * Session-window edges yield two session IDs; true stitching belongs to the later
 * rollup/session-table logic (out of this slice's scope).
 * @complexity O(1).
 */
function deriveSessionId(visitorHash: string, occurredAt: ISODateTime, windowMinutes: number, hash: AnalyticsHashPort): string {
  const utcDate = toUtcDate(occurredAt);
  const occurredDate = new Date(occurredAt);
  const minutesSinceMidnight = occurredDate.getUTCHours() * 60 + occurredDate.getUTCMinutes();
  const windowIndex = Math.floor(minutesSinceMidnight / windowMinutes);

  return hash.sha256({ parts: [`${visitorHash}:${utcDate}:${windowIndex}`] });
}

function extractReferrerHost(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname || null;
  } catch {
    return null;
  }
}

const EMPTY_UTM: UtmParams = { source: null, medium: null, campaign: null, term: null, content: null };

/**
 * Extracts the allowlisted UTM query params when a query string happens to still be present on
 * `beacon.path` (the type's own docs say UTMs are "extracted server-side" upstream of this
 * handler; this is a defensive fallback, not the primary extraction point).
 */
function extractUtm(pathWithMaybeQuery: string): UtmParams {
  const queryIndex = pathWithMaybeQuery.indexOf("?");
  if (queryIndex === -1) return EMPTY_UTM;

  const params = new URLSearchParams(pathWithMaybeQuery.slice(queryIndex + 1).split("#", 1)[0]);
  return {
    source: params.get("utm_source"),
    medium: params.get("utm_medium"),
    campaign: params.get("utm_campaign"),
    term: params.get("utm_term"),
    content: params.get("utm_content"),
  };
}

/**
 * The ingest application service: beacon + transient context → normalized, PII-free hit → sink.
 * Never blocks on aggregation (fire-and-forget, ADR-035 §5) and never throws for expected/policy
 * outcomes — unresolved workspace, a disabled site, DNT/GPC/exclusion, and PII-shaped properties
 * all report as `{ accepted: false, reason }` rather than rejecting the returned promise, since a
 * public unauthenticated beacon endpoint must not turn policy outcomes into 500s. Only a genuinely
 * unexpected failure (e.g. the injected sink itself throwing) propagates to the caller.
 *
 * Explicitly OUT of scope here (Tier-3, later): rate-limiting (an HTTP-layer concern above this
 * function), geo-IP country/region lookup (no `GeoIpPort` exists yet — `country`/`region` are
 * emitted as `null`), and anything downstream of the sink (rollup, storage, dashboards, goals).
 *
 * @param required.input - `{ beacon, context }` — the raw beacon payload and per-request signals.
 * @param required.deps - `{ resolveWorkspaceForHost, config, rootKeySeed, saltContext, privacyPolicy, sink }`.
 * @param optional - Optional normalized-hit hooks and hashing adapter.
 * @returns `{ accepted, reason? }`. `reason` is set only when `accepted` is `false`.
 * @complexity O(1) plus the bounded exclusion-list scan in {@link findExclusionReason}.
 */
export async function ingestHit(required: IngestHitRequired, optional: IngestHitOptional = {}): Promise<IngestHitResult> {
  const { input, deps } = required;
  const { beacon, context } = input;
  validatePrivacyPolicy(deps.privacyPolicy);
  const hash = optional.hash ?? nodeHash;

  const workspaceId = await deps.resolveWorkspaceForHost({ host: beacon.host });
  if (!workspaceId) {
    return { accepted: false, reason: "workspace_unresolved" };
  }

  const config = await deps.config.get({ workspaceId });
  if (!config.enabled) {
    return { accepted: false, reason: "analytics_disabled" };
  }

  const exclusionReason = findExclusionReason({ beacon, ip: context.ip, config });
  if (exclusionReason) {
    return { accepted: false, reason: exclusionReason };
  }

  let eventProps: JsonObject | null;
  try {
    eventProps = validateEventProps({ props: beacon.eventProps, privacyPolicy: deps.privacyPolicy });
  } catch (err) {
    if (err instanceof AnalyticsPiiRejectedError) {
      return { accepted: false, reason: "pii_rejected" };
    }
    throw err;
  }

  const utcDate = toUtcDate(context.receivedAt);
  const dailySalt = hash.deriveDailySalt({ rootKeySeed: deps.rootKeySeed, workspaceId, utcDate, saltContext: deps.saltContext });
  const normalized = normalizeIngestContext({
    input: { ip: context.ip, userAgent: context.userAgent, siteHost: beacon.host },
    dailySalt,
  }, { hash });

  const hit: NormalizedHit = {
    workspaceId,
    occurredAt: context.receivedAt,
    kind: beacon.kind,
    path: beacon.path.split(/[?#]/, 1)[0]!,
    referrerHost: extractReferrerHost(beacon.referrer),
    utm: extractUtm(beacon.path),
    country: null,
    region: null,
    deviceClass: normalized.deviceClass,
    browserFamily: normalized.browserFamily,
    osFamily: normalized.osFamily,
    visitorHash: normalized.visitorHash,
    sessionId: deriveSessionId(normalized.visitorHash, context.receivedAt, deps.privacyPolicy.sessionWindowMinutes, hash),
    eventName: beacon.eventName ?? null,
    eventProps,
  };

  const finalHit = optional.hooks ? await optional.hooks.beforeIngest({ hit }) : hit;
  if (finalHit === null) {
    return { accepted: false, reason: "dropped_by_hook" };
  }

  await deps.sink.accept({ hit: finalHit });
  return { accepted: true };
}
