import { describe, expect, it } from "vitest";
import { accessTokensCountText, envNamesFact, maskedTailFact, mediaProviderCatalogFrom, mediaProviderLabel, otherCredentialMatchesQuery, otherCredentialStoreInfo, type OtherCredentialStoreInfo } from "../other-credential-stores.js";

const store = (id: OtherCredentialStoreInfo["id"], label: string, purposeLabel: string): OtherCredentialStoreInfo =>
  ({ id, label, purposeLabel, category: "general", supportsReplace: false, screenLabel: `${label} screen`, screenPath: `/${id}` });
const stores = [store("site-assistant", "Assistant key", "Chat"), store("media-provider", "Media key", "Images")];

describe("store lookup and search", () => {
  it("finds the store by id and falls back to the first entry", () => {
    expect(otherCredentialStoreInfo({ id: "media-provider", stores })).toBe(stores[1]);
    expect(otherCredentialStoreInfo({ id: "external-mcp", stores })).toBe(stores[0]);
  });

  it("matches a trimmed, case-insensitive query on label, purpose or item name", () => {
    const s = stores[1]!;
    expect(otherCredentialMatchesQuery({ store: s, itemName: undefined, query: "   " })).toBe(true);
    expect(otherCredentialMatchesQuery({ store: s, itemName: undefined, query: " MEDIA " })).toBe(true);
    expect(otherCredentialMatchesQuery({ store: s, itemName: undefined, query: "imag" })).toBe(true);
    expect(otherCredentialMatchesQuery({ store: s, itemName: "Grok", query: "grok" })).toBe(true);
    expect(otherCredentialMatchesQuery({ store: s, itemName: "Grok", query: "zzz" })).toBe(false);
    expect(otherCredentialMatchesQuery({ store: s, itemName: undefined, query: "grok" })).toBe(false);
  });
});

describe("media provider catalog", () => {
  it("labels from the live catalog, else echoes the id", () => {
    const catalog = [{ id: "grok", label: "Grok" }];
    expect(mediaProviderLabel({ providerId: "grok", catalog })).toBe("Grok");
    expect(mediaProviderLabel({ providerId: "other", catalog })).toBe("other");
  });

  it("keeps only well-formed provider cards and tolerates missing bodies", () => {
    expect(mediaProviderCatalogFrom({ body: null })).toEqual([]);
    expect(mediaProviderCatalogFrom({ body: { providers: "x" } })).toEqual([]);
    expect(mediaProviderCatalogFrom({ body: { providers: [{ id: "a", label: "A" }, { id: 1, label: "B" }, { id: "c" }, null, { id: "d", label: "D", extra: 1 }] } }))
      .toEqual([{ id: "a", label: "A" }, { id: "d", label: "D", extra: 1 }]);
  });
});

describe("fact and count copy", () => {
  it("masks a tail and pluralizes env var counts through the translator", () => {
    expect(maskedTailFact({ tail: "9f2a" })).toBe("••••9f2a");
    expect(envNamesFact({ envNames: [] })).toBe("No environment variables set");
    expect(envNamesFact({ envNames: ["A"] })).toBe("1 environment variable set");
    expect(envNamesFact({ envNames: ["A", "B", "C"] }, { t: (k) => `[${k}]` })).toBe("[3 environment variables set]");
  });

  it("counts saved tokens and matches, inserting the query literally", () => {
    expect(accessTokensCountText({ totalCount: 1, matchCount: 1, query: "" })).toBe("1 token saved");
    expect(accessTokensCountText({ totalCount: 4, matchCount: 0, query: " " })).toBe("4 tokens saved");
    expect(accessTokensCountText({ totalCount: 1, matchCount: 1, query: "a" })).toBe("1 of 1 token matching “a”");
    expect(accessTokensCountText({ totalCount: 5, matchCount: 2, query: "$&x" }, { t: (k) => `fr:${k}` })).toBe("fr:2 of 5 tokens matching “$&x”");
  });
});
