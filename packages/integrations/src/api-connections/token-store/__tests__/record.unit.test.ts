/** @file Unit tests for the pure vault-row codec: every malformed metadata, token set and payload
 * shape is refused with `invalid-record` before a token can leave the store. Malformed inputs are
 * deliberately untyped values (`unknown`), which is what a corrupted or hostile row looks like. */
import { describe, expect, it } from "vitest";
import { OAuthTokenStoreError } from "../errors.js";
import { buildRecordMeta, buildTokenPayload, parseOAuthTokenVaultMeta, parseTokenPayload, parseTokenSet, readRecordMeta,
  readReplaceableGeneration } from "../record.js";
import { KEY, OWNER, tokenSet } from "./fixtures.js";

const META = { credentialFormat: "oauth-token-set", status: "active", leaseHolder: null, leaseExpiresAtMs: null };

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof OAuthTokenStoreError) return error.code;
    throw error;
  }
  throw new Error("expected an OAuthTokenStoreError");
}

describe("record metadata", () => {
  it("round-trips a leased row's metadata through the vault parser", () => {
    const meta = { status: "reconnect-required", leaseHolder: "holder-1", leaseExpiresAtMs: 1_700 } as const;
    expect(parseOAuthTokenVaultMeta({ meta: buildRecordMeta({ meta }) })).toEqual({ ...meta, credentialFormat: "oauth-token-set" });
  });

  it("refuses metadata that is not marked as an OAuth token record", () => {
    expect(codeOf(() => readRecordMeta({ meta: { ...META, credentialFormat: "vendor" } }))).toBe("invalid-record");
  });

  it("refuses metadata that is not an object", () => {
    expect(codeOf(() => parseOAuthTokenVaultMeta({ meta: ["credentialFormat"] }))).toBe("invalid-record");
  });

  it("refuses an unknown status", () => {
    expect(codeOf(() => readRecordMeta({ meta: { ...META, status: "connected" } }))).toBe("invalid-record");
  });

  it("refuses a lease holder that is not a string", () => {
    expect(codeOf(() => readRecordMeta({ meta: { ...META, leaseHolder: 7 } }))).toBe("invalid-record");
  });

  it("refuses a lease expiry that is not a safe integer", () => {
    expect(codeOf(() => readRecordMeta({ meta: { ...META, leaseExpiresAtMs: 1.5 } }))).toBe("invalid-record");
  });
});

describe("token sets", () => {
  it("returns a copy whose scope list is not shared with the input", () => {
    const input = tokenSet({ label: "one" });
    const parsed = parseTokenSet({ value: input });
    expect([parsed, parsed.scopes === input.scopes]).toEqual([input, false]);
  });

  it("accepts a token set without refresh token or expiry", () => {
    const input = { ...tokenSet({ label: "one" }), refreshToken: null, expiresAt: null };
    expect(parseTokenSet({ value: input })).toEqual(input);
  });

  it("refuses a value that is not an object", () => {
    expect(codeOf(() => parseTokenSet({ value: "access-token" }))).toBe("invalid-record");
  });

  it("refuses an empty access token", () => {
    expect(codeOf(() => parseTokenSet({ value: { ...tokenSet({ label: "one" }), accessToken: "" } }))).toBe("invalid-record");
  });

  it("refuses a refresh token that is neither a string nor null", () => {
    expect(codeOf(() => parseTokenSet({ value: { ...tokenSet({ label: "one" }), refreshToken: 42 } }))).toBe("invalid-record");
  });

  it("refuses a missing token type", () => {
    expect(codeOf(() => parseTokenSet({ value: { ...tokenSet({ label: "one" }), tokenType: undefined } }))).toBe("invalid-record");
  });

  it("refuses scopes that are not a list of strings", () => {
    expect(codeOf(() => parseTokenSet({ value: { ...tokenSet({ label: "one" }), scopes: ["ok", 3] } }))).toBe("invalid-record");
  });

  it("refuses an expiry that is neither a string nor null", () => {
    expect(codeOf(() => parseTokenSet({ value: { ...tokenSet({ label: "one" }), expiresAt: 0 } }))).toBe("invalid-record");
  });
});

describe("sealed payloads", () => {
  const payload = () => buildTokenPayload({ key: KEY, owner: OWNER, generation: 3, tokens: tokenSet({ label: "one" }) });

  it("opens a payload sealed for the same key and owner", () => {
    expect(parseTokenPayload({ payload: payload(), key: KEY, owner: OWNER })).toEqual({ generation: 3, tokens: tokenSet({ label: "one" }) });
  });

  it("opens a payload whose tokens were cleared", () => {
    const cleared = buildTokenPayload({ key: KEY, owner: OWNER, generation: 3, tokens: null });
    expect(parseTokenPayload({ payload: cleared, key: KEY, owner: OWNER })).toEqual({ generation: 3, tokens: null });
  });

  it("refuses a payload of another format version", () => {
    expect(codeOf(() => parseTokenPayload({ payload: { ...payload(), version: 2 }, key: KEY, owner: OWNER }))).toBe("invalid-record");
  });

  it("refuses a payload whose generation is not a safe integer", () => {
    expect(codeOf(() => parseTokenPayload({ payload: { ...payload(), generation: "3" }, key: KEY, owner: OWNER }))).toBe("invalid-record");
  });

  it("refuses an owner object carrying an extra id", () => {
    const widened = { ...payload(), owner: { ...OWNER, principalId: "someone" } };
    expect(codeOf(() => parseTokenPayload({ payload: widened, key: KEY, owner: OWNER }))).toBe("owner-mismatch");
  });

  it("reports a malformed payload as replaceable (null generation) instead of refusing the install", () => {
    expect(readReplaceableGeneration({ payload: { ...payload(), generation: null }, key: KEY, owner: OWNER })).toBeNull();
  });

  it("reports the generation of a row sealed for another client id of the same connection", () => {
    const otherClient = buildTokenPayload({ key: KEY, owner: { ...OWNER, clientId: "client-2" }, generation: 4, tokens: null });
    expect(readReplaceableGeneration({ payload: otherClient, key: KEY, owner: OWNER })).toBe(4);
  });
});
