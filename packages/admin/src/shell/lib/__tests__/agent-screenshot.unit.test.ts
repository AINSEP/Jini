// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { ADMIN_CAPTURE_SCREENSHOT_CAPABILITY_ID, MAX_SCREENSHOT_BYTES, captureAdminScreenshotToolResult } from "../agent-screenshot.js";

/**
 * @file `agent-screenshot.ts`'s orchestration logic — the part the host app hook's `useAgentPageBridge`
 * registers under `createFrontendSessionBridge`'s `"admin."` executor prefix to answer
 * `admin.capture_screenshot` invocations.
 *
 * The orchestration tests inject a canvas fake. The host's html2canvas-pro adapter has its own test
 * in the host, pinning its library selection and viewport options; actual painting still needs
 * browser verification.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A fake canvas whose `toDataURL` returns a data URL sized to a requested byte count, so the
 *  size-budget retry loop can be asserted without ever decoding a real image. */
function fakeCanvas(bytesByQuality: Record<string, number>) {
  return {
    toDataURL: vi.fn((type: string, quality: number) => {
      const bytes = bytesByQuality[String(quality)];
      if (bytes === undefined) throw new Error(`fakeCanvas: no byte count configured for quality ${quality}`);
      // Real base64 is ~4/3 the raw byte count; padding with "A" is valid base64 filler and decodes
      // to zero bytes, so the length arithmetic in `agent-screenshot.ts` is exercised for real rather
      // than asserted against a mocked estimator.
      const data = "A".repeat(Math.ceil((bytes * 4) / 3));
      return `data:${type};base64,${data}`;
    }),
  };
}

describe("captureAdminScreenshotToolResult", () => {
  it("reports a text-only failure, not a thrown error, when there is no element to capture", async () => {
    const renderElementToCanvas = vi.fn();

    const result = await captureAdminScreenshotToolResult({ element: null, renderElementToCanvas });

    expect(renderElementToCanvas).not.toHaveBeenCalled();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { text: string }).text).toMatch(/no admin content area/i);
  });

  it("reports a text-only failure when the element is no longer attached to the document", async () => {
    const renderElementToCanvas = vi.fn();
    const detached = document.createElement("main"); // never appended — isConnected is false

    const result = await captureAdminScreenshotToolResult({ element: detached, renderElementToCanvas });

    expect(renderElementToCanvas).not.toHaveBeenCalled();
    expect((result.content[0] as { text: string }).text).toMatch(/no admin content area/i);
  });

  it("returns a text note plus an image content block on a successful capture within budget", async () => {
    const element = document.createElement("main");
    document.body.appendChild(element);
    const canvas = fakeCanvas({ "0.7": 1000 });
    const renderElementToCanvas = vi.fn().mockResolvedValue(canvas);

    const result = await captureAdminScreenshotToolResult({ element, renderElementToCanvas });

    expect(renderElementToCanvas).toHaveBeenCalledWith(element);
    expect(canvas.toDataURL).toHaveBeenCalledWith("image/jpeg", 0.7);
    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(result.content[1]).toMatchObject({ type: "image", mimeType: "image/jpeg" });
    expect(typeof (result.content[1] as { data: string }).data).toBe("string");
    expect((result.content[1] as { data: string }).data.length).toBeGreaterThan(0);
    expect((result.content[1] as { data: string }).data).toBe(canvas.toDataURL.mock.results[0]!.value.split(",")[1]);
    document.body.removeChild(element);
  });

  it("the accompanying text names the fidelity limits, so a blank MCP-UI iframe is never read as 'nothing there'", async () => {
    const element = document.createElement("main");
    document.body.appendChild(element);
    const renderElementToCanvas = vi.fn().mockResolvedValue(fakeCanvas({ "0.7": 1000 }));

    const result = await captureAdminScreenshotToolResult({ element, renderElementToCanvas });

    expect((result.content[0] as { text: string }).text).toMatch(/iframe/i);
    document.body.removeChild(element);
  });

  it("retries at a lower JPEG quality when the first attempt exceeds the size budget", async () => {
    const element = document.createElement("main");
    document.body.appendChild(element);
    const canvas = fakeCanvas({ "0.7": MAX_SCREENSHOT_BYTES + 1, "0.4": 1000 });
    const renderElementToCanvas = vi.fn().mockResolvedValue(canvas);

    const result = await captureAdminScreenshotToolResult({ element, renderElementToCanvas });

    // Rendered exactly once — only the ENCODE is retried at a lower quality, not the (expensive)
    // rasterization itself.
    expect(renderElementToCanvas).toHaveBeenCalledTimes(1);
    expect(canvas.toDataURL).toHaveBeenNthCalledWith(1, "image/jpeg", 0.7);
    expect(canvas.toDataURL).toHaveBeenNthCalledWith(2, "image/jpeg", 0.4);
    expect(result.content[1]).toMatchObject({ type: "image" });
    const data = (result.content[1] as { data: string }).data;
    expect(data).toBe(canvas.toDataURL.mock.results[1]!.value.split(",")[1]);
    expect(atob(data).length).toBeLessThanOrEqual(MAX_SCREENSHOT_BYTES);
    document.body.removeChild(element);
  });

  it("fails with a text-only explanation, never a truncated/corrupt image, when every quality attempt exceeds budget", async () => {
    const element = document.createElement("main");
    document.body.appendChild(element);
    const canvas = fakeCanvas({ "0.7": MAX_SCREENSHOT_BYTES + 1, "0.4": MAX_SCREENSHOT_BYTES + 1 });
    const renderElementToCanvas = vi.fn().mockResolvedValue(canvas);

    const result = await captureAdminScreenshotToolResult({ element, renderElementToCanvas });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { text: string }).text).toMatch(/too large|size budget/i);
    document.body.removeChild(element);
  });

  it("skips an attempt that is not a base64 data URL (a zero-size canvas yields \"data:,\") and uses the next quality", async () => {
    const element = document.createElement("main");
    document.body.appendChild(element);
    const urls = ["data:,", "data:image/jpeg;base64,QUJD"];
    const canvas = { toDataURL: vi.fn(() => urls.shift()!) };

    const result = await captureAdminScreenshotToolResult({ element, renderElementToCanvas: vi.fn().mockResolvedValue(canvas) });

    expect(canvas.toDataURL).toHaveBeenCalledTimes(2);
    expect(result.content[1]).toEqual(expect.objectContaining({ type: "image", mimeType: "image/jpeg", data: "QUJD" }));
    document.body.removeChild(element);
  });

  it("counts trailing \"=\" padding as no bytes, so a padded payload exactly at the budget is accepted and one byte over is not", async () => {
    const element = document.createElement("main");
    document.body.appendChild(element);
    // 2_000_002 chars estimate floor(2_000_002 * 3 / 4) = 1_500_001 bytes, minus 1 for "=" -> exactly the budget.
    const onePad = "A".repeat(2_000_001) + "=";
    // 2_000_003 chars estimate 1_500_002 bytes, minus 2 for "==" -> exactly the budget.
    const twoPad = "A".repeat(2_000_001) + "==";
    const unpadded = "A".repeat(2_000_002);
    for (const [data, accepted] of [[onePad, true], [twoPad, true], [unpadded, false]] as const) {
      const canvas = { toDataURL: vi.fn(() => `data:image/jpeg;base64,${data}`) };
      const result = await captureAdminScreenshotToolResult({ element, renderElementToCanvas: vi.fn().mockResolvedValue(canvas) });
      if (accepted) expect(result.content[1]).toEqual(expect.objectContaining({ type: "image", data }));
      else expect(result.content).toEqual([expect.objectContaining({ type: "text", text: expect.stringMatching(/size budget/) })]);
    }
    document.body.removeChild(element);
  });

  it("reports a non-Error rejection from the renderer by its string form", async () => {
    const element = document.createElement("main");
    document.body.appendChild(element);

    const result = await captureAdminScreenshotToolResult({ element, renderElementToCanvas: vi.fn().mockRejectedValue("tainted canvas") });

    expect(result.content).toHaveLength(1);
    expect((result.content[0] as { text: string }).text).toBe("screenshot capture failed: tainted canvas");
    document.body.removeChild(element);
  });

  it("reports a text-only failure, not a thrown error, when the renderer itself rejects", async () => {
    const element = document.createElement("main");
    document.body.appendChild(element);
    const renderElementToCanvas = vi.fn().mockRejectedValue(new Error("html2canvas exploded"));

    const result = await captureAdminScreenshotToolResult({ element, renderElementToCanvas });

    expect(result.content).toHaveLength(1);
    expect((result.content[0] as { text: string }).text).toMatch(/html2canvas exploded/);
    document.body.removeChild(element);
  });
});

