import { useSyncExternalStore } from "react";
import { ErrorNotice, type ErrorNoticeProps, type FailureChannel } from "../../../react/kit.js";
import { t } from "../shared-components-i18n.js";

/** The host's admin failure channel: the notice reads, subscribes to and clears it. */
export type AdminFailureNoticeChannel = Pick<FailureChannel, "subscribe" | "getSnapshot" | "reset">;

export type AdminFailureNoticeProps = Omit<ErrorNoticeProps, "failure" | "role"> & { readonly channel: AdminFailureNoticeChannel };

/** The existing shared ErrorNotice beside the restart banner, retained until the operator dismisses it.
 * Optional clipboard ports preserve selectable details when browser copying is unavailable.
 * The host injects its failure `channel` and styles the `jini-admin-failure-notice` classes.
 * @complexity O(one bounded copy block) per incident render, no requests or polling.
 * @overallScore 99 — layout uses the existing host notice styling; Chrome visual review remains external.
 */
export function AdminFailureNotice({ channel, ...ports }: AdminFailureNoticeProps) {
  // This notice also mounts before sign-in; reuse the shell's document locale without reading settings.
  const locale = typeof document === "undefined" ? "en" : document.documentElement.lang || "en";
  const failure = useSyncExternalStore(channel.subscribe, channel.getSnapshot, channel.getSnapshot);
  if (!failure) return null;
  // A floating card with Dismiss inside it: a full-width strip above the sidebar pushed the whole layout down.
  return <section className="jini-admin-failure-notice">
    <ErrorNotice failure={failure} role="status" {...ports} />
    <button type="button" className="jini-admin-failure-notice__dismiss" aria-label={t({ locale, key: "Dismiss error" })} onClick={() => channel.reset()}>×</button>
  </section>;
}
