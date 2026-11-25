import type { PublishContentPeerView, PublishDestinationView as AdminPublishDestinationView } from "@jini-ai/core/contracts/site/cms-publish-content";
import type { PublishContentConfirmResult, PublishContentExecuteResult, PublishContentPlanResult, PublishScope } from "../../../publish/content/ui/index.js";

/**
 * @file What `use-publish-content-confirm.hooks.ts` needs from the outside world, as an interface
 * rather than a direct `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented in
 * `development/docs/architecture/wired-hooks-convention.md` and mirrored in
 * `dashboard-port.hooks.ts`: this file declares, `publish-content-dependencies.hooks.ts` binds the
 * real `api` client, and nothing else under `features/publish-content` reaches `lib/api` for publishing.
 *
 * The split earns its keep twice over here. The routes behind `planPublish`/`confirmPublish`/
 * `executePublish` are Task 10's, landing in parallel with this dialog — the fake in the
 * dependencies module is what let the whole ceremony be built and tested before a single one of them
 * existed, and it is what made absorbing their real shape (peer in the PATH, `bundleId` carried from
 * plan into execute) a change to `lib/api.ts` and this interface rather than to the dialog.
 *
 * ## The credential rule, restated where it is easiest to break
 *
 * `PublishContentPeerView` carries `masked` and `hasCredential`. Those are the ONLY
 * credential-shaped fields that exist on the client at all. No method on this port takes a peer URL
 * or a secret, and none returns one: every call names a peer by `peerId` and the server resolves
 * the sealed material itself. Do not add a method that breaks that.
 */
export interface PublishContentPort {
  /** `publish_content.read`. */
  listPeers(): Promise<{ peers: readonly PublishContentPeerView[] }>;
  /**
   * `publish_content.apply`. Reads whether this install already has a connected destination, and if
   * not, the candidate pre-filled from the repo's own deploy config. The dialog calls this only when
   * {@link listPeers} came back empty — see `use-publish-content-confirm.hooks.ts`'s `connectOffer`
   * and `destination.ts`'s header for why the empty state offers connecting instead of failing shut.
   */
  getDestination(): Promise<AdminPublishDestinationView>;
  /**
   * `publish_content.apply`. The one action that turns a fresh install into a connected one — no key
   * is ever minted, displayed or copied (`ADS-memory/reports/
   * 2026-09-19-publish-zero-setup-auth-design.md`). `siteUrl` is optional; omitted, the server uses
   * its own candidate, which is the only path the dialog's connect action takes.
   */
  connectDestination(input: Record<string, never>, options?: { siteUrl?: string }): Promise<AdminPublishDestinationView>;
  /**
   * `publish_content.read` — pure planning, zero writes (`features/publish-content/planner.ts`).
   *
   * `selectedEntityKeys` is how a deselected row stops being published: it narrows the bundle the
   * destination is given to plan, so an excluded entity is never staged there at all. Omitted means
   * "everything", which is the first plan the dialog always asks for; a second, narrowed plan is
   * requested only when the operator actually unchecked something.
   *
   * `overwriteEntityKeys` (publish-overwrite-live-plan §4/S9) is the operator's ticked "Overwrite on
   * live" rows. `use-publish-content-confirm.hooks.ts` re-plans with this the moment a box is
   * ticked, independent of any `selectedEntityKeys` narrowing — the two combine, neither replaces the
   * other. `PublishContentPlanResult.overwriteEntityKeys` echoes exactly what was sent, and
   * `liveCanOverwrite` says whether the peer can honour it at all.
   *
   * `scope` (`plan-publish-sections-2026-09-25.md` §2 S2) is what dialog this is about — a section
   * button's "Publish pages", say. Unlike `selectedEntityKeys`, it is not something the operator can
   * change mid-dialog: the hook sends the SAME `scope` it was opened with on every call this method
   * makes, via its own `planInScope` helper.
   */
  planPublish(input: {
    peerId: string;
    selectedEntityKeys?: readonly string[];
    overwriteEntityKeys?: readonly string[];
    scope?: PublishScope;
  }): Promise<PublishContentPlanResult>;
  /** `publish_content.apply`. Issues the one token that authorizes an execute. */
  confirmPublish(input: { peerId: string; planId: string; planHash: string }): Promise<PublishContentConfirmResult>;
  /**
   * `publish_content.apply`. The only call in this port that writes anything.
   *
   * `bundleId` comes from {@link planPublish}'s own result and is not optional: the peer's
   * `/import/execute` refuses a confirmation token presented against any bundle but the one it
   * planned, so the client carries the value across the ceremony rather than the server keeping
   * implicit per-operator state between two requests.
   *
   * `overwriteEntityKeys` (S9) is always the CONFIRMED plan's own echoed value, never a fresh read of
   * operator state — see `use-publish-content-confirm.hooks.ts`'s execute effect.
   */
  executePublish(input: {
    peerId: string;
    bundleId: string;
    confirmationToken: string;
    overwriteEntityKeys?: readonly string[];
  }): Promise<PublishContentExecuteResult>;
}