describe("ADMIN_CAPTURE_SCREENSHOT_CAPABILITY_ID", () => {
  it("matches the id registered server-side in frontend-control-capabilities.ts", () => {
    // The two files cannot import each other (the host's admin and server are separate builds — see
    // this module's own header) so the id is intentionally duplicated; this pins the literal so the
    // two cannot silently drift, the same cross-boundary-string discipline `assistant-transport.ts`'s
    // `frontendBindToken` envelope key already relies on.
    expect(ADMIN_CAPTURE_SCREENSHOT_CAPABILITY_ID).toBe("admin.capture_screenshot");
  });
});

// L13 Stryker: dropping the `^`/`$` anchors from the data-URL regex survived. A malformed first
// attempt must be skipped (falling through to the next quality), never parsed into an image block.
describe("data-URL parsing — anchors and parts (L13)", () => {
  for (const malformed of [
    "xdata:image/jpeg;base64,QUJD", " data:image/jpeg;base64,QUJD", "data:image/jpeg;base64,", "data:;base64,QUJD",
    "data:image/jpeg,QUJD", "data:image/jpeg;base64QUJD", "prefix data:image/png;base64,QUJD",
  ]) {
    it(`skips ${JSON.stringify(malformed)} and uses the next attempt`, async () => {
      const element = document.createElement("main");
      document.body.appendChild(element);
      const urls = [malformed, "data:image/jpeg;base64,WFla"];
      const canvas = { toDataURL: vi.fn(() => urls.shift()!) };
      const result = await captureAdminScreenshotToolResult({ element, renderElementToCanvas: vi.fn().mockResolvedValue(canvas) });
      expect(canvas.toDataURL).toHaveBeenCalledTimes(2);
      expect(result.content[1]).toEqual(expect.objectContaining({ type: "image", mimeType: "image/jpeg", data: "WFla" }));
      document.body.removeChild(element);
    });
  }

  it("keeps a multi-line payload whole and reads the mime type up to the first ';'", async () => {
    const element = document.createElement("main");
    document.body.appendChild(element);
    const canvas = { toDataURL: vi.fn(() => "data:image/png;base64,QU\nJD") };
    const result = await captureAdminScreenshotToolResult({ element, renderElementToCanvas: vi.fn().mockResolvedValue(canvas) });
    expect(result.content[1]).toEqual(expect.objectContaining({ mimeType: "image/png", data: "QU\nJD" }));
    document.body.removeChild(element);
  });
});
