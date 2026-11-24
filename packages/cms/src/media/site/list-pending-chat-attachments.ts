import { toolMetadata } from '@jini-ai/core/tool-metadata/media';
/**
 * @file `chat_list_pending_attachments` — lets the assistant discover a chat attachment it was never
 * told about in this run: the discovery half of the bridge `promote-chat-attachment.ts` completes
 * (see that file's own header for the capability gap both close together).
 *
 * ## The gap this closes
 *
 * `media_promote_chat_attachment` takes an attachmentRef. Discovery originally supplied missing
 * refs from earlier turns by listing all pending uploads for an owner. That exposed unrelated
 * conversations during the 2026-10-06 live test. Discovery now supplies refs only for this accepted
 * message; actual image delivery is independent and uses byte-bearing content at run start.
 *
 * ## Scoping — the actual security decision here
 *
 * `AttachmentStore.listPendingForOwner` (`@jini-ai/daemon/http`) only returns records carrying an
 * `ownerId` that matches the id passed in. With this run's id it includes unclaimed records and
 * records claimed by this run: startup claims all message attachments before tools execute, so
 * unclaimed-only discovery would hide images, videos and generic files alike. This tool always
 * passes `ctx.principal.id` — the SAME host admin-session identity `agent-daemon-server.ts` decodes
 * from a run's `contextRef` (`parseRunStartContextRef`'s `principalId`, itself
 * `getAuthedPrincipal(res).id` at the proxy) and records in `principalByRunId`. That identity is
 * exactly what `forwardAttachmentUpload`
 * (`server/runtime/composition/modules/assistant.ts`) now stamps into every upload's
 * `RUN_PRINCIPAL_HEADER` before it ever reaches the daemon's `AttachmentStore.register()` — the same
 * header the host daemon-access module already uses to scope run access, reused for the identical reason: it is
 * only trustworthy downstream of the daemon's bearer gate, which every route in this process sits
 * behind, so nothing a renderer sends can forge it.
 *
 * Net effect: this tool can never surface an attachment uploaded under a different admin's session,
 * and it can never surface one uploaded before this scoping existed (an ownerless record) — both are
 * excluded by `listPendingForOwner`'s own contract (see that method's doc), not by a check
 * duplicated here. Cross-site reach is structurally impossible for the same reason
 * `promote-chat-attachment.ts` gives: one `AttachmentStore` per site daemon, keyed by
 * the host's workspace setting.
 *
 * Discovery is further restricted to the refs in this run's accepted message. The host resolves
 * that binding from the daemon's contextRef, never from tool arguments. An absent binding means
 * no results: neither another conversation nor an earlier message may donate pending files.
 */
import type { ToolExecutionContext, ToolHandler, ToolRegistration } from "@jini-ai/core";
import type { PendingAttachmentSummary } from "@jini-ai/core/contracts/site/daemon-http";

export const CHAT_LIST_PENDING_ATTACHMENTS_TOOL_ID = "chat_list_pending_attachments";

/** The one `AttachmentStore` method this tool needs — narrowed so a test double never has to fake the rest. */
export type PendingChatAttachmentLookup = {
  listPendingForOwner: (required: { ownerId: string }, optional?: { runId?: string }) => Promise<PendingAttachmentSummary[]>;
};

/** No fields — this tool takes no input, matching the zero-argument schema convention used
 *  elsewhere in this codebase (`demo-image-tool.ts`, `frontend-control-capabilities.ts`). */
const INPUT_SCHEMA = { type: "object", additionalProperties: false, properties: {} } as const;

/** Renders one `PendingAttachmentSummary` for the model: an ISO string reads far more reliably as
 *  "when" than a raw epoch integer would. */
function toWireAttachment(attachment: PendingAttachmentSummary): Record<string, unknown> {
  return {
    attachmentRef: attachment.ref,
    filename: attachment.name,
    kind: attachment.kind,
    size: attachment.size,
    uploadedAt: new Date(attachment.createdAt).toISOString(),
  };
}

/**
 * Builds the `chat_list_pending_attachments` `ToolRegistration` — registered directly in
 * `agent-daemon-server.ts`, next to `media_promote_chat_attachment`, for the identical reason that
 * file's own doc gives: this tool has no meaning outside a process that also runs an
 * `AttachmentStore`.
 *
 * @param deps.getStore Returns the live `AttachmentStore`, or `undefined` before daemon startup has
 * finished constructing it — a thunk, not a value, matching `buildPromoteChatAttachmentTool`'s own
 * `getStore` for the identical reason (this registration is built before that store exists).
 * @complexity O(1) plus one bounded store scan (`listPendingForOwner`'s own O(n) in tracked records,
 * a small bounded number — see that method's doc).
 */
export function buildListPendingChatAttachmentsTool(deps: {
  readonly getStore: () => PendingChatAttachmentLookup | undefined;
  readonly getMessageAttachmentRefs?: (required: { runId: string }, optional: Record<string, never>) => readonly string[] | Promise<readonly string[]>;
}, _optional: Record<string, never> = {}): ToolRegistration {
  const handler: ToolHandler = async (ctx: ToolExecutionContext) => {
    const store = deps.getStore();
    if (!store) {
      // Structurally unreachable once the daemon has finished starting — see
      // `promote-chat-attachment.ts`'s own `attachmentStore` doc for why this is still handled
      // rather than asserted non-null.
      throw new Error("attachment store is not ready");
    }
    const pending = await store.listPendingForOwner({ ownerId: ctx.principal.id }, { runId: ctx.run.id });
    const refs = new Set(await deps.getMessageAttachmentRefs?.({ runId: ctx.run.id }, {}) ?? []);
    return { attachments: pending.filter(attachment => refs.has(attachment.ref)).map(toWireAttachment) };
  };

  return {
    descriptor: {
      id: CHAT_LIST_PENDING_ATTACHMENTS_TOOL_ID,
      metadata: toolMetadata[CHAT_LIST_PENDING_ATTACHMENTS_TOOL_ID],
      description:
        "Lists files attached to this exact message, including files already claimed by this run. Each result's attachmentRef can be " +
        "passed to media_promote_chat_attachment, plugins_install or agent_plugins_install. Files from other conversations or messages are " +
        "excluded; an empty list means this message has no pending attachments.",
      inputSchema: INPUT_SCHEMA,
      // `listPendingForOwner` only filters the store's in-memory records; it claims, prunes and
      // deletes nothing, so the read-only delegated-tool gateway may run this.
      readOnly: true,
    },
    handler,
    // Pass-through `allow`, same reasoning as `media_promote_chat_attachment`'s own registration:
    // the real access decision is `listPendingForOwner`'s own scoping to `ctx.principal.id` (see
    // this file's header), so there is no separate permission to gate here.
    policy: { authorize: () => "allow" },
  };
}
