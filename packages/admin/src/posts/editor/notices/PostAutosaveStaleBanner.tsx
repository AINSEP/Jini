import { agentHandle } from "@jini-ai/core/agent-handles";

/**
 * Standing-draft autosave — the STALE-BASIS notice (2026-09-06). Mirrors
 * `features/pages/PageEditor.tsx`'s identical `PageAutosaveStaleBanner`; both editors share
 * `useStandingDraftAutosave`, so a notice in only one of them leaves the other silent.
 *
 * Three neighbouring banners on this screen, three genuinely different facts:
 * - `PostAutosaveRecoveryBanner` — work found parked from a PREVIOUS session, offered back.
 * - `PostVersionConflictBanner` — an EXPLICIT Save the server rejected, with a way past it.
 * - this one — BACKGROUND autosaving has stopped for the session happening right now, because
 *   another operator's save moved this post's version out from under this tab. Until it existed the
 *   operator had no way to know: the editor looked completely normal while every write it made was
 *   being thrown away. The host's injected `staleBasisMessage` owns the wording so this
 *   component stays markup only.
 *
 * NO buttons, deliberately, and this is the one design decision here worth defending:
 * - A "Dismiss" would let the operator silence a warning that is still true, putting them straight
 *   back into the silent data loss this whole path exists to end. The notice clears by itself when
 *   autosaving actually resumes (`usePostEditor`'s `autosaveStaleBasis` goes null once a write is
 *   accepted on a fresh basis) and at no other time, so it can never be lying while it is on screen.
 *   `PostVersionConflictBanner`'s own Dismiss is not a precedent for one here: that banner reports a
 *   single finished request, while this reports a condition that is still true as it is read.
 * - A "Reload" would wipe the operator's typed text out of the editor on their behalf. Their only
 *   remaining copy would then be the shared hook's best-effort browser-storage mirror, which is not
 *   a guarantee this component can make on their behalf (`localStorage` throws outright in some
 *   privacy modes). The message tells them to copy their work first and leaves the choice with them.
 *
 * No `t` prop, matching the injected `staleBasisMessage`'s own interpolated-copy convention — there
 * is no button label here for `t` to resolve.
 *
 * `staleBasisMessage` is the host's wording function, injected (K5): the copy is host-owned and
 * interpolated, so this package renders it without owning it. Generic over the host's basis type.
 */
export function PostAutosaveStaleBanner<TStaleBasis>({ staleBasis, staleBasisMessage }: {
  staleBasis: TStaleBasis;
  staleBasisMessage: (staleBasis: TStaleBasis) => string;
}) {
  return (
    <div
      className="jini-post-notice jini-post-notice--warning"
      {...agentHandle({ handle: "post-autosave-stale" }, {
        role: "region",
        label:
          "Another operator saved this while you were editing — autosaving has stopped, and your " +
          "unsaved changes are still here in the editor",
      })}
    >
      <p>{staleBasisMessage(staleBasis)}</p>
    </div>
  );
}
