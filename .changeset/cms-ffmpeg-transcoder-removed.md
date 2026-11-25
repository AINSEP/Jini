---
"@jini-ai/cms": minor
"@jini-ai/core": minor
---

Breaking (cms): `@jini-ai/cms/media/node` no longer exports `createFfmpegMediaTranscoder`, `buildVideoTranscodeArgs`, `VIDEO_TRANSCODE_TIMEOUT_MS` or `FfmpegMediaTranscoderDeps`; import the converter from `@jini-ai/agent-plugins/ffmpeg-transcode/adapter`. The `@jini-ai/cms/media` type surface is unchanged.

Additive (core): `@jini-ai/core/contracts/site/cms-media` now defines the type-only `MediaTranscoderPort`, `VideoTranscodeResult`, `VideoTranscodeFailureReason` and `VideoTranscodeTarget`.
