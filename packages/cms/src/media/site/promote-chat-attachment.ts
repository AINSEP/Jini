import { toolMetadata } from '@jini-ai/core/tool-metadata/media';
/**
 * @file The chat-attachment -> media-library bridge: `media_promote_chat_attachment`, closing the
 * capability gap a host handoff note diagnosed — `media_upload_asset`
 * (`@jini-ai/cms/media`) only ever accepted `dataBase64`, and nothing bridged a file the chat
 * composer had already uploaded (`@jini-ai/daemon/http`'s `AttachmentStore`) into it.
 *
 * ## Design: delegate to `media_upload_asset`'s own handler, don't re-implement it
 *
 * This module resolves an attachment reference to real bytes and a sniffed content type, then calls
 * the ALREADY-REGISTERED `media_upload_asset` `ToolHandler` directly with a synthesized
 * `{filename, contentType, dataBase64}` input — the exact same code path a model's own
 * `media_upload_asset` call takes, including its `requireToolPermission` check, `uploadMedia()`
 * validation/rendition gate, and the `recordUploadContentType`/`resolvePublicUrls` hooks
 * (`features/media/tool-registrations.ts`'s host media registrations builder). Nothing about that
 * gate is duplicated here — `__tests__/promote-chat-attachment.test.ts` proves this by asserting the
 * SAME sniffed-content-type-recording behavior `tool-registrations.test.ts` polices for
 * `media_upload_asset` itself, reached through this bridge instead.
 *
 * `contentType` is never taken from the caller (the model): it is sniffed from the real bytes via
 * `@jini-ai/cms/media`'s `sniffContentType` — the same function `buildRecordUploadContentType`
 * already uses for the AFTER-upload recording step. `media_upload_asset` itself still validates a
 * caller-DECLARED `contentType` against an advisory allowlist (see that tool's own catalog doc);
 * supplying the real, sniffed value here closes that trust gap for this path specifically, rather
 * than trusting a model's (or an attacker's) guess at what the bytes are.
 *
 * ## Why the reference is an id OR a path, not only an id
 *
 * `@jini-ai/daemon`'s `image-prompt-delivery.ts` narrates an already-claimed attachment into the
 * run's prompt text by its REAL ABSOLUTE PATH, never by the opaque `attachment:<uuid>` capability id
 * the original upload response carried (that id reaches only the composer's own client state, never
 * the model). A same-turn "attach this and add it to my library" ask is therefore the common case
 * where the model has the path but was never given the id at all. `AttachmentStore.resolveForRun`
 * (`@jini-ai/daemon/http`) accepts either form and resolves both through the store's own record —
 * never a bare `fs.readFile` of a caller-asserted path. A path/id the store never issued or claimed
 * resolves to `undefined`, exactly like an unrecognized id; this bridge never reads a path the store
 * itself did not already vouch for.
 *
 * ## Authorization
 *
 * `resolveForRun` refuses a reference already claimed by a DIFFERENT run (e.g. a different chat
 * session on this same site's daemon) — see that method's own doc. This bridge inherits that scoping
 * by always passing `ctx.run.id`, so one session can never promote another session's in-flight
 * attachment through this tool. It does NOT (and structurally cannot) reach across SITES: each site
 * runs its own daemon process with its own in-memory `AttachmentStore` (`agent-daemon-server.ts`'s
 * own workspace doc), so a reference minted on one site's daemon is not a key that exists in
 * another site's store at all.
 *
 * What this does NOT close: an attachment that was never claimed by any run yet (the common real
 * case an operator hits — see this file's own test suite header) has no run-ownership history at
 * all, so the FIRST `resolveForRun` call for it succeeds for whichever run asks first — the same
 * deliberate capability-bearer model `AttachmentStore.claim()` already documents for a first claim.
 * That is unchanged by this bridge, not introduced by it.
 */
import { ToolInputError, type ToolExecutionContext, type ToolHandler, type ToolRegistration } from "@jini-ai/core";
import { sniffContentType } from "../index.js";
import type { AttachmentStore } from "@jini-ai/core/contracts/site/daemon-http";

export const MEDIA_PROMOTE_CHAT_ATTACHMENT_TOOL_ID = "media_promote_chat_attachment";

/** The one `AttachmentStore` method this bridge needs — narrowed so a test double never has to fake the rest. */
export type ChatAttachmentLookup = Pick<AttachmentStore, "resolveForRun">;

