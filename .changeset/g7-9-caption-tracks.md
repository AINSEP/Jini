---
"@jini-ai/core": minor
"@jini-ai/cms": minor
---

G7-9 caption tracks: `MediaRecord.captions` (optional sibling `.vtt` reference), `MediaAssetRenderMeta.captionsTrack`, WebVTT upload acceptance (`text/vtt` sniffed and allow-listed), and the widget + doc media renderers emit the validated `<track kind="captions">` when a resolved track is present. `resolveMediaCaptionsTrack` (`@jini-ai/cms/media/site/public-path`) resolves a `.vtt` reference for hosts to inject as `WidgetHostPorts.media.resolveMediaCaptionsTrack`.
