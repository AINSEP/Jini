import { describe, expect, it } from "vitest";
import * as core from "@jini-ai/core/net/public-dns-vocabulary";
import { DNS_TYPES, DomainDnsInputError, createDomainDnsChecks, readPublicDnsName, readPublicDomain } from "../index.js";

describe("domain-dns errors use the core class", () => {
  it("keeps one class identity and one implementation", () => {
    expect(DomainDnsInputError).toBe(core.DomainDnsInputError);
    expect(() => readPublicDomain({ value: "10.0.0.1", errorPrefix: "p" })).toThrow(core.DomainDnsInputError);
    expect(() => readPublicDnsName({ value: "https://example.com", errorPrefix: "p" })).toThrow(core.DomainDnsInputError);
    expect(DNS_TYPES).toBe(core.DNS_TYPES);
  });

  it("an invalid name thrown by the checks matches the core class", async () => {
    const checks = createDomainDnsChecks({ authorize: async () => {}, resolver: { query: async () => ({ type: "A", status: "not-found", records: [] }) }, listExpectedHosts: async () => [], probeTls: async () => ({ status: "unavailable", httpStatus: null }) });
    await expect(checks.lookupDns({ domain: "https://example.com" })).rejects.toBeInstanceOf(core.DomainDnsInputError);
  });
});
