import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";

/**
 * @file What `MediaPickerDialog.hooks.tsx` needs from the outside world, as an interface rather
 * than a direct `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented in
 * `development/docs/architecture/wired-hooks-convention.md` and `Jini redirects/SOURCE-RATIONALE.md` (the
 * canonical reference). This port is deliberately its own file rather than reusing
 * `features/media/hooks/media-port.hooks.ts`'s (larger) `MediaPort`: `components/` sits below
 * every feature and must not import from one (the same "nothing outside this feature needs it"
 * boundary `media-port.hooks.ts` itself states, just enforced in the other direction here) — a
 * reusable dialog depending on a specific feature's port would be a back-edge into the composition
 * root's dependency graph (see the host's architecture-metrics note). Scoped to the one route this
 * dialog actually calls.
 *
 * `describeApiError` stays a direct import in the hook — pure error-classification, no I/O, same
 * reasoning as `Jini redirects/SOURCE-RATIONALE.md`'s own exclusion of it.
 */
export interface MediaPickerPort {
  listMedia(): Promise<{ media: AdminMedia[] }>;
  /**
   * Synchronous URL builder for a thumbnail's byte-serving preview image — NOT a network call
   * itself; the browser requests the URL only once the returned string is used as an `<img src>`.
   * On the port since 2026-08-14 per the owner's ruling that ALL `lib/api.ts` URL builders cross
   * this seam uniformly (mirrors `page-editor-port.hooks.ts`'s `templatePreviewUrl`, the reference
   * implementation): `media-picker-dependencies.hooks.ts` becomes the only file under this folder
   * that reaches `lib/api` for it, and a test can assert a rendered thumbnail's `src` came from the
   * injected port rather than `MediaPickerDialog.tsx` calling `api.mediaOriginalUrl` itself. See
   * `lib/api.ts`'s own `mediaOriginalUrl` for the exact URL shape this mirrors.
   */
  mediaOriginalUrl(required: { id: string }, optional?: Record<string, never>): string;
}
