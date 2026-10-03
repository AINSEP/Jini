import assert from "node:assert/strict";
import { test } from "vitest";

import type { JsonObject, UUID } from "@jini-ai/core/primitives";
import { AnalyticsPiiRejectedError, type AnalyticsConfigPort } from "../ports.js";
import {
  ingestHit as ingest,
  normalizeIngestContext,
  validateEventProps,
  type IngestHitDeps,
  type IngestHitRequired,
  type IngestHitOptional,
} from "../ingest.js";
import { LocalBufferSink } from "../repo.memory.js";
import type { AnalyticsSiteConfig, IngestBeacon, IngestContext } from "../types.js";

const POLICY = { maxEventPropCount: 20, maxEventPropStringLength: 200, sessionWindowMinutes: 30 };
const SALT_CONTEXT = { extractionSalt: "fixture-analytics-hkdf-v1", infoPrefix: "analytics-salt:" };

// The fixture separates the optional hook from required dependencies before calling the public API.
function ingestHit(required: IngestHitRequired & { deps: IngestHitDeps & IngestHitOptional }) {
  const { hooks, hash, ...deps } = required.deps;
  return ingest({ ...required, deps }, { ...(hooks ? { hooks } : {}), ...(hash ? { hash } : {}) });
}

const ROOT_KEY_SEED = "test-root-key-seed-do-not-use-in-prod";

const RAW_IP = "203.0.113.77";
const RAW_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function makeSalt(utcDate: string): Buffer {

  return Buffer.from(`fixed-test-salt-${utcDate}`.padEnd(32, "0").slice(0, 32));
}

test("normalizeIngestContext is deterministic for the same (salt, ip, ua)", () => {
  const salt = makeSalt("2026-07-10");
  const first = normalizeIngestContext({ input: { ip: RAW_IP, userAgent: RAW_USER_AGENT, siteHost: "example.com" }, dailySalt: salt });
  const second = normalizeIngestContext({ input: { ip: RAW_IP, userAgent: RAW_USER_AGENT, siteHost: "example.com" }, dailySalt: salt });

  assert.equal(first.visitorHash, second.visitorHash);
  assert.equal(first.deviceClass, "desktop");
  assert.equal(first.browserFamily, "chrome");
  assert.equal(first.osFamily, "windows");
  assert.equal(first.visitorHash, "7cee99de1d956ba97078c93445df99b3f9cfeb3a6f1b4e8eb30f7743834a232d");
  const safari = normalizeIngestContext({ input: { ip: RAW_IP, userAgent: "Safari/605.1.15", siteHost: "example.com" }, dailySalt: salt });
  const otherHost = normalizeIngestContext({ input: { ip: RAW_IP, userAgent: RAW_USER_AGENT, siteHost: "other.example" }, dailySalt: salt });
  assert.notEqual(first.visitorHash, safari.visitorHash);
  assert.notEqual(first.visitorHash, otherHost.visitorHash);
});

test("normalizeIngestContext produces a different hash when the day (salt) rotates", () => {
  const day1Salt = makeSalt("2026-07-10");
  const day2Salt = makeSalt("2026-07-11");

  const day1 = normalizeIngestContext({ input: { ip: RAW_IP, userAgent: RAW_USER_AGENT, siteHost: "example.com" }, dailySalt: day1Salt });
  const day2 = normalizeIngestContext({ input: { ip: RAW_IP, userAgent: RAW_USER_AGENT, siteHost: "example.com" }, dailySalt: day2Salt });

  assert.notEqual(day1.visitorHash, day2.visitorHash);
});

test("normalizeIngestContext buckets an IPv4 address to its /24 before hashing: same first 3 octets -> same hash, different 3rd octet -> different hash", () => {
  const salt = makeSalt("2026-07-10");
  const args = (ip: string) => ({ input: { ip, userAgent: RAW_USER_AGENT, siteHost: "example.com" }, dailySalt: salt });

  const first = normalizeIngestContext(args("203.0.113.1"));
  const sameSubnet = normalizeIngestContext(args("203.0.113.254"));
  const differentSubnet = normalizeIngestContext(args("203.0.114.1"));

  assert.equal(first.visitorHash, sameSubnet.visitorHash, "only the last octet differs — must truncate to the same /24 bucket");
  assert.notEqual(first.visitorHash, differentSubnet.visitorHash, "the 3rd octet differs — must be a different bucket");
});

test("normalizeIngestContext buckets an IPv6 address to its first 3 groups before hashing: same prefix -> same hash, different prefix -> different hash", () => {
  const salt = makeSalt("2026-07-10");
  const args = (ip: string) => ({ input: { ip, userAgent: RAW_USER_AGENT, siteHost: "example.com" }, dailySalt: salt });

  const first = normalizeIngestContext(args("2001:db8:1234:aaaa:bbbb:cccc:dddd:eeee"));
  const samePrefix = normalizeIngestContext(args("2001:db8:1234:ffff:0:0:0:1"));
  const differentPrefix = normalizeIngestContext(args("2001:db8:5678:aaaa:bbbb:cccc:dddd:eeee"));

  assert.equal(first.visitorHash, samePrefix.visitorHash, "only groups after the first 3 differ — must truncate to the same bucket");
  assert.notEqual(first.visitorHash, differentPrefix.visitorHash, "the 3rd group differs — must be a different bucket");
});

