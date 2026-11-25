---
"@jini-ai/cms": minor
---

Let a host set a separate, larger upload cap for video files. `uploadMedia`, `replaceMediaFile`, the `media_upload_asset` tool and the admin replace route take an optional `maxVideoUploadBytes`; files whose type is `video/*` use it, everything else keeps `maxUploadBytes`. Omitted, video follows the general cap, so existing hosts see no change.
