/**
 * @file The `admin.capture_screenshot` executor — the assistant's only way to see the admin's actual
 * rendered pixels rather than DOM structure (`page.find_elements`).
 *
 * ## Wiring
 *
 * The host app hook's `useAgentPageBridge` registers its `renderAdminScreenshotCanvas` adapter (indirectly,
 * through {@link captureAdminScreenshotToolResult}) under `createFrontendSessionBridge`'s
 * `executors: {"admin.": ...}` prefix map — the same host-extension seam that file's own module doc
 * describes `chat.*`/`page.*` claiming, just exercised here by a host-native verb instead of a Jini
 * one. The capability id and description live server-side in
 * the host server's frontend-control capability list; {@link ADMIN_CAPTURE_SCREENSHOT_CAPABILITY_ID}
 * is duplicated here because the host's admin and server are separate builds with no shared-types
 * package for this — the same cross-boundary-string discipline `assistant-transport.ts`'s
 * `frontendBindToken` envelope key already relies on. `agent-screenshot.unit.test.ts` pins the two
 * strings equal so they cannot silently drift.
 *
 * The tool result shape (`{content: [{type:'text', ...}, {type:'image', mimeType, data}]}`) is
 * `assistant_demo_image`'s already-proven typed-media envelope
 * (the host server's demo-image tool), reused verbatim rather than inventing a second
 * one: the daemon's `extractResultMedia` (`@jini-ai/daemon`) recognizes this shape generically, on
 * ANY tool's raw output, and lifts its `image` blocks into the `tool_result.media` wire field that
 * `ToolCard` renders inline — regardless of which registration mechanism produced the result. This
 * capability's registration mechanism (`createFrontendCapabilityRegistrations`, projected from
 * `FrontendCapabilitySpec`) is different from `assistant_demo_image`'s
 * (`buildDomainRegistrations`), but both ultimately hand the SAME shape to the SAME generic
 * extraction step, which is what makes reusing the shape (rather than the registration mechanism)
 * the correct thing to reuse.
 *
 * ## Capture mechanism — why in-page rasterization, not a screen-share prompt or headless Chromium
 *
 * Three ways to get pixels out of a browser were considered:
 *
 * 1. **In-page DOM rasterization (`html2canvas-pro`) — chosen.** Runs over the SAME frontend-control
 *    channel already proven live, needs no OS-level permission prompt, and captures the operator's
 *    ACTUAL current view: scroll position, open panels, in-progress form edits. This is exactly the
 *    state a "does this look cramped/broken" question is about.
 *
 *    **Why the `-pro` fork, not plain `html2canvas`.** Confirmed live (Playwright, 2026-08-30) against
 *    the real admin dashboard: upstream `html2canvas@1.4.1` (unmaintained since ~2022) throws
 *    `Error: Attempting to parse an unsupported color function "oklch"` and aborts the ENTIRE capture
 *    the instant it walks any element using an `oklch()` color — which the host admin's main stylesheet
 *    and several feature stylesheets (`source-control.css`, `media.css`, `select.css`,
 *    `access-tokens.css`) already do. This is not a fidelity gap like the ones below; it is a hard
 *    failure that would make every real capture throw on this app specifically. `html2canvas-pro`
 *    (actively maintained, API-compatible fork adding `oklch`/`lab`/`lch`/`color-mix` support) was
 *    verified against the same real DOM with the identical call and produced a valid
 *    996x804 JPEG (~41KB) with no errors — see this file's handoff notes for the full before/after.
 * 2. **`navigator.mediaDevices.getDisplayMedia()`.** True pixels, but the browser prompts for
 *    permission on EVERY capture (no way to pre-authorize a screen-share session for a chat tool
 *    call) and, worse, would let the assistant capture the whole screen or another window/tab, not
 *    just this one admin tab — a strictly larger blast radius than option 1 for no fidelity gain on
 *    the actual use case. Disqualified: the owner's own ask was to REMOVE a manual step, and a
 *    permission dialog on every screenshot reintroduces exactly that friction.
 * 3. **Server-side headless Chromium against an authenticated URL.** True pixels and high fidelity,
 *    but it renders a FRESH page load — wrong scroll position, no open dialog, no in-progress edit,
 *    none of the state that made the operator ask in the first place. `@jini-ai/diagnostics`'s `web-evidence/browser-port.ts`
 *    (the host's existing headless-browser adapter) already documents that Chromium may be entirely
 *    ABSENT from a self-hosted host image, which would make this capability silently unavailable in
 *    exactly the deployments most likely to need it (an operator with no screenshot tool of their
 *    own). Reproducing the admin's authenticated, mid-edit tab state in a second browser process
 *    would also require re-deriving session/auth/route state server-side — a much larger and more
 *    fragile undertaking than option 1.
 *
 * ## What this capture CANNOT see — read before trusting an empty region
 *
 * - **Cross-origin iframes render BLANK.** This is the loud one: every MCP-UI surface the assistant
 *   itself has rendered is a sandboxed iframe (see `reference_mcp_ui_surface_agent_driveability`),
 *   so a rendered MCP-UI card is invisible in this capture. A blank rectangle where a card should be
 *   is NOT evidence that nothing rendered.
 * - Cross-origin `<img>` elements without permissive CORS headers taint the canvas and render blank.
 * - `<canvas>`/WebGL content and `<video>` frames frequently do not rasterize correctly.
 * - Only the `<main>` content area is captured (never the assistant's own chat dock, which sits
 *   outside it — see the host app hook's `useAgentPageBridge` doc for why that boundary already
 *   exists), and only what is clipped to the CURRENT viewport — content scrolled out of view is not
 *   included, by design (see the host's `renderAdminScreenshotCanvas` adapter).
 * - Complex CSS (filters, some blend modes, a custom font not yet loaded) can visually drift from
 *   what a person actually sees, since `html2canvas-pro` approximates computed styles via a cloned
 *   DOM rather than reading real compositor output.
 *
 * ## Privacy — see `agent-screenshot-bus.ts`'s module doc for the consent decision
 *
 * Every successful capture publishes `publishScreenshotCaptured` so the admin sees an
 * announcement, never a silent capture. This module does not call that bus directly — see this
 * file's own wiring note in the host's app hook for why that stays the caller's responsibility.
 */

