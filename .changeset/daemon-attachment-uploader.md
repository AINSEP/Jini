---
"@jini-ai/chat-react": minor
---

Add `createDaemonAttachmentUploader`, so composer drag-and-drop is one line instead of 160.

`ChatPane` has always gated its drop target and file picker on `uploadAttachments` being supplied — but
supplying it meant writing the client half yourself: a bounded-concurrency worker pool that preserves
input order, per-turn quota accounting, abort and timeout plumbing, and cleanup of files that already
landed when a later one fails. Every host would write the same ~160 lines, and the ordering and
cleanup details are exactly the ones that get skipped.

```tsx
<ChatPane transport={transport} uploadAttachments={createDaemonAttachmentUploader(daemonUrl)} />
```

That talks to `@jini-ai/http-kit`'s `POST`/`DELETE /api/attachments`. Pass `''` when a dev-server proxy
already forwards `/api` from the page's own origin. `maxAttachmentBytes`, `maxAttachmentCount`,
`maxBatchBytes`, `timeoutMs`, and `concurrency` are all configurable and all default to the daemon side's
own limits, so the client's early rejection matches what the daemon would have said anyway.

Client-side quotas are a courtesy, never the boundary — telling a user their 400 MB video is too large
before the browser streams it, not after. The daemon re-derives every one of them.

Two behavioral notes for anyone porting hand-rolled code onto this:

- **The request always sends `content-type: application/octet-stream`**, not `file.type`. The daemon
  sniffs the real kind from the bytes and ignores the header, so forwarding the browser's guess buys
  nothing — and breaks real uploads: a dropped `.json` file arrives as `application/json`, which an
  app-wide `express.json()` on the daemon then claims, draining the request stream before the upload
  route can read a byte.
- **Batch accounting is per uploader instance**, not module-global, so two panes pointed at two daemons
  cannot consume each other's per-turn quota. Reservations are rolled back on failure, so a retry of a
  failed turn is not refused for quota it never actually used.
