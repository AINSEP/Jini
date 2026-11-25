import { useCallback as useQueryFetchCallback } from "react";
import type { FetchQueryAdapter } from "@jini-ai/core/fetch";
import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import type { Translate } from "@jini-ai/core/text";

interface MediaPickerPort {
  listMedia(): Promise<{ media: AdminMedia[] }>;
  mediaOriginalUrl(required: { id: string }, optional?: Record<string, never>): string;
}

/**
 * @file `MediaPickerDialog`'s data-fetch and selection state, split out of the component so
 * it can be swapped for a fake via the `useDialog` prop on `MediaPickerDialogProps` — see that
 * prop's doc comment in `MediaPickerDialog.tsx`. Same split `ConfirmDialog`/`ConfirmDialog.hooks.tsx`
 * uses in `@jini-ai/admin`.
 *
 * `useMediaPickerDialog` takes `onSelect`/`onCancel` in an input object rather than the
 * whole `MediaPickerDialogProps` object — mirrors `useConfirmDialog`'s primitives-in shape there,
 * and avoids a type-only import cycle back into `MediaPickerDialog.tsx` for the `useDialog` prop's
 * own type (`typeof useWiredMediaPickerDialog`). Historically the Escape listener listed `onCancel`
 * as a dependency (2026-08-21 lint pass) and rebound whenever its identity changed — every real
 * caller passes a fresh arrow per render, so the listener is torn down and re-added on those
 * renders; the `document.removeEventListener`/`addEventListener` pair in the same synchronous
 * effect run keeps that rebind unobservable (no double-fire, no dropped Escape). This closes the
 * stale-closure gap the old mount-once `[]` had — a caller could previously escape-cancel into a
 * `onCancel` captured from an earlier render. Phase 17 removes that listener entirely: Jini's
 * native dialog receives the current callback directly, so this reason still applies without
 * maintaining a second document subscription.
 *
 * `port` is injected (see `media-picker-port.hooks.ts`) rather than reaching for `lib/api`'s `api`
 * directly, so a test can describe "these items are available" against `createFakeMediaPickerPort`
 * instead of stubbing global `fetch`/spying on `api.listMedia`. `describeApiError` stays a direct
 * import — pure, no host boundary.
 */

/**
 * Fetches the workspace's active media once per mount — mirrors `useExistingInstances`'s exact
 * shape (`null` while loading, a describable `error` string on failure).
 *
 * @param input.port - Injected `MediaPickerPort` — see `media-picker-port.hooks.ts`.
 * @param options.locale - Translates the `describeApiError` fallback via `shared-components-i18n.ts`'s `t`.
 *   Defaults to `DEFAULT_LOCALE` ("en"), which renders the same English fallback as before this
 *   parameter existed — mirrors `useExistingInstances`'s identical `locale` parameter in
 *   `WidgetPickerDialog.hooks.tsx`.
 * @returns `items` (`null` while the fetch is in flight, otherwise the loaded, active-only list)
 *   and `error` (a describable failure message, or `null`).
 */
export function useMediaPickerItems({ port, locale, useFetchQueryHook, describeError, translate }: {
  port: MediaPickerPort; locale: string; useFetchQueryHook: FetchQueryAdapter["useFetchQuery"];
  describeError: (required: { e: unknown; fallback: string }) => string;
  translate: (required: { locale: string; key: string }) => string;
}, _optional: Record<string, never> = {}) {
  const queryFetch = useQueryFetchCallback(async () => {
    try { return await port.listMedia(); }
    catch (error) { throw new Error(describeError({ e: error, fallback: translate({ locale, key: "failed to load media" }) })); }
  }, [port, locale]);
  const query = useFetchQueryHook({ key: ["media"], fetch: queryFetch }, { staleTime: 0 });
  const items = query.data?.media.filter(item => item.status === "active") ?? null;
  const error = query.error?.message ?? null;
  return { items, error };
}

/** The legacy grid's half of `MediaPickerDialogProps.accept` — Jini's own `acceptsMedia` rule, so
 *  this dialog and the Jini picker (handed the same `accept` list) can never disagree on a type.
 *  `null` (still loading) passes through.
 *  @complexity O(n · a) for n items and a accept entries. */