/** Mirrors `@jini-ai/daemon`'s `ToolResultTextBlock`/`ToolResultImageBlock` field names exactly
 *  (`tool-result-media.ts`) — this is the wire shape `extractResultMedia` recognizes, not a new one.
 *  Redeclared locally rather than imported: the admin package has no dependency on `@jini-ai/daemon`, and
 *  taking one solely for two structural field names would be a heavier coupling than restating them. */
export type ScreenshotContentBlock = { readonly type: "text"; readonly text: string } | { readonly type: "image"; readonly mimeType: string; readonly data: string };

export interface ScreenshotToolResult {
  readonly content: readonly ScreenshotContentBlock[];
}

/** Must equal the `id` of the `CapabilityDef` this capability is registered under in
 *  the host server's frontend-control capability list — see this module's own doc for why
 *  the string is duplicated rather than imported, and `agent-screenshot.unit.test.ts` for the pin. */
export const ADMIN_CAPTURE_SCREENSHOT_CAPABILITY_ID = "admin.capture_screenshot";

/**
 * Raw (pre-base64) byte budget for one capture. Chosen to comfortably clear
 * the host daemon server's JSON body limit (`6mb`) after base64's ~4/3 inflation
 * (1.5MB * 4/3 ≈ 2MB, well under 6MB with room for the surrounding JSON envelope) while still
 * bounding how many image tokens one tool call can cost the model's context — the same
 * "bound what one call can return" reasoning `site_collect_page_evidence`'s `maxOutputBytes` gives,
 * applied here to an image instead of text.
 */
export const MAX_SCREENSHOT_BYTES = 1_500_000;

/** Encode attempts, in order: a good-looking first try, then a materially smaller fallback. Only
 *  two — a longer ladder would mean more silent quality loss for a shrinking chance of still fitting
 *  an already-oversized capture; past this point the honest answer is the failure result below, not
 *  a third guess. */
const JPEG_QUALITIES = [0.7, 0.4] as const;

/** Read once per successful capture, alongside the image — see this module's own "what this capture
 *  cannot see" section above for the full reasoning; this is the compressed reminder the model
 *  actually reads next to the pixels it just received. */
const FIDELITY_NOTE =
  "Screenshot captured (JPEG, current viewport, admin main content area only). Cross-origin iframes " +
  "(including any MCP-UI surface), cross-origin images without CORS, and canvas/video content may " +
  "render as blank space here — a blank area is not evidence that nothing is there.";

/** A canvas-shaped capture result — exactly the subset of `HTMLCanvasElement` this module calls.
 *  Structural rather than the DOM type itself, so a test fake needs no real `<canvas>`. */
export interface CapturedCanvas {
  toDataURL(type: string, quality: number): string;
}

/** Renders `element` to a canvas. Real implementation: the host's `renderAdminScreenshotCanvas` (html2canvas-pro). Injected
 *  so `captureAdminScreenshotToolResult`'s retry/budget logic is testable with no real DOM painting. */
export type RenderElementToCanvas = (element: HTMLElement) => Promise<CapturedCanvas>;

export interface CaptureAdminScreenshotOptions {
  /** The host app hook's `contentEl` — `null` before it mounts, or if the effect tore the bridge down. */
  readonly element: HTMLElement | null;
  readonly renderElementToCanvas: RenderElementToCanvas;
}