test("normalizeIngestContext falls back to a fixed bucket for an unrecognized IP shape (neither IPv4 nor IPv6)", () => {
  const salt = makeSalt("2026-07-10");
  const args = (ip: string) => ({ input: { ip, userAgent: RAW_USER_AGENT, siteHost: "example.com" }, dailySalt: salt });

  const first = normalizeIngestContext(args("not-an-ip"));
  const second = normalizeIngestContext(args("also-not-an-ip"));

  assert.equal(first.visitorHash, second.visitorHash, 'every unrecognized IP shape must collapse to the same "unknown" bucket');
});

test("normalizeIngestContext never places the raw ip or user-agent on its return value", () => {
  const salt = makeSalt("2026-07-10");
  const normalized = normalizeIngestContext({
    input: { ip: RAW_IP, userAgent: RAW_USER_AGENT, siteHost: "example.com" },
    dailySalt: salt,
  });

  const serialized = JSON.stringify(normalized);
  assert.equal(serialized.includes(RAW_IP), false);
  assert.equal(serialized.includes(RAW_USER_AGENT), false);
  assert.equal(Object.keys(normalized).includes("ip"), false);
  assert.equal(Object.keys(normalized).includes("userAgent"), false);
});

test("normalizeIngestContext classifies a bot user agent", () => {
  const salt = makeSalt("2026-07-10");
  const normalized = normalizeIngestContext({
    input: {
      ip: RAW_IP,
      userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      siteHost: "example.com",
    },
    dailySalt: salt,
  });
  assert.equal(normalized.deviceClass, "bot");
});

test("normalizeIngestContext classifies a non-Apple tablet user agent", () => {
  const salt = makeSalt("2026-07-10");
  const normalized = normalizeIngestContext({
    input: {
      ip: RAW_IP,
      userAgent: "Mozilla/5.0 (PlayBook; U; RIM Tablet OS 2.1.0; en-US) AppleWebKit/536.2+ (KHTML, like Gecko) Version/7.2.1.0 Safari/536.2+",
      siteHost: "example.com",
    },
    dailySalt: salt,
  });
  assert.equal(normalized.deviceClass, "tablet");
});

test("normalizeIngestContext classifies osFamily 'ios' for a user agent naming iphone/ipad without also matching the macos pattern", () => {
  const salt = makeSalt("2026-07-10");
  const normalized = normalizeIngestContext({
    input: { ip: RAW_IP, userAgent: "Mozilla/5.0 (iPhone) ExampleMobileApp/1.0", siteHost: "example.com" },
    dailySalt: salt,
  });
  assert.equal(normalized.osFamily, "ios");
  assert.equal(normalized.deviceClass, "mobile");
});

const REAL_IPHONE_SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const REAL_IPAD_SAFARI_UA =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const REAL_MACOS_SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const REAL_IOS_CHROME_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1";

const REAL_IOS_FIREFOX_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/126.2 Mobile/15E148 Safari/605.1.15";

test("normalizeIngestContext classifies osFamily 'ios' (not 'macos') for a REAL iPhone Safari user agent, despite it containing the literal substring 'like Mac OS X'", () => {
  const salt = makeSalt("2026-07-10");
  const normalized = normalizeIngestContext({
    input: { ip: RAW_IP, userAgent: REAL_IPHONE_SAFARI_UA, siteHost: "example.com" },
    dailySalt: salt,
  });
  assert.equal(normalized.osFamily, "ios");
  assert.equal(normalized.deviceClass, "mobile");
});

test("normalizeIngestContext classifies osFamily 'ios' (not 'macos') for a REAL iPad Safari user agent, despite it containing the literal substring 'like Mac OS X'", () => {
  const salt = makeSalt("2026-07-10");
  const normalized = normalizeIngestContext({
    input: { ip: RAW_IP, userAgent: REAL_IPAD_SAFARI_UA, siteHost: "example.com" },
    dailySalt: salt,
  });
  assert.equal(normalized.osFamily, "ios");
  assert.equal(normalized.deviceClass, "tablet");
});

test("normalizeIngestContext still classifies osFamily 'macos' for a REAL macOS Safari user agent (proves the iOS fix did not invert the bug onto real desktop Mac traffic)", () => {
  const salt = makeSalt("2026-07-10");
  const normalized = normalizeIngestContext({
    input: { ip: RAW_IP, userAgent: REAL_MACOS_SAFARI_UA, siteHost: "example.com" },
    dailySalt: salt,
  });
  assert.equal(normalized.osFamily, "macos");
  assert.equal(normalized.deviceClass, "desktop");
});

test("normalizeIngestContext classifies a modern default-mode iPad (sending a Mac-identical UA) as osFamily 'macos'/deviceClass 'desktop' -- documented limit, not fixable from the UA string alone", () => {
  const salt = makeSalt("2026-07-10");
  const normalized = normalizeIngestContext({
    input: { ip: RAW_IP, userAgent: REAL_MACOS_SAFARI_UA, siteHost: "example.com" },
    dailySalt: salt,
  });
  assert.equal(normalized.osFamily, "macos");
  assert.equal(normalized.deviceClass, "desktop");
});

