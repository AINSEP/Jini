import { describe, expect, it } from "vitest";
import { createMediaAccessEvidence } from "../access-evidence.js";

const pending = () => ({ expiresAt: Date.now() + 60_000, value: new Promise<never>(() => {}) });

describe("media access evidence instances", () => {
  it("two instances do not share state: the same repository objects get independent caches", () => {
    const a = createMediaAccessEvidence();
    const b = createMediaAccessEvidence();
    const postRepo = {};
    const entryRepo = {};
    const cacheA = a.getCache({ postRepo, entryRepo });
    const cacheB = b.getCache({ postRepo, entryRepo });
    expect(cacheA).not.toBe(cacheB);
    cacheA.set("w", pending());
    cacheB.set("w", pending());
    b.invalidate({ owner: postRepo });
    expect(cacheB.size).toBe(0);
    expect(cacheA.size).toBe(1);
    a.invalidate({ owner: entryRepo });
    expect(cacheA.size).toBe(0);
  });

  it("an instance returns the same cache for the same post repository and clears it from either owner", () => {
    const evidence = createMediaAccessEvidence();
    const postRepo = {};
    const entryRepo = {};
    const cache = evidence.getCache({ postRepo, entryRepo });
    expect(evidence.getCache({ postRepo })).toBe(cache);
    cache.set("w", pending());
    evidence.invalidate({ owner: postRepo });
    expect(cache.size).toBe(0);
    cache.set("w", pending());
    evidence.invalidate({ owner: entryRepo });
    expect(cache.size).toBe(0);
    cache.set("w", pending());
    evidence.invalidate({ owner: {} });
    expect(cache.size).toBe(1);
  });
});
