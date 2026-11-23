import { useSyncExternalStore } from "react";
import type { UserFacingError } from "@jini-ai/core";

import { ErrorNotice, type ErrorNoticeProps } from "../../../react/kit.js";

/** The slice of the host's retained-failure store the notice reads and resets (a `useSyncExternalStore`
 *  source); `@jini-ai/ui/panel-kit`'s `createFailureChannel` satisfies it. */
export interface AdminFailureNoticeChannel {
  subscribe(listener: () => void): () => void;
  getSnapshot(): UserFacingError | null;
  reset(): void;
}

/** Required: the host's failure channel and the translated Dismiss label (this notice also mounts before
 *  sign-in, so the host resolves the locale). The rest passes through to the kit's `ErrorNotice`. */
export type AdminFailureNoticeProps = Omit<ErrorNoticeProps, "failure" | "role"> & {
  channel: AdminFailureNoticeChannel;
  dismissLabel: string;
};

/** The existing shared ErrorNotice beside the restart banner, retained until the operator dismisses it.
 * Clipboard ports for selectable details when browser copying is unavailable travel through the host's
 * kit `ErrorNotice` binding. Styles: `admin-failure-notice.css` beside this file, imported by the host.
 * @complexity O(one bounded copy block) per incident render, no requests or polling.
 * @overallScore 99 — layout uses the existing host notice styling; Chrome visual review remains external.
 */
export function AdminFailureNotice({ channel, dismissLabel, ...notice }: AdminFailureNoticeProps) {
  const failure = useSyncExternalStore(channel.subscribe, channel.getSnapshot, channel.getSnapshot);
  if (!failure) return null;
  // A floating card with Dismiss inside it: a full-width strip above the sidebar pushed the whole layout down.
  return <section className="jini-admin-failure-notice">
    <ErrorNotice failure={failure} role="status" {...notice} />
    <button type="button" className="jini-admin-failure-notice__dismiss" aria-label={dismissLabel} onClick={() => channel.reset()}>×</button>
  </section>;
}
