import type { AgentToolDefinition as SharedAgentToolDefinition } from "@jini-ai/core";
import type { AgentToolSideEffect } from "@jini-ai/core";

/**
 * @file Agent-tool catalog for media generation — closes the "I cannot generate images, as this
 * site does not have an AI image generation tool configured" gap a production transcript surfaced
 * (the assistant found `media_upload_asset`/`content_post_create` via `search_tools` five times over
 * and never found a generation tool, because none existed). The engine this tool wraps (the
 * multi-vendor media-providers dispatch engine) already existed and had no host caller — this
 * catalog is the first caller.
 *
 * ONE tool, `media_generate_asset`. Provider-agnostic as of the 2026-09-02 follow-up dispatch: the
 * first landed slice was OpenAI-only, which turned out to be unusable on machines with no OpenAI
 * credential and a different vendor's key instead (this one has `GEMINI_API_KEY`, no
 * `OPENAI_API_KEY`) — see the host media-generation `tool-registrations.ts`'s module doc for the
 * credential-resolution half of that fix. This file's half: `model` now accepts one id from every
 * vendor the catalogue itself marks real (the host passes the catalogue's `IMAGE_MODEL_IDS` as
 * `imageModelIds`), not a fixed 3-entry OpenAI literal.
 *
 * Architectural role: media-generation domain declaration — no dependency on any other feature
 * module. The image-model id list is reference data the host injects through
 * {@link buildMediaGenerationAgentToolCatalog}'s args (the media-providers catalogue is not a
 * dependency of this package), so this file stays a standalone domain declaration.
 */

/** Shared catalog contract with this domain's side-effect vocabulary. */
export type AgentToolDefinition = SharedAgentToolDefinition & { sideEffects: AgentToolSideEffect };

// The `model` enum is `IMAGE_MODEL_IDS` from the media-providers catalog (vendors marked integrated, in
// catalogue order). It replaced this file's old `OPENAI_IMAGE_MODELS`, a fixed 3-entry literal that made
// every non-OpenAI vendor (including a machine's only configured one, Nano Banana / `nanobanana`)
// unreachable through this tool no matter what credential existed.

const generateSchema = (imageModelIds: readonly string[]) => ({
  type: "object",
  additionalProperties: false,
  required: ["prompt"],
  properties: {
    prompt: {
      type: "string",
      minLength: 1,
      description: "A text description of the image to generate. Be specific and detailed — the vendor generates from this text alone, with no other context.",
    },
    model: {
      type: "string",
      enum: [...imageModelIds],
      description:
        "Which image model to use — picking a model also picks its vendor; there is no separate provider field. " +
        "When omitted, the model saved with a vendor's credential is used; otherwise the first model in this list whose vendor has a credential configured; if no vendor " +
        "has one, the call fails and says so. Which " +
        "ones actually work depends on which vendor has a credential configured for this workspace (Admin -> Media " +
        "-> 'Media providers') or set as an environment variable on this install — an unconfigured vendor fails " +
        "with a clear message rather than silently substituting a different one.",
    },
    allowStubFallback: {
      type: "boolean",
      description:
        "Opt-in escape hatch, default false. When true, and the selected model's vendor has no real integration " +
        "wired up in this build yet (a small remainder of the catalog the engine itself decides, not a fixed list " +
        "here), a deterministic PLACEHOLDER image is returned instead of failing outright, and the returned " +
        "media's `placeholder` field is set to true. Never used silently when this is false/omitted — a vendor " +
        "with no real integration fails with a clear error instead. Does NOT paper over a missing/invalid " +
        "credential for a vendor that DOES have a real integration — that still fails with a normal error either way.",
    },
    alt: { type: "string", description: "Optional accessibility alt text for the uploaded asset." },
    caption: { type: "string", description: "Optional display caption for the uploaded asset." },
    credit: { type: "string", description: "Optional attribution/credit line for the uploaded asset." },
  },
}) as const;

/**
 * This domain's agent-tool catalog; `model`'s enum is whatever image models the caller's catalogue holds.
 *
 * @complexity O(m) in `imageModelIds`.
 */
export function buildMediaGenerationAgentToolCatalog({ imageModelIds, mediaAssetReadToolId }: { imageModelIds: readonly string[]; /** The host's read tool id for one media asset, named in the result description. */ mediaAssetReadToolId: string }, _optional: Record<string, never> = {}): AgentToolDefinition[] {
  return [
    {
      name: "media_generate_asset",
      description:
        "THIS IS HOW TO GENERATE A NEW IMAGE FROM A TEXT PROMPT — the assistant's own image generator, not a saved custom credential and not a raw API call. Call this whenever asked to create, generate, draw, design, or make an image (a logo, a hero banner, an illustration, a placeholder photo, ...) rather than uploading an existing file. Generates one image from `prompt` using whichever vendor the `model` field selects (see that field's own description — every registered vendor is supported, not just OpenAI), then uploads the result into the media library exactly like media_upload_asset would — the returned `media` object (id, title, alt, caption, credit, sha256, status, version, publicUrl, placeholder) is the SAME shape media_upload_asset/" + mediaAssetReadToolId + " return plus one extra field: `placeholder` is true only on the rare deterministic-stub fallback (see the `allowStubFallback` field), false for a real generation. Beside `media` the result carries `model` (the exact image model id used) and `provider` (the vendor id that actually ran it, e.g. openai) — always tell the user which model and vendor made the image (or, when `placeholder` is true, that no model drew it and it is a stand-in). The same `id` can immediately be used with media_update_metadata/media_trash_asset, and `publicUrl` (when present) is a real URL usable to embed the image in a post/page right away. Credentials are resolved per-vendor: a saved one from Admin -> Media -> 'Media providers' first, an environment variable second. A vendor with neither configured fails with a clear message pointing at the Media providers tab rather than a raw API error — call credential_save with kind media-provider in this turn, then retry the original generation exactly once after the key is saved. Costs real money per call for a real (non-placeholder) generation — do not call speculatively or in a loop; generate once per request unless explicitly asked to try again.",
      sideEffects: "mutates-durable-state",
      authorization: { permission: "media.upload" },
      inputSchema: generateSchema(imageModelIds),
    },
  ];
}
