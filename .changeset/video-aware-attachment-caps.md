---
"@jini-ai/chat": minor
"@jini-ai/daemon": minor
"@jini-ai/admin": minor
---

Let a host choose the attachment size cap per file (`maxAttachmentBytesFor`), so a video can use a larger cap than other files. The chat uploader and the daemon's attachment route take the option; omitted, every file keeps the single existing cap. The admin Library file check takes the host's per-file limit the same way.
