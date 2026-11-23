# Web screenshot

Domain logic for the `web_screenshot_page` agent tool: input rules, viewport presets, the
one-capture-at-a-time FIFO queue with a bounded wait, saved-capture file naming, and the
model-facing result (a JSON facts block, then one `image/jpeg` block per tile). It does no I/O:
the browser, the tile encoder, the own-site server, the file writer and the clock are ports.

Provenance: moved verbatim from the original host's `features/web-screenshot/web-screenshot.ts`
(only change: `CAPTURE_LIMITS` is no longer annotated with the diagnostics capture-budget limits
type, so this package takes no diagnostics dependency; the host checks it where it feeds the budget).
`capture-files.ts`, `own-site-opener.ts` and `screenshot-image.ts` moved verbatim from the same
host folder (`screenshot-image.ts` now types its codec with the core contract). `desktop-page-capture.ts`
moved with injection only: the desktop render-error class check, the native channel and the
Playwright adapter were defaults or imports there and are now required fields.

## Wiring

Needs injected (all on `createWebScreenshotService({ ports })` or per call):

- `PageCapturePort` (`ports.capture`): the headless browser. Throws `PageCaptureError` for every
  failure a caller should hear about.
- `EncodeTiles` (`ports.encodeTiles`): PNG to JPEG tiles (the host backs it with its image codec).
- `ports.nowMs`, optional `ports.observe` (receives `WebScreenshotEvent`) and
  `ports.scheduleQueueTimeout`.
- Per call: optional `OpenOwnSite` (a loopback origin for the host's own pages) and
  `SaveCaptureFiles` (writes tiles under the host's captures folder).

Provides: `readWebScreenshotInput`, `createWebScreenshotService`, `captureRelativePaths`,
`PageCaptureError`, the limits (`CAPTURE_LIMITS`, `MAX_*`, `VIEWPORT_PRESETS`) and the port types.

```ts
import { createWebScreenshotService, readWebScreenshotInput } from "@jini-ai/integrations/web-screenshot/web-screenshot";

const service = createWebScreenshotService({
  ports: { capture: hostPageCapture, encodeTiles: hostTileEncoder, nowMs: () => Date.now(), observe: hostReporter },
});
const result = await service.screenshot(
  { input: readWebScreenshotInput(rawToolInput), openOwnSite: hostOwnSiteOpener, saveCaptureFiles: hostCaptureWriter },
  { signal },
);
```

### Adapters beside the domain

- `capture-files.ts` — `createCaptureFileWriter({ rootDir })` (a `SaveCaptureFiles` that never
  overwrites and refuses paths escaping the folder) and `captureRootFor({ siteDir })`
  (`<siteDir>/.captures`). Uses `node:fs`; the host binds it per booted site folder.
- `own-site-opener.ts` — `createOwnSiteOpener({ themes, openLoopback })`: the host injects its
  discovered theme roster (read per call) and its loopback site-server opener; an unknown or
  invalid `themeId` is refused before anything boots.
- `screenshot-image.ts` — `createScreenshotTileEncoder({ imageCodec })`: the host injects an
  `ImageCodecPort` (`@jini-ai/core/contracts/site/cms-media`); no native codec is imported here.
- `desktop-page-capture.ts` — `createDesktopPageCapture({ capture, isRenderServiceError })` maps a
  native desktop URL-capture channel onto `PageCapturePort`; `createPageCaptureForHost({ playwright,
  nativeCapture, isRenderServiceError })` routes own-site captures to the native channel and public
  references, consent clicks and selector waits to the host's Playwright adapter. The host injects
  its Playwright `PageCapturePort`, its resolved native channel (or `null`, which returns the
  Playwright adapter unchanged) and a check for the desktop host's render error.

The host binds all four in its tool-catalog composition root (the `web_screenshot_page`
contributor), next to its own Playwright adapter and desktop channel resolver, which stay host-side.

Must never import: a browser driver, an image codec, the file system, another `@jini-ai/*`
package's implementation (core types and `ToolInputError` only), or host product names and paths.
Why: [DR-005 portable package boundaries](../../../../docs/decisions/DR-005-portable-package-boundaries.md).