test("normalizeIngestContext classifies browserFamily 'chrome' (not 'safari') for a REAL iOS Chrome (CriOS) user agent", () => {
  const salt = makeSalt("2026-07-10");
  const normalized = normalizeIngestContext({
    input: { ip: RAW_IP, userAgent: REAL_IOS_CHROME_UA, siteHost: "example.com" },
    dailySalt: salt,
  });
  assert.equal(normalized.browserFamily, "chrome");
});

test("normalizeIngestContext classifies browserFamily 'firefox' (not 'safari') for a REAL iOS Firefox (FxiOS) user agent", () => {
  const salt = makeSalt("2026-07-10");
  const normalized = normalizeIngestContext({
    input: { ip: RAW_IP, userAgent: REAL_IOS_FIREFOX_UA, siteHost: "example.com" },
    dailySalt: salt,
  });
  assert.equal(normalized.browserFamily, "firefox");
});

test("normalizeIngestContext still classifies browserFamily 'safari' for a REAL iOS Safari user agent (proves the CriOS/FxiOS fix did not invert onto real iOS Safari traffic)", () => {
  const salt = makeSalt("2026-07-10");
  const normalized = normalizeIngestContext({
    input: { ip: RAW_IP, userAgent: REAL_IPHONE_SAFARI_UA, siteHost: "example.com" },
    dailySalt: salt,
  });
  assert.equal(normalized.browserFamily, "safari");
});

test("normalizeIngestContext classifies a mobile Android user agent", () => {
  const salt = makeSalt("2026-07-10");
  const normalized = normalizeIngestContext({
    input: {
      ip: RAW_IP,
      userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/115.0 Mobile Safari/537.36",
      siteHost: "example.com",
    },
    dailySalt: salt,
  });
  assert.equal(normalized.deviceClass, "mobile");
  assert.equal(normalized.osFamily, "android");
});

test("normalizeIngestContext classifies an empty user agent as unknown/null across device, browser, and os", () => {
  const salt = makeSalt("2026-07-10");
  const normalized = normalizeIngestContext({
    input: { ip: RAW_IP, userAgent: "", siteHost: "example.com" },
    dailySalt: salt,
  });
  assert.equal(normalized.deviceClass, "unknown");
  assert.equal(normalized.browserFamily, null);
  assert.equal(normalized.osFamily, null);
});

test("normalizeIngestContext falls back to an empty user agent when userAgent is nullish at the runtime boundary (defensive against untrusted network input, despite the string type)", () => {
  const salt = makeSalt("2026-07-10");
  const normalized = normalizeIngestContext({
    input: { ip: RAW_IP, userAgent: null as unknown as string, siteHost: "example.com" },
    dailySalt: salt,
  });
  assert.equal(normalized.deviceClass, "unknown");
  assert.equal(normalized.browserFamily, null);
  assert.equal(normalized.osFamily, null);
});

test("normalizeIngestContext classifies an Edge user agent as 'edge' even though 'Chrome/' and 'Safari/' also appear in it", () => {
  const salt = makeSalt("2026-07-10");
  const normalized = normalizeIngestContext({
    input: {
      ip: RAW_IP,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 Edg/116.0.1938.62",
      siteHost: "example.com",
    },
    dailySalt: salt,
  });
  assert.equal(normalized.browserFamily, "edge");
});

test("normalizeIngestContext classifies a Firefox-on-Linux user agent as browser 'firefox' and os 'linux'", () => {
  const salt = makeSalt("2026-07-10");
  const normalized = normalizeIngestContext({
    input: {
      ip: RAW_IP,
      userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:118.0) Gecko/20100101 Firefox/118.0",
      siteHost: "example.com",
    },
    dailySalt: salt,
  });
  assert.equal(normalized.browserFamily, "firefox");
  assert.equal(normalized.osFamily, "linux");
  assert.equal(normalized.deviceClass, "desktop");
});

test("normalizeIngestContext classifies a Safari-on-macOS user agent as browser 'safari' (not 'chrome') and os 'macos'", () => {
  const salt = makeSalt("2026-07-10");
  const normalized = normalizeIngestContext({
    input: {
      ip: RAW_IP,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      siteHost: "example.com",
    },
    dailySalt: salt,
  });
  assert.equal(normalized.browserFamily, "safari");
  assert.equal(normalized.osFamily, "macos");
});

test("normalizeIngestContext falls back to browser/os 'other' for a user agent matching none of the known families", () => {
  const salt = makeSalt("2026-07-10");
  const normalized = normalizeIngestContext({
    input: { ip: RAW_IP, userAgent: "SomeInternalClient/1.0", siteHost: "example.com" },
    dailySalt: salt,
  });
  assert.equal(normalized.browserFamily, "other");
  assert.equal(normalized.osFamily, "other");
  assert.equal(normalized.deviceClass, "desktop");
});

