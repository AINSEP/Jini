/**
 * @file The admin's client for the owner-only screenshot cleanup routes
 * (`host src/server/runtime/composition/modules/screenshot-storage.ts`).
 */

/** What a preview shows the owner: at most 50 names, plus the full count and bytes. */
export interface ScreenshotCleanupPreview { previewToken: string; deadline: number; count: number; bytes: number; items: string[] }
/** What a confirmed apply did; `changed` means the file was replaced after the preview, so it stayed. */
export interface ScreenshotCleanupResult { deleted: string[]; kept: { relPath: string; reason: "missing" | "changed" | "not-eligible" }[] }

/** The two calls the Storage panel's "Delete screenshots older than…" needs. */
export interface ScreenshotCleanupClient {
  preview(required: { before: number }, optional?: Record<string, never>): Promise<ScreenshotCleanupPreview>;
  apply(required: { previewToken: string }, optional?: Record<string, never>): Promise<ScreenshotCleanupResult>;
}

type AdminRequest = <T>(required: { method?: string; path: string; body?: unknown }) => Promise<T>;

/**
 * Builds the client over a host `request`. Apply always sends `confirm: true`: the client is only
 * called after the owner pressed Delete on the preview, and the server re-checks every file.
 * @complexity O(1) per call.
 */
export function createScreenshotCleanupClient({ request: send, workspaceId, path }: { request: AdminRequest; workspaceId: string; path: (required: { workspaceId: string }) => string }, _optional: Record<string, never> = {}): ScreenshotCleanupClient {
  const base = path({ workspaceId });
  return {
    preview: ({ before }) => send<ScreenshotCleanupPreview>({ method: "POST", path: `${base}/preview`, body: { before } }),
    apply: ({ previewToken }) => send<ScreenshotCleanupResult>({ method: "POST", path: `${base}/apply`, body: { previewToken, confirm: true } }),
  };
}

