import { describe, expect, it } from "vitest";

import { CONFIGURABLE_MEDIA_PROVIDER_CATALOG as MEDIA_PROVIDER_CATALOG } from "../configurable-catalog.js";

/**
 * @file `configurable-catalog.ts` — the adapter from the engine's real vendor catalogue to the
 * option shape `MediaProvidersTab` renders.
 *
 * The assertion that carries the weight: every id is ENGINE-CANONICAL. A credential stored under a
 * the starter catalogue's-spelled id would save fine and then never resolve at generation time, so the
 * spelling is pinned here rather than left to be noticed later.
 */

/** The exact divergences between the starter catalogue's's sample catalogue and the engine's own. */
const UI_SPELLINGS_THAT_MUST_NOT_APPEAR = [
  "xai-grok-imagine",
  "nano-banana",
  "fal-ai",
  "leonardo-ai",
  "custom-image-api",
  "volcengine-ark",
  "tavily-search",
];

describe("MEDIA_PROVIDER_CATALOG", () => {
  it("uses engine-canonical provider ids, never the UI catalogue's spellings", () => {
    const ids = MEDIA_PROVIDER_CATALOG.map((provider) => provider.id);
    for (const uiSpelling of UI_SPELLINGS_THAT_MUST_NOT_APPEAR) {
      expect(ids, `${uiSpelling} is the @jini-ai/ui spelling and must not be rendered`).not.toContain(uiSpelling);
    }
    for (const canonical of ["nanobanana", "fal", "leonardo", "custom-image", "volcengine", "tavily"]) {
      expect(ids, `${canonical} is the engine spelling and must be present`).toContain(canonical);
    }
  });

  it("carries the real roster, not the small curated sample", () => {
    // The UI sample ships 15; the engine catalogue is materially larger, minus the two exclusions.
    expect(MEDIA_PROVIDER_CATALOG.length).toBeGreaterThan(15);
    expect(MEDIA_PROVIDER_CATALOG.map((provider) => provider.id).sort()).toEqual([
      "openai", "volcengine", "nanobanana", "imagerouter", "openrouter", "custom-image",
      "comfyui", "bfl", "fal", "leonardo", "replicate", "google", "kling", "midjourney", "minimax",
      "suno", "udio", "elevenlabs", "fishaudio", "senseaudio", "aihubmix", "tavily",
    ].sort());
  });

  it("excludes the vendors that cannot take a credential", () => {
    const ids = MEDIA_PROVIDER_CATALOG.map((provider) => provider.id);
    // `hyperframes` is `settingsVisible: false` (a local CLI renderer); `stub` is the test placeholder.
    expect(ids).not.toContain("hyperframes");
    expect(ids).not.toContain("stub");
  });

  it("keeps not-yet-integrated vendors, which are real services with real keys", () => {
    const ids = MEDIA_PROVIDER_CATALOG.map((provider) => provider.id);
    expect(ids).toContain("bfl");
    expect(ids).toContain("replicate");
  });

  it("gives every entry a label and no duplicate ids", () => {
    const ids = MEDIA_PROVIDER_CATALOG.map((provider) => provider.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const provider of MEDIA_PROVIDER_CATALOG) {
      expect(provider.label.length).toBeGreaterThan(0);
    }
  });

  it("de-duplicates a provider's models across surfaces", () => {
    // OpenAI advertises both image and audio models; neither surface may disappear.
    const openai = MEDIA_PROVIDER_CATALOG.find((provider) => provider.id === "openai");
    expect(openai?.models).toEqual([
      "gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini", "dall-e-3", "dall-e-2",
      "gpt-4o-mini-tts",
    ]);
    for (const provider of MEDIA_PROVIDER_CATALOG) {
      if (!provider.models) continue;
      expect(new Set(provider.models).size, `${provider.id} has duplicate models`).toBe(provider.models.length);
    }
  });

  it("attaches the vendor's real default base URL", () => {
    const openai = MEDIA_PROVIDER_CATALOG.find((provider) => provider.id === "openai");
    expect(openai?.defaultBaseUrl).toBe("https://api.openai.com/v1");
  });
});
