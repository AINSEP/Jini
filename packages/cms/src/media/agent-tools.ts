/**
 * @file The Media agent-tool catalog (ADR-027) — this domain's instance of the per-domain
 * `agent-tools.ts` convention Forms/Identity already use.
 *
 * Purpose:
 * A static, in-process catalog describing every agent-callable tool this domain exposes and the
 * permission each carries. Every entry maps 1:1 onto a real exported function of
 * `media/media-service.ts` — this catalog never names an operation the domain cannot perform.
 *
 * Deliberate absences (the point of a catalog, not an oversight):
 * - There is NO `media_purge_asset`. `purgeMedia` is a HARD delete: it removes the `MediaRecord`
 *   row permanently and triggers the blob-GC tombstone pass (`tombstoneBlobIfUnreferenced`,
 *   `blob-gc.ts`) that can eventually reclaim the underlying bytes. It is gated behind
 *   `media.delete.force` — a separate, narrower permission a human admin UI itself treats as a
 *   distinct escalation tier from ordinary `media.delete` (mirrors `admin.menus.delete` vs
 *   `admin.menus.delete.force`). An assistant is reachable by prompt injection through ordinary
 *   operator content (a comment, a form submission) in a way a human clicking the admin "purge"
 *   button is not, so an irreversible, storage-reclaiming delete is left human-UI-only — the same
 *   discipline `identity/agent-tools.ts` applies to `resetUserPassword`.
 * - There is NO named-transform-registry tool (`registerTransform`, `media/transform-registry.ts`).
 *   No admin HTTP route needs to expose it at all — it is a core-declared, boot-time/operational
 *   concept, not a human admin-UI operation. Wrapping it here would invent agent capability beyond
 *   what a host's admin surface itself exposes, which this catalog's own discipline forbids.
 *
 * How it relates to a host:
 * A host's tool-registration layer maps these entries into `ToolRegistration`s (see
 * `tool-registrations.ts`). Unlike Forms/Identity, `media-service.ts`'s functions perform NO
 * internal `authorize()` call of their own (confirmed: none of `UploadMediaDeps`/
 * `UpdateMediaMetadataDeps`/`TrashMediaDeps` carry an `authorize` field) — a host's admin HTTP
 * routes check authorization inline, before calling the service function. `tool-registrations.ts`
 * therefore performs that SAME inline authorize check itself (the identical permission string and
 * `entityType: "media"` a host route would use) rather than relying on a domain-layer gate that
 * does not exist for this library — a disclosed, deliberate divergence from the Forms/Identity/
 * content-types pass-through-`ToolPolicy` reasoning, not an oversight.
 *
 * Architectural role:
 * `media` domain declaration. Imports only the constants its own domain already enforces
 * (`DEFAULT_MAX_UPLOAD_BYTES`/`DEFAULT_ALLOWED_MIME_TYPES` from `media-service.ts`), so the
 * published JSON Schemas cannot drift from the validators.
 */

import { DEFAULT_ALLOWED_MIME_TYPES, DEFAULT_MAX_UPLOAD_BYTES } from "./media-service.js";

export type AgentToolSideEffect = "none" | "mutates-durable-state" | "mints-token";

export type AgentToolActorClassRule = "confirmer-must-equal-own-delegatedBy" | "user-only" | "none";

export interface AgentToolDefinition {
  name: string;
  description: string;
  sideEffects: AgentToolSideEffect;
  authorization: { permission: string };
  actorClassRule?: AgentToolActorClassRule;
  /**
   * JSON Schema for this tool's `input`, published to the model via `ToolDescriptor.inputSchema`
   * (a host's tool-registration layer refuses to wire any tool lacking one).
   */
  inputSchema?: Readonly<Record<string, unknown>>;
}

const MEDIA_ID_SCHEMA = {
  type: "string",
  description: "The media asset's id, as returned by media_upload_asset or media_list_assets.",
} as const;

/**
 * The Media domain's fixed agent-tool catalog — the 4 operations a host's admin HTTP surface
 * exposes that are safe to wrap, out of its 5 total (see file header for why `purge` is excluded).
 *
 * Ordered read-first, matching `identity/agent-tools.ts`'s convention: a model needs a `mediaId`
 * before it can update or trash an asset, and `media_list_assets` is the only way to learn one for
 * an existing asset (there is no dedicated get-by-id admin route to wrap instead).
 */
export const mediaAgentToolCatalog: AgentToolDefinition[] = [
  {
    name: "media_list_assets",
    description:
      "Lists every media asset in the workspace (all statuses — active and trashed), with id, title, alt, caption, credit, sha256, and status. Read-only. Call this to find a mediaId before updating or trashing an asset.",
    sideEffects: "none",
    authorization: { permission: "media.read" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {},
    },
  },
  {
    name: "media_upload_asset",
    description:
      `Uploads a new media asset from base64-encoded bytes. Rejects a content type outside the allowed set ` +
      `(${[...DEFAULT_ALLOWED_MIME_TYPES].join(", ")} — SVG is never accepted, even here: it requires a sanitizer ` +
      `this build does not have) or a file over ${DEFAULT_MAX_UPLOAD_BYTES} bytes. Uploading the same bytes twice ` +
      `always creates two separate library entries (the underlying blob is deduplicated, but each upload is its own asset).`,
    sideEffects: "mutates-durable-state",
    authorization: { permission: "media.upload" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["filename", "contentType", "dataBase64"],
      properties: {
        filename: { type: "string", minLength: 1, description: "Original filename. Its extension-stripped stem becomes the asset's initial title." },
        contentType: {
          type: "string",
          enum: [...DEFAULT_ALLOWED_MIME_TYPES],
          description: "The exact MIME type of the uploaded bytes. Only this fixed set is accepted.",
        },
        dataBase64: {
          type: "string",
          minLength: 1,
          description: `The file's bytes, base64-encoded. Decoded size must be over 0 and at most ${DEFAULT_MAX_UPLOAD_BYTES} bytes.`,
        },
        alt: { type: "string", description: "Optional accessibility alt text." },
        caption: { type: "string", description: "Optional display caption." },
        credit: { type: "string", description: "Optional attribution/credit line." },
      },
    },
  },
  {
    name: "media_update_metadata",
    description:
      "Updates a media asset's editorial metadata (title/alt/caption/credit only). The asset's underlying bytes " +
      "(sha256) are write-once and cannot be changed by this or any tool — to replace the file itself, upload a new asset.",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "media.update" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["mediaId"],
      properties: {
        mediaId: MEDIA_ID_SCHEMA,
        title: { type: "string", description: "New display title. Omit to leave unchanged; an empty/whitespace value is ignored (the existing title is kept)." },
        alt: { type: "string", description: "New alt text. Omit to leave unchanged." },
        caption: { type: "string", description: "New caption. Omit to leave unchanged." },
        credit: { type: "string", description: "New credit line. Omit to leave unchanged." },
      },
    },
  },
  {
    name: "media_trash_asset",
    description:
      "Soft-deletes (trashes) a media asset — the first, reversible-in-principle step of the deletion ladder. " +
      "Idempotent: trashing an already-trashed asset is a no-op. This is the ONLY delete-adjacent tool in this " +
      "catalog; there is no purge/force-delete tool (see this file's header for why).",
    sideEffects: "mutates-durable-state",
    authorization: { permission: "media.delete" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["mediaId"],
      properties: { mediaId: MEDIA_ID_SCHEMA },
    },
  },
];
