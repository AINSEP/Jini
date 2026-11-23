import { useState } from "react";

import type { AdminContentType, ContentTypeLifecycleOp } from "../api/collections-api.types.js";
import { useFetchMutation, useFetchQuery } from "../../../react/kit.js";
import { collectionEmbedSnippet, isUserCollection, KEYS, type LifecycleConfirmOp } from "../rules.js";
import type { CollectionsHostKit } from "../collections-host-kit.js";
import type { CollectionsPort } from "./collections-port.hooks.js";

/**
 * @file Everything the Collections LIST screen (content-type registry + the three dialogs' open/
 * close state) does, so `Collections`'s exported component in `Collections.tsx` is only markup.
 *
 * Extracted verbatim — same state, same load, same lifecycle-action error handling. Each dialog's
 * OWN state (`NewContentTypeDialog`, `EditFieldsDialog`, `LifecycleConfirmDialog`) lives in its own
 * hook file — this hook only owns which dialog is open and the shared `runLifecycle` action all
 * three lifecycle row-menu items and the confirm dialog ultimately call.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/collections` needs it.
 *
 * `port`/`locale` are injected — see `collections-port.hooks.ts` — rather than reaching `lib/api`/
 * `useAdminLocale()` directly, so a test can describe load/lifecycle outcomes against
 * `createFakeCollectionsPort` instead of stubbing global `fetch`. The host's `useWiredCollections`
 * is the pair `Collections.tsx` actually mounts.
 *
 * `t` (standing i18n rule, 2026-08-11 — a component with a hook gets a BOUND `t` from that hook,
 * not its own `useAdminLocale()`/dictionary import, same shape `use-pages.hooks.ts` established):
 * injected alongside `port`/`locale` because `Collections.tsx` and its three dialogs need translated
 * UI copy. `collections-i18n.ts`'s own `t({ locale, key })` — aliased `translate` here to avoid
 * colliding with this file's own bound `({ key }) => string` closure — now arrives through `deps.kit.translate`
 * — it is a pure `COLLECTIONS_DICT[locale]?.[key] ?? key` lookup that already takes `locale`
 * as an explicit argument, not a host reach (see wired-hooks-convention.md's "pure, no-I/O rules"
 * carve-out). `useAdminLocale()` and `COLLECTIONS_DICT` are read only inside
 * the host's `useWiredCollections` binding, which also passes `kit` (`collections-host-kit.ts`:
 * dictionary + request-error copy) and `lifecycleFailureMessage` (the host's lifecycle-failure copy).
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): the content-type list read is now `useFetchQuery({ key:
 * KEYS.list, ... })`; `runLifecycle` is a `useFetchMutation` that `invalidates: [KEYS.list]` — which
 * cascades to every entries list and open entry editor too, per `rules.ts`'s `KEYS` doc, since a
 * lifecycle change (or a field-schema edit via `EditFieldsDialog`) can change what those screens show.
 */

export interface CollectionsController {
  /** `null` until the initial load settles — the caller renders a loading state. */
  types: AdminContentType[] | null;
  error: string | null;
  showNewDialog: boolean;
  setShowNewDialog: (show: boolean) => void;
  /** The lifecycle op a row-menu selection is asking to confirm, and which content type it targets
   *  — `null` when `LifecycleConfirmDialog` is closed. Reactivate skips this entirely (see
   *  `runLifecycle`'s call sites): only Deprecate/Tombstone are confirm-gated. */
  pendingLifecycle: { op: LifecycleConfirmOp; contentType: AdminContentType } | null;
  setPendingLifecycle: (value: { op: LifecycleConfirmOp; contentType: AdminContentType } | null) => void;
  /** The content type `EditFieldsDialog` is open for — `null` when it is closed. */
  editingFieldsFor: AdminContentType | null;
  setEditingFieldsFor: (value: AdminContentType | null) => void;
  actionError: string | null;
  load: () => void;
  runLifecycle: (contentType: AdminContentType, op: ContentTypeLifecycleOp) => Promise<void>;
  /** The content-type key whose "Copy embed code" button most recently wrote to the clipboard —
   *  `null` once the transient window elapses. Keyed by `key`, not a single boolean, so only the
   *  row that was actually clicked shows "Copied". */
  copiedKey: string | null;
  /** Set when the most recent copy attempt could not reach the clipboard (denied permission, or no
   *  Clipboard API in an insecure context): the row it names shows `snippet` as selectable text so
   *  the operator can copy it by hand instead of getting a silent dead click. `null` otherwise; a
   *  later successful copy clears it. */
  copyFallback: { key: string; snippet: string } | null;
  /** Writes `collectionEmbedSnippet({ key: contentType.key })` to the clipboard and flips `copiedKey` for
   *  1.5s, mirroring `use-edit-media-panel.hooks.ts`'s `copyHash`/`copyUrl` precedent. A failed
   *  write sets {@link copyFallback} instead — this row has no visible snippet text of its own. */
  copyEmbedCode: (contentType: AdminContentType) => Promise<void>;
  /** Bound translator — `Collections.tsx`'s and its three dialogs' only source of UI copy; see this
   *  file's own header for why it arrives via the hook rather than direct `useAdminLocale()`. */
  t: (required: { key: string }, optional?: Record<string, never>) => string;
  /** The raw resolved locale — exposed only because `contentTypeMenuItems` (`../rules.ts`)
   *  genuinely needs it, not `t`, same "row-menu builder is a different, out-of-scope thing"
   *  precedent `use-pages.hooks.ts` cites for `pageRowMenuItems`. */
  locale: string;
}