test("normalizeIngestContext buckets the SAME IPv6 address identically whether written in '::'-shorthand or fully expanded", () => {
  const salt = makeSalt("2026-07-10");
  const args = (ip: string) => ({ input: { ip, userAgent: RAW_USER_AGENT, siteHost: "example.com" }, dailySalt: salt });
  const hashOf = (ip: string) => normalizeIngestContext(args(ip)).visitorHash;

  assert.equal(
    hashOf("::1"),
    hashOf("0:0:0:0:0:0:0:1"),
    "'::1' and '0:0:0:0:0:0:0:1' are the same address and must bucket identically"
  );

  assert.equal(
    hashOf("::"),
    hashOf("0:0:0:0:0:0:0:0"),
    "'::' and '0:0:0:0:0:0:0:0' are the same address and must bucket identically"
  );

  assert.equal(
    hashOf("::a:b:c"),
    hashOf("0:0:0:0:0:a:b:c"),
    "a leading '::' and its fully-expanded form are the same address and must bucket identically"
  );

  assert.equal(
    hashOf("a:b:c::"),
    hashOf("a:b:c:0:0:0:0:0"),
    "a trailing '::' and its fully-expanded form are the same address and must bucket identically"
  );

  assert.equal(
    hashOf("2001:db8::1"),
    hashOf("2001:db8:0:0:0:0:0:1"),
    "an embedded '::' and its fully-expanded form are the same address and must bucket identically"
  );

  assert.notEqual(
    hashOf("2001:db8::1"),
    hashOf("2001:db8:1::"),
    "'2001:db8::1' and '2001:db8:1::' are different addresses (the zero-run is in a different " +
      "position) and must bucket differently"
  );
});

test("normalizeIngestContext buckets an IPv4-mapped IPv6 address ('::ffff:a.b.c.d') the SAME as its bare IPv4 /24, not into one shared garbage bucket", () => {
  const salt = makeSalt("2026-07-10");
  const args = (ip: string) => ({ input: { ip, userAgent: RAW_USER_AGENT, siteHost: "example.com" }, dailySalt: salt });
  const hashOf = (ip: string) => normalizeIngestContext(args(ip)).visitorHash;

  assert.equal(
    hashOf("::ffff:192.168.1.1"),
    hashOf("192.168.1.1"),
    "an IPv4-mapped IPv6 address must bucket identically to its bare IPv4 form (same /24)"
  );
  assert.equal(
    hashOf("::ffff:192.168.1.99"),
    hashOf("192.168.1.1"),
    "only the last octet differs (same /24 as the mapped form above) -- must be the same bucket"
  );
  assert.notEqual(
    hashOf("::ffff:203.0.113.77"),
    hashOf("192.168.1.1"),
    "a DIFFERENT IPv4-mapped address in a different /24 must NOT collapse into the same bucket " +
      "(this is exactly the bug: every mapped address used to collapse together)"
  );
  assert.notEqual(
    hashOf("::ffff:8.8.8.8"),
    hashOf("::ffff:203.0.113.77"),
    "two more distinct IPv4-mapped addresses, from the exact set the bug report used, must not " +
      "share a bucket"
  );
});

test("normalizeIngestContext strips brackets from a bracketed IPv6 address ('[::1]') and buckets it identically to the unbracketed form, instead of producing a garbage bucket", () => {
  const salt = makeSalt("2026-07-10");
  const args = (ip: string) => ({ input: { ip, userAgent: RAW_USER_AGENT, siteHost: "example.com" }, dailySalt: salt });
  const hashOf = (ip: string) => normalizeIngestContext(args(ip)).visitorHash;

  assert.equal(
    hashOf("[::1]"),
    hashOf("::1"),
    "'[::1]' must bucket identically to its unbracketed form, not a distinct '[:0:0::' garbage bucket"
  );
});

test("validateEventProps passes through clean properties", () => {
  const props: JsonObject = { plan: "pro", clicks: 3 };
  assert.deepEqual(validateEventProps({ props: props, privacyPolicy: POLICY }), props);
});

test("validateEventProps returns null when no properties are supplied", () => {
  assert.equal(validateEventProps({ props: null, privacyPolicy: POLICY }), null);
  assert.equal(validateEventProps({ props: undefined, privacyPolicy: POLICY }), null);
});

test("validateEventProps rejects an email-shaped value", () => {
  assert.throws(
    () => validateEventProps({ props: { contact: "someone@example.com" }, privacyPolicy: POLICY }),
    AnalyticsPiiRejectedError
  );
});

test("validateEventProps rejects a PII-suggestive key name", () => {
  assert.throws(() => validateEventProps({ props: { email: "not-actually-an-email" }, privacyPolicy: POLICY }), AnalyticsPiiRejectedError);
  for (const key of ["phone", "ssn", "socialSecurity", "social-security", "social_security", "password", "creditCard", "credit-card", "credit_card", "streetAddress", "street-address", "street_address", "fullName", "full-name", "full_name", "firstName", "first-name", "first_name", "lastName", "last-name", "last_name"]) {
    assert.throws(() => validateEventProps({ props: { [key]: "redacted" }, privacyPolicy: POLICY }), AnalyticsPiiRejectedError, key);
  }
});

test("validateEventProps rejects a property bag over the key-count bound", () => {
  const tooMany: JsonObject = {};
  for (let i = 0; i < 25; i += 1) tooMany[`k${i}`] = i;
  assert.throws(() => validateEventProps({ props: tooMany, privacyPolicy: POLICY }), AnalyticsPiiRejectedError);
  const atLimit = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]));
  assert.deepEqual(validateEventProps({ props: atLimit, privacyPolicy: POLICY }), atLimit);
  assert.throws(() => validateEventProps({ props: { ...atLimit, k20: 20 }, privacyPolicy: POLICY }), AnalyticsPiiRejectedError);
});

