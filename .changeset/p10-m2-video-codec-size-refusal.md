---
"@jini-ai/core": minor
"@jini-ai/cms": minor
---

Add a video codec hint and a typed upload size refusal. Core's `contracts/site/cms-media` gains `VideoCodec`, `VideoCodecProbePort`, the optional `AdminMediaDto.videoCodec`, the static `MEDIA_UPLOAD_TOO_LARGE` code and the `AdminMediaUploadTooLargeRefusal` wire shape. CMS records `source.videoCodec` only from a confirmed probe of admitted, byte-sniffed video bytes (`uploadMedia`/`replaceMediaFile` take an optional `videoCodecProbe` and `signal`; probe failures leave the hint unknown), projects it in `toAdminMediaResponse`, and exposes a bounded metadata-only `createFfmpegVideoCodecProbe` from `@jini-ai/cms/media/node`. Byte-limit refusals now throw `MediaUploadSizeError` (a `MediaValidationError` carrying `fileBytes`/`limitBytes`); the admin upload and replace routes keep the 400 and plain sentence and add `code: "MEDIA_UPLOAD_TOO_LARGE"` with both sizes.
