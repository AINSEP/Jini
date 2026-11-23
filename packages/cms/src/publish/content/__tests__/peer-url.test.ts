import { describe, expect, it } from "vitest";
import { hasForbiddenRawUrlCharacter } from "@jini-ai/core/contracts/server/verified-origin";
import { normalizePeerBaseUrl, peerHostname, peerUrl } from "../peer-url.js";

describe("peer base URL", () => {
  it("normalizes case, a trailing dot and repeated trailing slashes, keeping a path prefix", () => {
    expect(normalizePeerBaseUrl({ raw: "https://Site.Example.COM./", hasForbiddenRawUrlCharacter })).toEqual({ baseUrl: "https://site.example.com" });
    expect(normalizePeerBaseUrl({ raw: "https://site.example.com:8443/base///", hasForbiddenRawUrlCharacter })).toEqual({ baseUrl: "https://site.example.com:8443/base" });
  });

  it("refuses credentials, a query and a fragment", () => {
    expect("baseUrl" in normalizePeerBaseUrl({ raw: "https://user:pass@site.example.com", hasForbiddenRawUrlCharacter })).toBe(false);
    expect("baseUrl" in normalizePeerBaseUrl({ raw: "https://site.example.com?a=1", hasForbiddenRawUrlCharacter })).toBe(false);
    expect("baseUrl" in normalizePeerBaseUrl({ raw: "https://site.example.com#x", hasForbiddenRawUrlCharacter })).toBe(false);
  });

  it("joins an API path under the prefix and reads the hostname", () => {
    expect(peerUrl({ baseUrl: "https://site.example.com/base", path: "/api/admin/v1/x" })).toBe("https://site.example.com/base/api/admin/v1/x");
    expect(peerHostname({ baseUrl: "https://site.example.com:8443/base" })).toBe("site.example.com");
  });

  it("refuses through the host-bound raw-character validator, keeping the refusal text", () => {
    const seen: string[] = [];
    const refuseAll = ({ raw }: { raw: string }) => { seen.push(raw); return true; };
    expect(normalizePeerBaseUrl({ raw: " https://site.example.com ", hasForbiddenRawUrlCharacter: refuseAll })).toEqual({ error: "baseUrl carries a backslash, whitespace or control character" });
    expect(seen).toEqual(["https://site.example.com"]);
    expect(normalizePeerBaseUrl({ raw: "https://site.example.com", hasForbiddenRawUrlCharacter: () => false })).toEqual({ baseUrl: "https://site.example.com" });
  });
});
