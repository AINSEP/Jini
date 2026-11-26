import { useCallback, useState } from "react";

import type { ScreenshotCleanupClient, ScreenshotCleanupPreview, ScreenshotCleanupResult } from "../api/screenshot-cleanup-api.js";

/** `idle → previewing → shown → deleting → done`, or `error` from either request. */
export type ScreenshotCleanupState =
  | { status: "idle" }
  | { status: "previewing" }
  | { status: "shown"; preview: ScreenshotCleanupPreview }
  | { status: "deleting"; preview: ScreenshotCleanupPreview }
  | { status: "done"; result: ScreenshotCleanupResult }
  | { status: "error"; message: string };

/** What the Storage panel's Screenshots row renders and calls. */
export interface ScreenshotCleanupController {
  state: ScreenshotCleanupState;
  /** Lists what would be deleted; deletes nothing. */
  preview(required: { before: number }): Promise<void>;
  /** Deletes the shown preview's files that are unchanged; only valid in `shown`. */
  confirm(): Promise<void>;
  reset(): void;
}

/**
 * The Storage panel's screenshot cleanup: always a preview first, and deletion only on the owner's
 * confirm of that preview (the client sends its token). `client` and `describeError` are required —
 * the composition passes `screenshotCleanupClient` and the admin's `describeApiError`.
 * @complexity O(1) per action.
 */
export function useScreenshotCleanup(
  { client, describeError }: { client: ScreenshotCleanupClient; describeError: (required: { error: unknown }) => string },
  _optional: Record<string, never> = {},
): ScreenshotCleanupController {
  const [state, setState] = useState<ScreenshotCleanupState>({ status: "idle" });
  const fail = useCallback((error: unknown) => setState({ status: "error", message: describeError({ error }) }), [describeError]);
  const preview = useCallback(async ({ before }: { before: number }) => {
    setState({ status: "previewing" });
    try { setState({ status: "shown", preview: await client.preview({ before }) }); } catch (error) { fail(error); }
  }, [client, fail]);
  const confirm = useCallback(async () => {
    if (state.status !== "shown") return;
    const shown = state.preview;
    setState({ status: "deleting", preview: shown });
    try { setState({ status: "done", result: await client.apply({ previewToken: shown.previewToken }) }); } catch (error) { fail(error); }
  }, [client, fail, state]);
  const reset = useCallback(() => setState({ status: "idle" }), []);
  return { state, preview, confirm, reset };
}