test("validateEventProps rejects an over-length string value", () => {
  assert.deepEqual(validateEventProps({ props: { note: "x".repeat(200) }, privacyPolicy: POLICY }), { note: "x".repeat(200) });
  assert.throws(() => validateEventProps({ props: { note: "x".repeat(201) }, privacyPolicy: POLICY }), AnalyticsPiiRejectedError);
  assert.throws(
    () => validateEventProps({ props: { note: "x".repeat(500) }, privacyPolicy: POLICY }),
    AnalyticsPiiRejectedError
  );
});

test("validateEventProps rejects PII in nested objects and arrays", () => {
  for (const props of [{ meta: { contact: "a@b.com" } }, { tags: ["a@b.com"] }, { meta: { phone: 123 } }] as JsonObject[]) {
    assert.throws(() => validateEventProps({ props: props, privacyPolicy: POLICY }), AnalyticsPiiRejectedError);
  }
  const clean = { meta: { plan: "pro" }, tags: ["docs", "hero"] };
  assert.deepEqual(validateEventProps({ props: clean, privacyPolicy: POLICY }), clean);
});

function makeConfig(overrides: Partial<AnalyticsSiteConfig> = {}): AnalyticsSiteConfig {
  return {
    workspaceId: "workspace-1",
    enabled: true,
    honorDoNotTrack: true,
    honorGlobalPrivacyControl: true,
    rawRetentionDays: 30,
    excludedPaths: ["/admin/*"],
    excludedIpRanges: ["10.0.0.0/24"],
    sink: "local",
    ...overrides,
  };
}

function makeConfigPort(config: AnalyticsSiteConfig): AnalyticsConfigPort {
  return {
    async get() {
      return config;
    },
  };
}

function makeBeacon(overrides: Partial<IngestBeacon> = {}): IngestBeacon {
  return {
    host: "example.com",
    path: "/blog/hello-world",
    referrer: "https://google.com/search?q=hello",
    kind: "pageview",
    ...overrides,
  };
}

