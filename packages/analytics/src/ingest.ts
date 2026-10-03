/** Privacy ingest: raw IP/UA are consumed only here; hashes keep the existing byte concatenation. */
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

const EMAIL_SHAPE_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;

const PII_KEY_NAME_PATTERN =
  /email|phone|ssn|social[-_]?security|password|credit[-_]?card|street[-_]?address|full[-_]?name|first[-_]?name|last[-_]?name/i;

function validatePropKeyName(key: string): void {
  if (PII_KEY_NAME_PATTERN.test(key)) {
    throw new AnalyticsPiiRejectedError({ message: `event property key '${key}' looks PII-shaped` });
  }
}

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

/** Reject nested PII shapes and aggregate bounds before a hit reaches the sink. */
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

export interface CoarseIngestInput {
  ip: string;
  userAgent: string;
  siteHost: string;
}

export interface NormalizedIngestContext {
  visitorHash: string;
  deviceClass: DeviceClass;
  browserFamily: string | null;
  osFamily: string | null;
}

const BOT_UA_PATTERN = /bot|crawler|spider|slurp|bingpreview|facebookexternalhit/i;
const TABLET_UA_PATTERN = /ipad|tablet|kindle|playbook/i;
const MOBILE_UA_PATTERN = /mobi|iphone|android/i;

function classifyDeviceClass(ua: string): DeviceClass {
  if (!ua) return "unknown";
  if (BOT_UA_PATTERN.test(ua)) return "bot";
  if (TABLET_UA_PATTERN.test(ua)) return "tablet";
  if (MOBILE_UA_PATTERN.test(ua)) return "mobile";
  return "desktop";
}

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

function classifyOsFamily(ua: string): string | null {
  if (/windows/i.test(ua)) return "windows";

  if (/iphone|ipad|ios/i.test(ua)) return "ios";
  if (/mac os|macintosh/i.test(ua)) return "macos";
  if (/android/i.test(ua)) return "android";
  if (/linux/i.test(ua)) return "linux";
  if (ua) return "other";
  return null;
}

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

const IPV6_GROUP_COUNT = 8;

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

const IPV4_MAPPED_IPV6_PATTERN = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

function truncateIpv4(ip: string): string {
  const octets = ip.split(".");
  if (octets.length === 4) {
    return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
  }
  return "unknown";
}

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

/** Bucket IP and classify UA; return only coarse signals and a salted digest. */
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

export type ResolveWorkspaceForHost = (required: { host: string }) => Promise<UUID | null> | UUID | null;

export interface RawHitInput {
  beacon: IngestBeacon;
  context: IngestContext;
}

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

function toUtcDate(iso: ISODateTime): string {
  return iso.slice(0, 10);
}

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

/** Normalize transient request signals, apply host policy, then invoke the injected sink. */
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
