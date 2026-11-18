---
"@jini-ai/daemon": patch
---

The attachment routes are returned as data: `attachmentUploadRoutes({ deps, host })` and `attachmentCleanupRoutes({ deps, host })` replace `registerAttachmentRoutes` (removed, no alias). They are two lists because a host mounts them differently: the upload streams the request's raw bytes to disk, so mount it where no parser above has read the body (an upload whose body was already consumed is refused as `attachment-body-consumed`); the cleanup reads a small JSON body behind the host's parser. `handleAttachmentUpload` and `handleAttachmentCleanup` take `{ request, locals, deps, host, state }` / `{ request, deps, host }` and return a `Response`; `resolveOwnerId` takes `{ request, locals }`. The answers are unchanged: 201 with the attachment, the same refusals and codes, 204 with no body for a cleanup, a redacted 500 with a request ID.