function buildTextBlock({ text }: { text: string }, _options = {}): ScreenshotContentBlock {
  return { type: "text", text };
}

function buildImageBlock({ mimeType, data }: { mimeType: string; data: string }, _options = {}): ScreenshotContentBlock {
  return { type: "image", mimeType, data };
}

/**
 * Builds a text-only failure result. Exported so a caller integration-testing the full executor path
 * (not exercised by this module's own tests, which assert through {@link captureAdminScreenshotToolResult}
 * instead) can recognize the shape without re-deriving it.
 *
 * @complexity O(1).
 */
export function buildScreenshotFailureResult({ reason }: { reason: string }, _options = {}): ScreenshotToolResult {
  return { content: [buildTextBlock({ text: reason })] };
}

/**
 * Splits a `data:<mimeType>;base64,<data>` URL into its two parts.
 *
 * @returns `undefined` for anything not shaped like a base64 data URL — `HTMLCanvasElement.toDataURL`
 * never produces that in practice, but a hand-authored test double could, and silently mis-parsing it
 * into a bogus image block would be worse than treating it as "nothing usable came back."
 * @complexity O(1) (a single bounded regex match; does not scan the base64 payload).
 */
function parseDataUrl({ dataUrl }: { dataUrl: string }, _options = {}): { readonly mimeType: string; readonly data: string } | undefined {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return undefined;
  // Both capture groups use a `+` quantifier, so a successful match always carries a non-empty
  // mime type and payload.
  return { mimeType: match[1]!, data: match[2]! };
}

/**
 * Estimates the RAW (decoded) byte size a base64 string represents, without decoding it — decoding a
 * multi-megabyte string just to measure it would be wasted work on every attempt, including the ones
 * this function exists to reject before ever building an image block from them.
 *
 * @complexity O(1) — reads `.length` and up to 2 trailing characters, never the whole string content.
 */
function estimateBase64ByteLength({ base64 }: { base64: string }, _options = {}): number {
  let padding = 0;
  if (base64.endsWith("=")) padding = base64.endsWith("==") ? 2 : 1;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Encodes `canvas` at each quality in {@link JPEG_QUALITIES}, in order, returning the first attempt
 * that fits {@link MAX_SCREENSHOT_BYTES}. Encodes the SAME already-rendered canvas each time — no
 * re-rasterization — so the retry costs only the cheap `toDataURL` call, not another full render.
 *
 * @returns The fitting result's content blocks, or `undefined` if every quality attempt still
 * exceeds the budget.
 * @complexity O(q) in `JPEG_QUALITIES.length` (a fixed constant, 2 today); each iteration's own cost
 * is `toDataURL`'s (canvas-size-dependent, not this function's to bound) plus O(1) size estimation.
 */
function encodeWithinBudget(canvas: CapturedCanvas): readonly ScreenshotContentBlock[] | undefined {
  for (const quality of JPEG_QUALITIES) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const parsed = parseDataUrl({ dataUrl });
    if (parsed && estimateBase64ByteLength({ base64: parsed.data }) <= MAX_SCREENSHOT_BYTES) {
      return [buildTextBlock({ text: FIDELITY_NOTE }), buildImageBlock({ mimeType: parsed.mimeType, data: parsed.data })];
    }
  }
  return undefined;
}

/**
 * Answers one `admin.capture_screenshot` invocation: renders `element` (if attached) to a canvas,
 * encodes it within budget, and reports the outcome as model-facing data rather than throwing — the
 * same "evidence, not an exception" posture `site_collect_page_evidence`'s `OriginNotVerifiedError`
 * handling uses, so a capture that cannot happen right now reads as an answer the agent can act on
 * ("ask the operator to reopen the tab") instead of a tool-call error with no actionable content.
 *
 * @complexity O(1) plus `renderElementToCanvas`'s own cost (real-adapter-dependent) and
 * {@link encodeWithinBudget}'s O(q) retry loop.
 */
export async function captureAdminScreenshotToolResult(options: CaptureAdminScreenshotOptions): Promise<ScreenshotToolResult> {
  const { element, renderElementToCanvas } = options;
  if (!element || !element.isConnected) {
    return buildScreenshotFailureResult({ reason: "no admin content area is currently attached to capture — the admin tab may have navigated away or the page bridge has not finished attaching yet" }
    );
  }

  let canvas: CapturedCanvas;
  try {
    canvas = await renderElementToCanvas(element);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildScreenshotFailureResult({ reason: `screenshot capture failed: ${message}` });
  }

  const content = encodeWithinBudget(canvas);
  if (!content) {
    return buildScreenshotFailureResult({ reason: "the rendered view was too large to encode within this tool's size budget even after quality reduction — try narrowing the visible area (e.g. collapsing a panel) first" }
    );
  }
  return { content };
}