/** The safe, non-disclosing message given for both "never heard of this ref" and "a different run
 *  owns it" — mirrors `resolveForRun`'s own non-disclosure contract (see that method's doc). */
function unknownAttachmentMessage({ ref }: { ref: string }, _optional: Record<string, never> = {}): string {
  return `attachment '${ref}' is unknown or already claimed by a different run`;
}

/**
 * Resolves `ref` (an `attachment:<uuid>` id, or the real path already named to this run) to its
 * bytes and original display name, scoped to `runId` by `AttachmentStore.resolveForRun`'s own
 * ownership check.
 *
 * @throws {ToolInputError} `ref` is unknown to the store, or belongs to a different run/session —
 * both surfaced identically (see `resolveForRun`'s own non-disclosure doc) and both are the CALLER's
 * mistake (a stale, wrong, or foreign reference), not a server fault, hence `ToolInputError` rather
 * than a bare rethrow: `ToolExecutor` reports a `ToolInputError` as a validation failure rather than
 * a redacted internal error.
 * @complexity O(1) plus one bounded file read (bounded by the attachment's own upload-time byte cap,
 * `AttachmentsHttpDeps.maxAttachmentBytes`) — never proportional to anything else caller-controlled.
 */
export async function resolveChatAttachmentBytes(
  { store, readFile, isAttachmentRejected, ref, runId }: {
    readonly store: ChatAttachmentLookup;
    readonly readFile: (required: { path: string }, optional?: Record<string, never>) => Promise<Uint8Array>;
    readonly isAttachmentRejected: (required: { error: unknown }) => boolean;
    readonly ref: string; readonly runId: string;
  }, _optional = {},
): Promise<{ readonly bytes: Uint8Array; readonly name: string }> {
  let resolved;
  try {
    resolved = await store.resolveForRun({ ref, runId });
  } catch (error) {
    // `AttachmentRejectedError` here can only be `'attachment-unknown-or-claimed'` (a different run's
    // claim) or `'attachment-integrity'` (the file changed since upload) — both caller-facing facts a
    // model can act on ("try again", "re-attach it"), and neither message leaks a filesystem path
    // (see `attachments.ts`'s own SEC-005 doc), so re-classifying as `ToolInputError` here is safe.
    if (isAttachmentRejected({ error })) throw new ToolInputError({ message: unknownAttachmentMessage({ ref }) });
    throw error;
  }
  if (!resolved) throw new ToolInputError({ message: unknownAttachmentMessage({ ref }) });
  const bytes = await readFile({ path: resolved.path });
  return { bytes, name: resolved.name };
}

/** Falls back to a non-empty placeholder — `media_upload_asset`'s own schema requires `filename`
 *  to be non-empty, and a stored attachment's `name` is normally already sanitized/non-empty
 *  (`sanitizeAttachmentName`'s own fallback), but this stays defensive rather than assuming that. */
function defaultFilename({ attachmentName }: { attachmentName: string }, _optional: Record<string, never> = {}): string {
  return attachmentName.length > 0 ? attachmentName : "attachment";
}

/**
 * `media_promote_chat_attachment`'s JSON Schema, published via `ToolDescriptor.inputSchema` —
 * mirrors `media_upload_asset`'s optional editorial fields (`alt`/`caption`/`credit`) but never
 * accepts `contentType`/`dataBase64`: this tool derives both itself (see this file's header).
 */
const INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["attachmentRef"],
  properties: {
    attachmentRef: {
      type: "string",
      minLength: 1,
      description:
        "The attachment to promote into the media library: either the 'attachment:<uuid>' id from an " +
        "upload response, or the real file path already given to you for an attachment in this conversation.",
    },
    filename: { type: "string", description: "Optional display filename override. Defaults to the attachment's original name." },
    alt: { type: "string", description: "Optional accessibility alt text." },
    caption: { type: "string", description: "Optional display caption." },
    credit: { type: "string", description: "Optional attribution/credit line." },
  },
} as const;

/** Reads and validates `attachmentRef` out of an otherwise-`unknown` tool input. */
function requireAttachmentRef({ input }: { input: unknown }, _optional: Record<string, never> = {}): string {
  const record = input as Record<string, unknown> | null | undefined;
  const ref = record?.attachmentRef;
  if (typeof ref !== "string" || ref.length === 0) {
    throw new ToolInputError({ message: "'attachmentRef' is required and must be a non-empty string" });
  }
  return ref;
}

