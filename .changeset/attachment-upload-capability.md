---
"@jini-ai/http-kit": minor
---

Add the attachment upload capability: `POST`/`DELETE /api/attachments` plus a disk-backed store.

Composer file and image uploads were something every host had to build for itself. Getting it *working*
is easy; getting it right is not, and the parts that are easy to skip are the parts that matter — a
renderer must never learn a filesystem path, a claimed file must be provably the same file that was
uploaded, and the bytes must be gone when the run ends. This is that whole capability, extracted from a
working host implementation rather than designed fresh.

`createDiskAttachmentStore({ uploadDirectory, ... })` satisfies the `AttachmentStore` port with every
quota defaulted (10 files / 50 MB per message, 100 files / 200 MB per store, one-hour retention).
`registerAttachmentRoutes(app, { store }, adapter)` mounts the two routes, with a per-registration
concurrent-upload limit, a streaming byte cap, and the same-origin guard on by default.

What the store guarantees, all of it re-derived server-side and none of it taken from the client:

- the wire `path` is an opaque `attachment:<uuid>` capability, never a filesystem path — `claim()` is
  what exchanges one for a real path, and only once per attachment;
- `kind` is sniffed from the leading bytes (`detectAttachmentKind`), so a renderer cannot decide whether
  its upload reaches the agent as an image;
- the display name is a sanitized basename; the *stored* name is a fresh UUID;
- `claim()` re-verifies `dev`/`ino`/`size` and `realpath` against what registration recorded, so neither
  the file nor a parent directory can be swapped for a symlink in between;
- quota decisions happen with no `await` between the check and the commit, so concurrent uploads cannot
  both reserve the last slot;
- the upload directory is emptied on construction — files from an interrupted previous process cannot be
  authenticated, so they are not adopted.

Run-lifecycle wiring stays host-owned, matching `createRunScopedContextStore`'s precedent: a host calls
`store.claim(...)` in its own `onRunStarted`, threads the result into `AgentExecutor.run()`'s existing
`imagePaths`/`extraAllowedDirs`/`uploadRoot`, and calls `store.cleanupRun(runId)` in a `finally`. The
module doc carries that ~10-line pattern. There is no generic run hook to auto-wire into, and inventing
one here would be worse than documenting the ten lines.

Two things found while extracting, both now handled rather than inherited:

- **A body parser silently eats uploads.** The route streams the raw request, so an app-wide
  `express.json()` — which `compose-jini-kernel` mounts for every daemon — consumes the body of any
  upload whose content type it claims. Dropping a `.json` file was enough to trigger it, and it surfaced
  as the useless "attachment is empty". The route now detects an already-drained stream and reports it as
  the host misconfiguration it is.
- **Two redundant integrity checks that could never fire.** A `path.relative` containment test sitting
  behind a `dirname(filePath) === batchDirectory` check added nothing (parent-directory equality is
  strictly stronger and implies containment), and an `isSymbolicLink()` check behind `!isFile()` on an
  `lstat` result can never be the deciding one, since `lstat` reports exactly one file type. Both were
  removed with the reasoning recorded inline. The accepted-input set is unchanged; the integrity decision
  itself moved into a pure, exported `isUnchangedAttachment` so each condition — including a device
  change, which no filesystem test can stage — is directly verifiable.