export function acceptedMediaItems({ items, acceptsMedia }: { items: AdminMedia[] | null; acceptsMedia: (required: { item: AdminMedia; accept: readonly string[] }) => boolean }, { accept = [] }: { accept?: readonly string[] } = {}): AdminMedia[] | null {
  return items && items.filter((item) => acceptsMedia({ item, accept }));
}

/** What {@link useMediaPickerDialog} (and {@link useWiredMediaPickerDialog}) hands back to
 *  `MediaPickerDialog.tsx` — the dialog's full render-time contract. */
export interface MediaPickerDialogController {
  items: AdminMedia[] | null;
  error: string | null;
  select: (item: AdminMedia) => void;
  /** Synchronous URL builder for a thumbnail's `<img src>`, forwarded straight from the injected
   *  {@link MediaPickerPort} — see that port's own `mediaOriginalUrl` doc for why a pure URL
   *  template still crosses this seam rather than staying a direct `lib/api` import in the
   *  component. */
  mediaOriginalUrl: (required: { id: string }, optional?: Record<string, never>) => string;
  /** Bound to `deps.locale` (or `DEFAULT_LOCALE`) via `shared-components-i18n.ts`'s `t` — see this
   *  file's header for why it's resolved here rather than at each call site. */
  t: Translate;
  /** The locale `t` above is bound to — same parity reasoning as `WidgetPickerDialogController`'s
   *  own `locale` field. */
  locale: string;
}

/**
 * Owns selection on top of {@link useMediaPickerItems}; Jini now owns native cancellation
 * and focus management. Split out for the same reason
 * `useWidgetPickerDialog` is — a render-free unit to test the interaction logic against.
 *
 * Focus management (2026-09-16 fix — no dialog wrapper or focus/blur handling existed at all
 * before this): Jini now captures whatever had focus on mount and moves focus onto Cancel (a stable
 * target present regardless of loading/error/empty/populated state); on unmount, restores focus
 * to what was captured. Without this, closing left focus on `<body>` — a keyboard/screen-reader
 * user was dropped to the top of the page instead of back at the control that opened the dialog.
 *
 * @param input.onSelect - Called with the chosen item when a thumbnail is clicked.
 * @param input._onCancel - Retained for the existing hook ABI; the component forwards cancellation to Jini.
 * @param input.deps - Injected `{ port?; locale? }` — both optional/defaulted, mirroring
 *   `useWidgetPickerDialog`'s identical shape in `WidgetPickerDialog.hooks.tsx`. `port` defaults to
 *   {@link defaultMediaPickerPort} and `locale` to `DEFAULT_LOCALE`, so every existing call site
 *   that still passes only `{ port: fakePort }` keeps compiling and behaving unchanged.
 * @returns The dialog's full render-time contract — see {@link MediaPickerDialogController}.
 */
export function useMediaPickerDialog(
  { onSelect, _onCancel, deps, useFetchQueryHook, describeError, translate }: {
    onSelect: (item: AdminMedia) => void; _onCancel: () => void; deps: { port: MediaPickerPort; locale: string };
    useFetchQueryHook: FetchQueryAdapter["useFetchQuery"];
    describeError: (required: { e: unknown; fallback: string }) => string;
    translate: (required: { locale: string; key: string }) => string;
  },
  _options: Record<string, never> = {},
): MediaPickerDialogController {
  const port = deps.port;
  const locale = deps.locale;
  const t: Translate = (key) => translate({ locale: locale, key: key });
  const { items, error } = useMediaPickerItems({ port, locale, useFetchQueryHook, describeError, translate });
  // Jini captures at mount, before focus moves onto Cancel — the element that had focus then is,
  // by construction, whatever opened this dialog (e.g. the Posts/Pages editor's "Insert from Media
  // Library" toolbar button). Restored on unmount. This component is only ever rendered while the
  // dialog is open (the caller conditionally mounts it, per `MediaPickerDialog.tsx`'s own doc
  // comment), so mount/unmount IS the open/close transition — same technique `ConfirmDialog`
  // (`@jini-ai/admin`) and this app's own `useMediaLightbox` use for an always-mounted native
  // `<dialog>`'s `showModal()`/`close()` pair. The component marks Cancel with Jini's autofocus
  // attribute so it remains the stable target even while media is loading or the fetch fails.

  return { items, error, select: onSelect, mediaOriginalUrl: port.mediaOriginalUrl, t, locale };
}

