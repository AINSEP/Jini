import { createDaemonAttachmentUploader } from '@jini-ai/chat/react';

/**
 * Composer drag-and-drop and file-picker uploads for every pane in this host, talking to the
 * `@jini-ai/http-kit` attachment routes `daemon.ts` mounts. Replaces ~160 lines of hand-rolled
 * client upload code this example used to carry in `attachments.ts`.
 *
 * `''` as the base URL because `vite.config.ts` proxies `/api` to the daemon, so the page is already
 * same-origin with the endpoint. Every quota is the package default (20 MB per file, 10 files and
 * 50 MB per message), which is what the daemon side enforces too.
 *
 * One shared instance rather than one per pane, so a user who moves between the main app and a lab
 * page is held to one per-turn quota — the same behavior the previous module-level implementation
 * had.
 */
export const PLAYGROUND_ATTACHMENT_UPLOADER = createDaemonAttachmentUploader('');