/**
 * Builds the `media_promote_chat_attachment` `ToolRegistration` — registered directly in
 * `agent-daemon-server.ts` (the daemon-only composition root that owns the `AttachmentStore`), the
 * same way `frontendControl.toolRegistrations` are, rather than through the generic per-workspace
 * tool-contribution registry: this tool has no meaning outside a process that also runs an
 * `AttachmentStore`, exactly the reasoning `frontendControl`'s own registration site gives for its
 * own tools.
 *
 * @param deps.getStore Returns the live `AttachmentStore`, or `undefined` before daemon startup has
 * finished constructing it. A THUNK, not a value, for the same reason `agent-daemon-server.ts`'s own
 * `resolveAttachmentRunFields` closes over its module-scope `attachmentStore` binding rather than
 * capturing a value at registration time: this registration is built before that store exists.
 * @param deps.mediaUploadHandler The ALREADY-REGISTERED `media_upload_asset` handler — this bridge's
 * only route into `uploadMedia()`'s validation/rendition gate. See this file's header.
 * @param deps.readFile Injected for testability; production wiring passes a `({ path })` wrapper over `node:fs/promises#readFile`.
 */
export function buildPromoteChatAttachmentTool({ getStore, mediaUploadHandler, readFile, isAttachmentRejected, encodeBase64 }: {
  readonly getStore: () => ChatAttachmentLookup | undefined;
  readonly mediaUploadHandler: ToolHandler;
  readonly readFile: (required: { path: string }, optional?: Record<string, never>) => Promise<Uint8Array>;
  readonly isAttachmentRejected: (required: { error: unknown }) => boolean;
  readonly encodeBase64: (required: { bytes: Uint8Array }) => string;
}, _optional = {}): ToolRegistration {
  const handler: ToolHandler = async (ctx: ToolExecutionContext, optional = {}) => {
    const attachmentRef = requireAttachmentRef({ input: ctx.input });
    const store = getStore();
    if (!store) {
      // Structurally unreachable once the daemon has finished starting — see `agent-daemon-server.ts`'s
      // own `attachmentStore` doc for why this is still handled rather than asserted non-null.
      throw new Error("attachment store is not ready");
    }
    const { bytes, name } = await resolveChatAttachmentBytes({ store, readFile, isAttachmentRejected, ref: attachmentRef, runId: ctx.run.id });
    const input = ctx.input as Record<string, unknown>;
    const uploadInput: Record<string, unknown> = {
      filename: typeof input.filename === "string" && input.filename.length > 0 ? input.filename : defaultFilename({ attachmentName: name }),
      // Sniffed, never the caller's — see this file's header ("Design").
      contentType: sniffContentType({ bytes }),
      dataBase64: encodeBase64({ bytes }),
    };
    if (typeof input.alt === "string") uploadInput.alt = input.alt;
    if (typeof input.caption === "string") uploadInput.caption = input.caption;
    if (typeof input.credit === "string") uploadInput.credit = input.credit;
    // Same context and optional transport ports, only `input` replaced — this is
    // what makes `media_upload_asset`'s own permission check and gate apply unmodified. See this
    // file's header.
    return mediaUploadHandler({ ...ctx, input: uploadInput }, optional);
  };

  return {
    descriptor: {
      id: MEDIA_PROMOTE_CHAT_ATTACHMENT_TOOL_ID,
      metadata: toolMetadata[MEDIA_PROMOTE_CHAT_ATTACHMENT_TOOL_ID],
      description:
        "Promotes a file the user already attached in this chat into the permanent media library, without " +
        "needing its bytes re-sent as base64. Use this instead of media_upload_asset when the file in " +
        "question is something the user attached to the conversation (an 'attachment:<uuid>' id, or a path " +
        "already named to you for an attachment) rather than bytes you are holding yourself.",
      inputSchema: INPUT_SCHEMA,
    },
    handler,
    // Pass-through `allow` — ADR-021 §2, same as every other the host registration built outside the
    // `@jini-ai/cms` domain machinery (`createFrontendControl`'s own registrations use the identical
    // `{ authorize: () => "allow" }`, `agent-daemon-server.ts`). The real authorization decision is
    // `media_upload_asset`'s own `requireToolPermission(..., "media.upload", ...)` check, run inside
    // `deps.mediaUploadHandler` against `ctx.principal` — the SAME principal this handler receives
    // unchanged, so nothing here can grant a caller a permission `media_upload_asset` itself would refuse.
    policy: { authorize: () => "allow" },
  };
}
