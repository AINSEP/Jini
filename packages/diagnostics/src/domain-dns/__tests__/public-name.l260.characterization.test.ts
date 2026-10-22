import { describe, expect, it } from "vitest";
import {
  createDomainDnsChecks,
  DomainDnsInputError,
  readPublicDnsName,
  readPublicDomain,
  type DomainDnsDependencies,
} from "../index.js";

const readers = [readPublicDomain, readPublicDnsName];
const errorMessage = "pin: pass a public DNS hostname such as 'example.com', without a URL, IP address, path, or port.";
const longestDomain = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;

describe("public name validation before L260 refactoring", () => {
  it.each([
    ["EXAMPLE.COM.", "example.com"],
    ["bücher.de", "xn--bcher-kva.de"],
    ["example。com", "example.com"],
    ["a.b", "a.b"],
    ["a-b.xn--p1ai", "a-b.xn--p1ai"],
    [longestDomain, longestDomain],
    [`${longestDomain}.`, longestDomain],
  ])("canonicalizes %s identically for hostnames and DNS owners", (value, expected) => {
    for (const read of readers) {
      expect(read({ value, errorPrefix: "pin" })).toBe(expected);
    }
  });

  it.each([
    undefined, null, 42, {}, [],
    "", ".", "example", "example.com..",
    " example.com", "example.com ",
    "a".repeat(255),
    `${"bücher.".repeat(20)}com`,
    "127.0.0.1", "2130706433",
    "a..com", "-bad.com", "bad-.com", `${"a".repeat(64)}.com`,
    "example.123", "example._com", "example.c_m",
    "example.local", "example.localhost", "example.internal",
    "example.invalid", "example.test", "EXAMPLE.ONION.",
  ].map(value => ({ value })))("refuses invalid or reserved input $value with the caller's error prefix", ({ value }) => {
    for (const read of readers) {
      expect(() => read({ value, errorPrefix: "pin" })).toThrowError(DomainDnsInputError);
      expect(() => read({ value, errorPrefix: "pin" })).toThrowError(errorMessage);
    }
  });

  it.each(["/", "\\", "?", "#", "@", ":", "%", "[", "]", " ", "\t", "\n"])(
    "refuses the separator %j before normalization",
    separator => {
      for (const read of readers) {
        expect(() => read({ value: `ex${separator}ample.com`, errorPrefix: "pin" }))
          .toThrowError(errorMessage);
      }
    },
  );

  it.each(["_acme-challenge.example.com", "selector._domainkey.example.com", "_.example.com", "end_.example.com"])(
    "allows underscore owner %s only in DNS lookup names",
    value => {
      expect(readPublicDnsName({ value: value.toUpperCase() + ".", errorPrefix: "pin" })).toBe(value);
      expect(() => readPublicDomain({ value, errorPrefix: "pin" })).toThrowError(errorMessage);
    },
  );

  it("accepts home.arpa names despite the public-name boundary (reported, not fixed)", () => {
    for (const read of readers) {
      expect(read({ value: "router.home.arpa", errorPrefix: "pin" })).toBe("router.home.arpa");
    }
  });

  it("refuses invalid names for every operation before any injected effect", async () => {
    const calls: string[] = [];
    const deps: DomainDnsDependencies = {
      authorize: async ({ operation }) => { calls.push(`authorize:${operation}`); },
      resolver: { query: async ({ domain, type }) => {
        calls.push(`query:${domain}:${type}`);
        return { type, status: "no-data", records: [] };
      } },
      listExpectedHosts: async () => { calls.push("hosts"); return []; },
      probeTls: async ({ domain }) => {
        calls.push(`tls:${domain}`);
        return { status: "unavailable", httpStatus: null };
      },
    };
    const checks = createDomainDnsChecks(deps);
    await expect(checks.lookupDns({ domain: "example.internal" })).rejects.toThrowError(DomainDnsInputError);
    await expect(checks.checkDns({ domain: "_acme-challenge.example.com" })).rejects.toThrowError(DomainDnsInputError);
    await expect(checks.checkDns({ domain: "example.com" }, { expectedHost: "host.local" })).rejects.toThrowError(DomainDnsInputError);
    await expect(checks.tlsStatus({ domain: "127.0.0.1" })).rejects.toThrowError(DomainDnsInputError);
    expect(calls).toEqual([]);
  });
});
