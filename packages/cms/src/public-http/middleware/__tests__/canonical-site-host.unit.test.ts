import { expect, test } from "vitest";
import type { VerifiedOrigin } from "@jini-ai/core/contracts/server/verified-origin";
import { canonicalSiteHostRedirectLocation, isCanonicalSiteHostCandidate } from "../canonical-site-host.js";

const toAbsoluteUrl = ({ origin, path }: { origin: VerifiedOrigin; path: string }) => `${origin.scheme}://${origin.host}${path}`;
const canonical: VerifiedOrigin = { scheme: "https", host: "example.test", source: "workspace-setting", verifiedAt: "2026-10-24T00:00:00Z" };

test("only GET/HEAD page requests with an origin-form target are candidates", () => {
  expect(isCanonicalSiteHostCandidate({ method: "GET", path: "/about", originalUrl: "/about?x=1" })).toBe(true);
  expect(isCanonicalSiteHostCandidate({ method: "POST", path: "/about", originalUrl: "/about" })).toBe(false);
  expect(isCanonicalSiteHostCandidate({ method: "GET", path: "/HealthZ", originalUrl: "/HealthZ" })).toBe(false);
  expect(isCanonicalSiteHostCandidate({ method: "GET", path: "/x", originalUrl: "http://evil/x" })).toBe(false);
});

test("the www alias redirects onto the canonical origin; other hosts, dev seeds and missing config do not", () => {
  const at = (host: string, origin: VerifiedOrigin | undefined) => canonicalSiteHostRedirectLocation({ host, originalUrl: "//evil/x", origin, toAbsoluteUrl });
  expect(at("WWW.example.test", canonical)).toBe("https://example.test//evil/x");
  expect(at("other.test", canonical)).toBeUndefined();
  expect(at("www.example.test", undefined)).toBeUndefined();
  expect(at("www.example.test", { ...canonical, source: "dev-capability" })).toBeUndefined();
  expect(at("www.localhost", { ...canonical, host: "localhost" })).toBeUndefined();
});
