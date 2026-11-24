import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";

/**
 * @file What `use-media.hooks.ts`, `use-edit-media-panel.hooks.ts`, and `use-media-preview.hooks.ts`
 * need from the outside world, as an interface rather than a direct `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented on
 * `development/docs/architecture/wired-hooks-convention.md` (canonical spec) and
 * `Jini redirects/SOURCE-RATIONALE.md` (canonical reference implementation): this file declares,
 * `media-dependencies.hooks.ts` binds the real `api` client, and nothing else under
 * `features/media` imports `lib/api` for these six routes. One shared port rather than one per
 * hook — all three hooks read/write the same `/media` resource, and a test double for one is a
 * test double for the resource, not for a single screen.
 *
 * `mediaOriginalUrl` IS part of this port (changed 2026-08-14 — this is not an oversight). Earlier
 * revisions of this file excluded it: it is a pure, synchronous URL template
 * (`${BASE}/workspaces/${WORKSPACE_ID}/media/${id}/original` — no `fetch`, no `await`, see
 * `lib/api.ts`), and the convention's "what stays a direct import" rule (same category as
 * `describeApiError`) argued a pure no-I/O function had no host boundary worth injecting. The
 * owner's ruling supersedes that argument: EVERY synchronous URL builder `lib/api.ts` exposes goes
 * through its consumer's port uniformly, so `media-dependencies.hooks.ts` stays the only file
 * reaching `lib/api` for these six routes and a test can prove a URL came from the injected port
 * rather than the consumer calling `lib/api` itself — the same thing the five I/O routes below were
 * already bought for. Mirrors `page-editor-port.hooks.ts`'s `templatePreviewUrl`, the reference
 * implementation this was ported from. `use-media-preview.hooks.ts` (2026-08-11 wired-hooks-audit)
 * was the last holdout arguing the old exclusion for itself; it now injects this same port too — see
 * its own header for the conversion.
 *
 * One deliberate carve-out remains, and it is NOT a straggler: `lib/media-image-extension.tsx`
 * (a TipTap node view, alongside `lib/widget-embed-extension.tsx`) still calls
 * `api.mediaOriginalUrl` directly. Per the owner's 2026-08-14 scope decision, node views under
 * `lib/` sit outside this port pattern entirely — ProseMirror mounts them inside the editor's own
 * lifecycle, not as React-tree components with props, so there is no prop seam for a port to cross
 * and the pattern buys no testability there. Do not "fix" that call site to match this one.
 */
export interface MediaPort {
  listMedia(): Promise<{ media: AdminMedia[] }>;
  uploadMedia(
    input: { filename: string; contentType: string; dataBase64: string },
    options?: { alt?: string; caption?: string; credit?: string }
  ): Promise<{ media: AdminMedia }>;
  updateMedia(
    target: { id: string },
    options?: {
      title?: string;
      slug?: string;
      alt?: string;
      caption?: string;
      credit?: string;
      width?: number | null;
      height?: number | null;
      cssClass?: string | null;
      htmlAttributes?: string | null;
    }
  ): Promise<{ media: AdminMedia }>;
  trashMedia(id: string): Promise<{ media: AdminMedia }>;
  deleteMedia(id: string): Promise<{ purged: boolean }>;
  /** Puts a trashed asset back in the library. `restored: false` means the Trash refused it. */
  restoreMedia(id: string): Promise<{ restored: boolean }>;
  /** Names the edit dialog's "Created by" principal. Optional: a port without it shows raw ids. */
  listUsers?(): Promise<{ users: ReadonlyArray<{ principalId: string; username: string }> }>;
  /**
   * Synchronous URL builder for a media asset's authenticated byte-serving preview/original file —
   * NOT a network call itself; see `lib/api.ts`'s own `mediaOriginalUrl` for the exact URL shape.
   * On the port since 2026-08-14 (see this file's header) so `media-dependencies.hooks.ts` is the
   * only file reaching `lib/api` for it and a test can assert the resolved URL came from the
   * injected port.
   */
  mediaOriginalUrl(id: string): string;
}
