import type { AdminDockerfileSource } from "@jini-ai/admin/deployment/api/deployment-api.types";

/**
 * @file What `useDockerfileSource` needs from the outside world, as an interface rather than a
 * direct host API import — same shape as `deployment-overview-port.hooks.ts` in this directory.
 *
 * 2026-08-15: gained {@link DockerfileSourcePort.setDockerfileSource} alongside the existing read —
 * the tab is now editable (backend landed same day: `PUT .../system/dockerfile`,
 * `api.setDockerfileSource`, see the host hook's header for the full write-side
 * story).
 *
 * Same day, later: `setDockerfileSource` gained a required `ifMatch` parameter (Terra audit finding
 * C5) — see `AdminDockerfileSource.etag`'s own doc on the API types for the full optimistic-
 * concurrency contract this port now carries through.
 */
export interface DockerfileSourcePort {
  getDockerfileSource(): Promise<AdminDockerfileSource>;
  /** Overwrites the repo-root Dockerfile with `contents` (creating it if it didn't exist) IF
   *  `ifMatch` still names the file's current etag, and resolves with the snapshot it now has — same
   *  contract as `api.setDockerfileSource`. A stale/missing `ifMatch` rejects (an `ApiError` with
   *  `.status` 412/400 for the real transport; a test double may reject with anything its own test
   *  recognizes). */
  setDockerfileSource(required: { contents: string; ifMatch: string }, optional?: {}): Promise<AdminDockerfileSource>;
}