function makeContext(overrides: Partial<IngestContext> = {}): IngestContext {
  return {
    ip: RAW_IP,
    userAgent: RAW_USER_AGENT,
    acceptLanguage: "en-US",
    receivedAt: "2026-07-10T12:00:00.000Z",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<IngestHitDeps> & IngestHitOptional = {}): { deps: IngestHitDeps & IngestHitOptional; sink: LocalBufferSink } {
  const sink = new LocalBufferSink({});
  const deps: IngestHitDeps & IngestHitOptional = {
    sink,
    config: makeConfigPort(makeConfig()),
    resolveWorkspaceForHost: async ({ host }: { host: string }) => (host === "example.com" ? "workspace-1" : null),
    rootKeySeed: ROOT_KEY_SEED, saltContext: SALT_CONTEXT, privacyPolicy: POLICY,
    ...overrides,
  };
  return { deps, sink };
}

test("ingestHit accepts a clean hit and hands a PII-free NormalizedHit to the sink", async () => {
  const { deps, sink } = makeDeps();

  const result = await ingestHit({
    input: { beacon: makeBeacon(), context: makeContext() },
    deps,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.reason, undefined);

  const stored = sink.all({});
  assert.equal(stored.length, 1);
  const hit = stored[0]!;
  assert.equal(hit.workspaceId, "workspace-1");
  assert.equal(hit.path, "/blog/hello-world");
  assert.equal(hit.referrerHost, "google.com");
  assert.equal(hit.deviceClass, "desktop");
  assert.equal(hit.browserFamily, "chrome");
  assert.equal(typeof hit.visitorHash, "string");
  assert.equal(hit.visitorHash.length, 64); // sha256 hex digest
  assert.equal(typeof hit.sessionId, "string");
});

test("ingestHit never lets the raw ip or user-agent reach the stored NormalizedHit", async () => {
  const { deps, sink } = makeDeps();

  await ingestHit({
    input: { beacon: makeBeacon(), context: makeContext() },
    deps,
  });

  const hit = sink.all({})[0]!;
  const serialized = JSON.stringify(hit);

  assert.equal(serialized.includes(RAW_IP), false);
  assert.equal(serialized.includes(RAW_USER_AGENT), false);
  assert.equal(Object.prototype.hasOwnProperty.call(hit, "ip"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(hit, "userAgent"), false);
});

test("ingestHit sessions are stable within a window and separate across windows and visitors", async () => {
  const { deps, sink } = makeDeps();
  for (const context of [
    makeContext(),
    makeContext({ receivedAt: "2026-07-10T12:29:59.999Z" }),
    makeContext({ receivedAt: "2026-07-10T12:30:00.000Z" }),
    makeContext({ ip: "203.0.114.77" }),
  ]) {
    assert.deepEqual(await ingestHit({ input: { beacon: makeBeacon(), context }, deps }), { accepted: true });
  }
  const hits = sink.all({});
  assert.equal(hits.length, 4);
  assert.equal(hits[0]!.sessionId, hits[1]!.sessionId);
  assert.notEqual(hits[0]!.sessionId, hits[2]!.sessionId);
  assert.notEqual(hits[0]!.sessionId, hits[3]!.sessionId);
});

test("ingestHit produces a different visitorHash on a different UTC day (salt rotation end-to-end)", async () => {
  const { deps: depsDay1, sink: sinkDay1 } = makeDeps();
  const { deps: depsDay2, sink: sinkDay2 } = makeDeps();

  await ingestHit({ input: { beacon: makeBeacon(), context: makeContext() }, deps: depsDay1 });
  await ingestHit({
    input: {
      beacon: makeBeacon(),
      context: makeContext({ receivedAt: "2026-07-11T12:00:00.000Z" }),
    },
    deps: depsDay2,
  });

  const hashDay1 = sinkDay1.all({})[0]!.visitorHash;
  const hashDay2 = sinkDay2.all({})[0]!.visitorHash;
  assert.notEqual(hashDay1, hashDay2);
});

test("ingestHit drops a hit for an unresolvable workspace host", async () => {
  const { deps, sink } = makeDeps({ resolveWorkspaceForHost: async () => null });

  const result = await ingestHit({
    input: { beacon: makeBeacon(), context: makeContext() },
    deps,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "workspace_unresolved");
  assert.equal(sink.all({}).length, 0);
});

test("ingestHit drops a hit when the site has analytics disabled", async () => {
  const { deps, sink } = makeDeps({ config: makeConfigPort(makeConfig({ enabled: false })) });

  const result = await ingestHit({
    input: { beacon: makeBeacon(), context: makeContext() },
    deps,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "analytics_disabled");
  assert.equal(sink.all({}).length, 0);
});

test("ingestHit honors Do-Not-Track", async () => {
  const { deps, sink } = makeDeps();

  const result = await ingestHit({
    input: { beacon: makeBeacon({ dnt: true }), context: makeContext() },
    deps,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "dnt");
  assert.equal(sink.all({}).length, 0);
});

test("ingestHit honors Global Privacy Control", async () => {
  const { deps, sink } = makeDeps();

  const result = await ingestHit({
    input: { beacon: makeBeacon({ gpc: true }), context: makeContext() },
    deps,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "gpc");
  assert.equal(sink.all({}).length, 0);
});

test("ingestHit drops a hit for an excluded path", async () => {
  const { deps, sink } = makeDeps();

  const result = await ingestHit({
    input: { beacon: makeBeacon({ path: "/admin/dashboard" }), context: makeContext() },
    deps,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "excluded_path");
  assert.equal(sink.all({}).length, 0);
});

test("ingestHit applies DNT and GPC independently according to operator settings", async () => {
  for (const [config, beacon, expected] of [
    [{ honorDoNotTrack: false }, { dnt: true }, { accepted: true }],
    [{ honorGlobalPrivacyControl: false }, { gpc: true }, { accepted: true }],
    [{ honorDoNotTrack: false }, { gpc: true }, { accepted: false, reason: "gpc" }],
    [{ honorGlobalPrivacyControl: false }, { dnt: true }, { accepted: false, reason: "dnt" }],
  ] as const) {
    const { deps, sink } = makeDeps({ config: makeConfigPort(makeConfig(config)) });
    assert.deepEqual(await ingestHit({ input: { beacon: makeBeacon(beacon), context: makeContext() }, deps }), expected);
    assert.equal(sink.all({}).length, expected.accepted ? 1 : 0);
  }
});

test("ingestHit drops a hit for an excluded IP range (CIDR)", async () => {
  const { deps, sink } = makeDeps();

  const result = await ingestHit({
    input: { beacon: makeBeacon(), context: makeContext({ ip: "10.0.0.42" }) },
    deps,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "excluded_ip");
  assert.equal(sink.all({}).length, 0);
});

test("ingestHit rejects PII-shaped custom event properties", async () => {
  const { deps, sink } = makeDeps();

  const result = await ingestHit({
    input: {
      beacon: makeBeacon({
        kind: "event",
        eventName: "signup",
        eventProps: { email: "someone@example.com" },
      }),
      context: makeContext(),
    },
    deps,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "pii_rejected");
  assert.equal(sink.all({}).length, 0);
});

test("ingestHit stores the transformed result of beforeIngest", async () => {
  let transformed: import("../types.js").NormalizedHit | undefined;
  const { deps, sink } = makeDeps({ hooks: { beforeIngest: async ({ hit }) => {
    transformed = { ...hit, path: "/redacted", referrerHost: null };
    return transformed;
  } } });
  assert.deepEqual(await ingestHit({ input: { beacon: makeBeacon(), context: makeContext() }, deps }), { accepted: true });
  assert.deepEqual(sink.all({}), [transformed]);
});

test("ingestHit respects CIDR boundaries for /16, /20, /24 and /32", async () => {
  for (const [range, inside, outside] of [
    ["10.0.0.0/16", "10.0.255.9", "10.1.0.0"],
    ["10.0.16.0/20", "10.0.31.255", "10.0.32.0"],
    ["10.0.0.0/24", "10.0.0.255", "10.0.1.1"],
    ["10.0.0.1/32", "10.0.0.1", "10.0.0.2"],
  ] as const) {
    const { deps, sink } = makeDeps({ config: makeConfigPort(makeConfig({ excludedIpRanges: [range] })) });
    assert.deepEqual(await ingestHit({ input: { beacon: makeBeacon(), context: makeContext({ ip: inside }) }, deps }), { accepted: false, reason: "excluded_ip" }, range);
    assert.deepEqual(await ingestHit({ input: { beacon: makeBeacon(), context: makeContext({ ip: outside }) }, deps }), { accepted: true }, range);
    assert.equal(sink.all({}).length, 1);
  }
});

test("ingestHit lets a beforeIngest hook drop a hit", async () => {
  const { deps, sink } = makeDeps({ hooks: { beforeIngest: async () => null } });

  const result = await ingestHit({
    input: { beacon: makeBeacon(), context: makeContext() },
    deps,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "dropped_by_hook");
  assert.equal(sink.all({}).length, 0);
});

test("ingestHit accepts and stores the hit a beforeIngest hook returns unchanged (hook present but does not drop it)", async () => {
  let hookCalled = false;
  const { deps, sink } = makeDeps({
    hooks: {
      beforeIngest: async ({ hit }) => {
        hookCalled = true;
        return hit;
      },
    },
  });

  const result = await ingestHit({
    input: { beacon: makeBeacon(), context: makeContext() },
    deps,
  });

  assert.equal(hookCalled, true);
  assert.equal(result.accepted, true);
  assert.equal(sink.all({}).length, 1);
});

test("ingestHit excludes a path via an exact (non-wildcard) excludedPaths entry", async () => {
  const { deps, sink } = makeDeps({ config: makeConfigPort(makeConfig({ excludedPaths: ["/secret"] })) });

  const excluded = await ingestHit({
    input: { beacon: makeBeacon({ path: "/secret" }), context: makeContext() },
    deps,
  });
  assert.equal(excluded.accepted, false);
  assert.equal(excluded.reason, "excluded_path");

  const notExcluded = await ingestHit({
    input: { beacon: makeBeacon({ path: "/blog/hello-world" }), context: makeContext() },
    deps,
  });
  assert.equal(notExcluded.accepted, true);
  assert.equal(sink.all({}).length, 1);
});

test("ingestHit excludes an IP via an exact (non-CIDR) excludedIpRanges entry", async () => {
  const { deps, sink } = makeDeps({ config: makeConfigPort(makeConfig({ excludedIpRanges: ["203.0.113.99"] })) });

  const excluded = await ingestHit({
    input: { beacon: makeBeacon(), context: makeContext({ ip: "203.0.113.99" }) },
    deps,
  });
  assert.equal(excluded.accepted, false);
  assert.equal(excluded.reason, "excluded_ip");

  const notExcluded = await ingestHit({
    input: { beacon: makeBeacon(), context: makeContext({ ip: "203.0.113.1" }) },
    deps,
  });
  assert.equal(notExcluded.accepted, true);
  assert.equal(sink.all({}).length, 1);
});

test("ingestHit does not exclude an IPv6 address against an IPv4 CIDR excludedIpRanges entry (mismatched families)", async () => {
  const { deps, sink } = makeDeps({ config: makeConfigPort(makeConfig({ excludedIpRanges: ["10.0.0.0/24"] })) });

  const result = await ingestHit({
    input: { beacon: makeBeacon(), context: makeContext({ ip: "::1" }) },
    deps,
  });

  assert.equal(result.accepted, true);
  assert.equal(sink.all({}).length, 1);
});

for (const range of ["10.0.0.0/24", "10.0.0.42"]) {
  test(`ingestHit excludes IPv4-mapped socket addresses against ${range}`, async () => {
    const { deps, sink } = makeDeps({ config: makeConfigPort(makeConfig({ excludedIpRanges: [range] })) });
    assert.deepEqual(await ingestHit({ input: { beacon: makeBeacon(), context: makeContext({ ip: "::ffff:10.0.0.42" }) }, deps }), { accepted: false, reason: "excluded_ip" });
    assert.equal(sink.all({}).length, 0);
  });
}

test("ingestHit does not exclude an IP against an excludedIpRanges CIDR entry whose range address is IPv6", async () => {
  const { deps, sink } = makeDeps({ config: makeConfigPort(makeConfig({ excludedIpRanges: ["::1/64"] })) });

  const result = await ingestHit({
    input: { beacon: makeBeacon(), context: makeContext({ ip: "203.0.113.1" }) },
    deps,
  });

  assert.equal(result.accepted, true);
  assert.equal(sink.all({}).length, 1);
});

test("ingestHit does not exclude an IP against an excludedIpRanges CIDR entry with a non-numeric prefix", async () => {
  const { deps, sink } = makeDeps({ config: makeConfigPort(makeConfig({ excludedIpRanges: ["10.0.0.0/not-a-number"] })) });

  const result = await ingestHit({
    input: { beacon: makeBeacon(), context: makeContext({ ip: "10.0.0.1" }) },
    deps,
  });

  assert.equal(result.accepted, true);
  assert.equal(sink.all({}).length, 1);
});

test("ingestHit does not exclude an IP when the request IP has the wrong number of octets to compare against a CIDR range", async () => {
  const { deps, sink } = makeDeps({ config: makeConfigPort(makeConfig({ excludedIpRanges: ["10.0.0.0/24"] })) });

  const result = await ingestHit({
    input: { beacon: makeBeacon(), context: makeContext({ ip: "10.0.0" }) },
    deps,
  });

  assert.equal(result.accepted, true);
  assert.equal(sink.all({}).length, 1);
});

test("ingestHit does not exclude an IP with an out-of-range octet (e.g. 999) against a CIDR range", async () => {
  const { deps, sink } = makeDeps({ config: makeConfigPort(makeConfig({ excludedIpRanges: ["10.0.0.0/24"] })) });

  const result = await ingestHit({
    input: { beacon: makeBeacon(), context: makeContext({ ip: "999.0.0.1" }) },
    deps,
  });

  assert.equal(result.accepted, true);
  assert.equal(sink.all({}).length, 1);
});

test("ingestHit does not exclude an IP with a negative octet against a CIDR range", async () => {
  const { deps, sink } = makeDeps({ config: makeConfigPort(makeConfig({ excludedIpRanges: ["10.0.0.0/24"] })) });

  const result = await ingestHit({
    input: { beacon: makeBeacon(), context: makeContext({ ip: "1.2.3.-1" }) },
    deps,
  });

  assert.equal(result.accepted, true);
  assert.equal(sink.all({}).length, 1);
});

test("ingestHit does not exclude an IP with a non-numeric octet against a CIDR range", async () => {
  const { deps, sink } = makeDeps({ config: makeConfigPort(makeConfig({ excludedIpRanges: ["10.0.0.0/24"] })) });

  const result = await ingestHit({
    input: { beacon: makeBeacon(), context: makeContext({ ip: "1.2.3.abc" }) },
    deps,
  });

  assert.equal(result.accepted, true);
  assert.equal(sink.all({}).length, 1);
});

test("ingestHit records a null referrerHost when the beacon has no referrer", async () => {
  const { deps, sink } = makeDeps();

  const result = await ingestHit({
    input: { beacon: makeBeacon({ referrer: null }), context: makeContext() },
    deps,
  });

  assert.equal(result.accepted, true);
  assert.equal(sink.all({})[0]!.referrerHost, null);
});

test("ingestHit records a null referrerHost when the referrer is not a parseable URL", async () => {
  const { deps, sink } = makeDeps();

  const result = await ingestHit({
    input: { beacon: makeBeacon({ referrer: "not a valid url" }), context: makeContext() },
    deps,
  });

  assert.equal(result.accepted, true);
  assert.equal(sink.all({})[0]!.referrerHost, null);
});

test("ingestHit records a null referrerHost when the referrer URL parses but has no hostname (e.g. a file: URL)", async () => {
  const { deps, sink } = makeDeps();

  const result = await ingestHit({
    input: { beacon: makeBeacon({ referrer: "file:///path/to/file" }), context: makeContext() },
    deps,
  });

  assert.equal(result.accepted, true);
  assert.equal(sink.all({})[0]!.referrerHost, null);
});

test("ingestHit extracts allowlisted UTM params from a query string present on beacon.path", async () => {
  const { deps, sink } = makeDeps();

  const result = await ingestHit({
    input: {
      beacon: makeBeacon({
        path: "/blog/hello-world?utm_source=newsletter&utm_medium=email&utm_campaign=launch&utm_term=example&utm_content=header&token=private-token&email=alice@example.com#private-fragment",
      }),
      context: makeContext(),
    },
    deps,
  });

  assert.equal(result.accepted, true);
  const hit = sink.all({})[0]!;
  assert.deepEqual(hit.utm, {
    source: "newsletter",
    medium: "email",
    campaign: "launch",
    term: "example",
    content: "header",
  });
  assert.equal(hit.path, "/blog/hello-world");
  assert.equal(JSON.stringify(hit).includes("private-token"), false);
  assert.equal(JSON.stringify(hit).includes("alice@example.com"), false);
  assert.equal(JSON.stringify(hit).includes("private-fragment"), false);
});

test("ingestHit does not exclude an IP against a CIDR excludedIpRanges entry whose range address itself has an invalid octet", async () => {
  const { deps, sink } = makeDeps({ config: makeConfigPort(makeConfig({ excludedIpRanges: ["999.0.0.0/24"] })) });

  const result = await ingestHit({
    input: { beacon: makeBeacon(), context: makeContext({ ip: "203.0.113.1" }) },
    deps,
  });

  assert.equal(result.accepted, true);
  assert.equal(sink.all({}).length, 1);
});

test("ingestHit excludes every IP against a CIDR excludedIpRanges entry with a /0 prefix (zero-bit mask matches everything)", async () => {
  const { deps, sink } = makeDeps({ config: makeConfigPort(makeConfig({ excludedIpRanges: ["10.0.0.0/0"] })) });

  const result = await ingestHit({
    input: { beacon: makeBeacon(), context: makeContext({ ip: "203.0.113.1" }) },
    deps,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "excluded_ip");
  assert.equal(sink.all({}).length, 0);
});

test("ingestHit rethrows a genuinely unexpected error raised while reading event properties, instead of treating it as a policy pii_rejected outcome", async () => {
  const { deps } = makeDeps();

  const boom = new RangeError("boom: unexpected failure reading a property value");
  const eventProps = {
    get weirdGetter(): string {
      throw boom;
    },
  } as unknown as JsonObject;

  await assert.rejects(
    () =>
      ingestHit({
        input: {
          beacon: makeBeacon({ kind: "event", eventName: "signup", eventProps }),
          context: makeContext(),
        },
        deps,
      }),
    (err: unknown) => err === boom
  );
});
