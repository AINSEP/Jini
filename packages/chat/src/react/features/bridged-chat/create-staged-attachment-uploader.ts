/**
 * A `ChatPaneProps['uploadAttachments']` for a host with no HTTP server — the bridge counterpart to
 * `createDaemonAttachmentUploader` (`../chat-pane/create-daemon-attachment-uploader.ts`).
 *
 * That function talks to a daemon's `POST /api/attachments` route; a host that runs no HTTP server
 * at all instead reads each dropped/picked `File`'s bytes in the renderer and hands them to its
 * main process over {@link AttachmentStagingPort.saveChatAttachment}, which writes them into the
 * host's own ephemeral staging directory and returns the absolute path. `ChatPane` gates its
 * composer's `+` picker AND its drop target on `uploadAttachments` being defined at all
 * (`resolveComposerAttachmentPicker`, `resolveDropTargetProps` in `ChatPane.tsx`) — passing this is
 * what makes both appear.
 *
 * Deliberately no client-side quota/concurrency machinery the way the daemon uploader has: those
 * exist there to protect a network round trip and a shared daemon-side upload budget. This is a
 * local disk write through a bridge only the one trusted renderer can reach, so a plain
 * sequential-order `Promise.all` is the whole of it.
 *
 * Order is preserved by writing each `ChatAttachment` back at the same index it was requested at
 * (`options?.batchId` is accepted but unused — nothing here needs to correlate uploads across
 * calls, since there is no shared server-side budget to charge them against).
 */
import type { ChatAttachment } from '../../../core/messages.js';
import type { ChatPaneAttachmentUploadOptions, ChatPaneProps } from '../chat-pane/types.js';
import type { AttachmentStagingPort } from './types.js';

/** `File.type` is the browser's own MIME sniff off the dropped/picked file — good enough to tell
 *  `ChatPane` how to render the attachment chip; not a security boundary either way. */
function attachmentKind({ file }: { file: File }, _options = {}): ChatAttachment['kind'] {
  return file.type.startsWith('image/') ? 'image' : 'file';
}

async function stageOne({ bridge, file, order }: { bridge: AttachmentStagingPort; file: File; order: number }, _options = {}
): Promise<ChatAttachment> {
  const data = await file.arrayBuffer();
  const { path } = await bridge.saveChatAttachment({ name: file.name, data });
  return { path, name: file.name, kind: attachmentKind({ file }), size: file.size, order };
}

/** Builds the uploader over the host's staging bridge. */
export function createStagedAttachmentUploader(
  { bridge }: { bridge: AttachmentStagingPort },
  _options: Record<string, never> = {},
): NonNullable<ChatPaneProps['uploadAttachments']> {
  return async function uploadAttachments(
    files: File[],
    options?: ChatPaneAttachmentUploadOptions,
  ): Promise<ChatAttachment[]> {
    if (files.length === 0) return [];
    // `options?.signal` covers a composer reset/unmount mid-upload; there is nothing partial to
    // clean up on the host's side (its staging directory is wiped at every boot, not accumulated
    // across a session's worth of abandoned drafts), so an abort simply drops the result on the
    // floor rather than rolling anything back.
    const staged = await Promise.all(files.map((file, order) => stageOne({ bridge, file, order })));
    if (options?.signal.aborted === true) return [];
    return staged;
  };
}
