---
"@jini-ai/agent-plugins": minor
---

Add the `ffmpeg-transcode` agent plugin: `@jini-ai/agent-plugins/ffmpeg-transcode/adapter` exports `createFfmpegMediaTranscoder` (host injects binary discovery, process runner, lock, byte sniffer, size policy, messages and environment), `buildVideoTranscodeArgs` and `VIDEO_TRANSCODE_TIMEOUT_MS`. Local ffmpeg is required and is not bundled.
