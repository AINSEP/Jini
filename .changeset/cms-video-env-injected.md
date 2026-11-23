---
"@jini-ai/cms": minor
---

`findVideoBinaries` and `createFfmpegVideoFrameExtractor` now take the host `env` as a required injected input instead of reading `process.env` (breaking: callers must pass `env`); the host's composition root passes it.
