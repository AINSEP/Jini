# Web screenshot

Domain logic for the `web_screenshot_page` agent tool: input rules, viewport presets, the
one-capture-at-a-time FIFO queue with a bounded wait, saved-capture file naming, and the
model-facing result (a JSON facts block, then one `image/jpeg` block per tile). It does no I/O:
the browser, the tile encoder, the own-site server, the file writer and the clock are ports.

Provenance: moved verbatim from the original host's `features/web-screenshot/web-screenshot.ts`
(only change: `CAPTURE_LIMITS` is no longer annotated with the diagnostics capture-budget limits
type, so this package takes no diagnostics dependency; the host checks it where it feeds the budget).

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

Must never import: a browser driver, an image codec, the file system, another `@jini-ai/*`
package's implementation (core types and `ToolInputError` only), or host product names and paths.
Why: [DR-005 portable package boundaries](../../../../docs/decisions/DR-005-portable-package-boundaries.md).