export interface CollectionsDependencies {
  port: CollectionsPort;
  locale: string;
  t: (required: { key: string }, optional?: Record<string, never>) => string;
  /** The host's collections dictionary and request-error copy — see `collections-host-kit.ts`. */
  kit: CollectionsHostKit;
  /** The host's copy for a failed lifecycle op on one content type. */
  lifecycleFailureMessage: (required: { locale: string; op: ContentTypeLifecycleOp; label: string }) => string;
}

export function useCollections(
  { port, locale, t, kit, lifecycleFailureMessage }: CollectionsDependencies,
  _optional: Record<string, never> = {},
): CollectionsController {
  const list = useFetchQuery({ key: KEYS.list, fetch: () => port.listContentTypes() });
  // System types (`widget`/`widget_area`/`menu`) back platform mechanics, not a collection an
  // operator manages here — never shown on this screen.
  const types = list.data?.items ? list.data.items.filter((ct) => isUserCollection({ key: ct.key })) : null;

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [pendingLifecycle, setPendingLifecycle] = useState<{ op: LifecycleConfirmOp; contentType: AdminContentType } | null>(null);
  const [editingFieldsFor, setEditingFieldsFor] = useState<AdminContentType | null>(null);
  // The op/label the CURRENTLY (or most recently) in-flight `runLifecycle` call was for — needed
  // because `lifecycleFailureMessage` names both, but `pendingLifecycle` is the CONFIRM DIALOG's own
  // state and is `null` for Reactivate (never confirm-gated — see `runLifecycle`'s call sites), so it
  // cannot be reused here without misattributing a failed Reactivate's message to "deprecate".
  const [lastAttempt, setLastAttempt] = useState<{
    op: ContentTypeLifecycleOp;
    contentType: AdminContentType;
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyFallback, setCopyFallback] = useState<{ key: string; snippet: string } | null>(null);

  const lifecycleMutation = useFetchMutation({
    run: ({ input }: { input: { key: string; op: ContentTypeLifecycleOp; expectedVersion: number } }) =>
      port.contentTypeLifecycle(input),
  }, {
    invalidates: [KEYS.list],
  });

  async function runLifecycle(contentType: AdminContentType, op: ContentTypeLifecycleOp) {
    setLastAttempt({ op, contentType });
    try {
      await lifecycleMutation.mutate({ input: { key: contentType.key, op, expectedVersion: contentType.version } });
    } catch {
      // already surfaced through lifecycleMutation.error -> actionError below
    }
  }

  async function copyEmbedCode(contentType: AdminContentType): Promise<void> {
    const snippet = collectionEmbedSnippet({ key: contentType.key });
    try {
      await navigator.clipboard.writeText(snippet);
      setCopyFallback(null);
      setCopiedKey(contentType.key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      // Clipboard access denied, or `navigator.clipboard` absent (insecure context) — show the
      // snippet for manual selection; see `CollectionsController.copyFallback`.
      setCopyFallback({ key: contentType.key, snippet });
    }
  }

  const error = list.error ? kit.describeApiError({ e: list.error, fallback: kit.translate({ locale: locale, key: "failed to load content types" }) }) : null;
  const actionError =
    lifecycleMutation.error && lastAttempt
      ? kit.describeApiError({ e: lifecycleMutation.error, fallback: lifecycleFailureMessage({ locale, op: lastAttempt.op, label: lastAttempt.contentType.label }) })
      : null;

  return {
    types,
    error,
    showNewDialog,
    setShowNewDialog,
    pendingLifecycle,
    setPendingLifecycle,
    editingFieldsFor,
    setEditingFieldsFor,
    actionError,
    load: list.refetch,
    runLifecycle,
    copiedKey,
    copyFallback,
    copyEmbedCode,
    t,
    locale,
  };
}

