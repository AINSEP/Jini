import { useMemo, useRef, useState, type Dispatch, type SetStateAction, type RefObject } from "react";
import type { FetchQueryAdapter, MutationResult } from "@jini-ai/core/fetch";
import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { parseMediaHtmlAttributes } from "../../../media/index.js";
import { KEYS, describeMediaHtmlAttributeError, diffMediaMetadata, mediaCreatedByLabel, parseOptionalPixelSize, type MediaMetadataPatch } from "../rules.js";
import type { MediaPort } from "./media-port.hooks.js";

/**
 * @file Everything `EditMediaPanel` does, so the component in `Media.tsx` is only markup.
 *
 * Extracted verbatim — same state, same order, same error string. The doc comments below moved
 * WITH the values they describe; a comment separated from its code stops being read.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local
 * because nothing outside `features/media` needs it.
 *
 * `deps.port`/`deps.locale` are injected (see `media-port.hooks.ts`) rather than reaching for
 * `lib/api`'s `api` and `useAdminLocale()` directly, sharing the same `MediaPort` `use-media.hooks
 * .ts` injects — both hooks read/write the one `/media` resource.
 *
 * `publicUrl` (readable-slugs S5a, UI half, 2026-09-23) replaced this hook's old `originalUrl`
 * field, which read `port.mediaOriginalUrl(item.id)` — the authenticated admin byte route, the only
 * "where is this file" answer available before the server started resolving a real public URL (see
 * `lib/api.ts`'s `AdminMedia.publicUrl` doc for the full story: slug-keyed when the asset has a
 * valid one, else id-keyed, `null` for a trashed asset or when no public transform is registered).
 * `publicUrl` is a plain pass-through of `item.publicUrl` — no port call, since the server now
 * computes it directly (`ff6b713f0`). `MediaPreview`'s `<img>`/`<video>` `src`
 * (`use-media-preview.hooks.ts`) still uses `port.mediaOriginalUrl` — that route is a different
 * thing (an authenticated admin-only byte stream, not necessarily a link a visitor could follow) and
 * is unaffected by this change.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): `save` is one `useFetchMutation` that `invalidates:
 * [KEYS.list]` — this hook has no read of its own to invalidate (see `rules.ts`'s `KEYS` doc), so
 * there is no sibling-vs-nested key decision to make here at all, unlike `forms`/`collections`'
 * list-plus-detail-editor pairs.
 *
 * `baselineRef` (2026-08-12 audit round, media audit 2026-08-12-A — silent-revert lost update, media's
 * instance of the Comments defect): `diffMediaMetadata` must diff `draft` against the SAME snapshot
 * `draft` was seeded from, not the live `item` prop. `props.item` is NOT frozen — `use-media.hooks
 * .ts`'s `editingItem` is recomputed from `list.data` on every render, and `Media.tsx`'s
 * `key={editingItem.id}` only remounts this panel when the id itself changes, not when the SAME
 * item's other fields change via a background refetch (e.g. a different operator editing a
 * DIFFERENT field of this same asset while this panel is open, surfaced by any invalidating write
 * in this session — upload/trash/purge/another save all invalidate `KEYS.list`). Before this fix,
 * `save()` diffed `draft` against that live, drifting `item`: an untouched field whose server value
 * had since changed would show up as "changed" (draft's stale original vs the new live value) and
 * get wrongly included in the patch, silently reverting the other operator's committed change. See
 * `rules.ts`'s `diffMediaMetadata` doc for the other half of this fix.
 *
 * `htmlAttributesError` (2026-09-07): a LIVE, as-you-type hint only — computed from `draft
 * .htmlAttributes` via `rules.ts`'s `parseMediaHtmlAttributes`/`describeMediaHtmlAttributeError`,
 * shown so an operator sees why a value would be rejected before clicking Save. It must NEVER gate
 * `save()` (and `Media.tsx` must never disable the Save button on it either) — an earlier version of
 * this field did exactly that (`if (htmlAttributesError) return;` before `diffMediaMetadata` ever
 * ran, reverted as `a7cce060`), which meant an invalid attributes draft silently blocked saving
 * title/alt/caption/credit/cssClass too, fields with nothing to do with it. `save()` below always
 * runs `diffMediaMetadata` and submits unconditionally; if `htmlAttributes` itself is invalid, the
 * SERVER's `MediaValidationError` -> 400 (already wired, `updateMediaMetadata`'s
 * `resolveHtmlAttributesForUpdate`) surfaces through the same `error` save-error banner every other
 * save failure already uses — exactly how a malformed `slug` already works end to end.
 */

export interface EditMediaPanelHookProps {
  item: AdminMedia;
  onSaved: () => void;
  onCancel: () => void;
}

export interface EditMediaPanelDependencies {
  hooks: Pick<FetchQueryAdapter, "useFetchMutation" | "useFetchQuery">;
  deps: {
    port: MediaPort; locale: string;
    translate: (required: { locale: string; key: string }) => string;
    describeApiError: (required: { e: unknown; fallback: string }) => string;
    embedMarkerSnippet: (required: { type: "media"; key: "slug"; value: string }) => string;
    embedPolicy: Parameters<typeof parseMediaHtmlAttributes>[0]["policy"];
    writeText: (value: string) => Promise<void>;
    setTimeout: typeof globalThis.setTimeout;
  };
}

/**
 * Adds `description` to the metadata patch only when the operator edited it away from the stored
 * value. Untouched is omitted; blank over a stored description is an explicit clear (`""`); blank on
 * a never-described asset stays omitted, so nothing is fabricated.
 * @complexity O(1).
 */
export function withDescriptionPatch(
  required: { patch: MediaMetadataPatch; stored: string | undefined; edited: string | undefined },
  _optional: Record<string, never> = {},
): MediaMetadataPatch {
  const { patch, stored, edited } = required;
  if (edited === undefined) return patch;
  const next = edited.trim() === "" ? "" : edited;
  if (next === (stored ?? "")) return patch;
  return { ...patch, description: next };
}

/** The fields edited through the shared draft; `description` is tracked separately so an untouched one never reaches the patch. */
type MediaDraft = Required<Omit<MediaMetadataPatch, "description">>;

/** The shared draft seeded from the stored item (everything but `description`, which is tracked apart). @complexity O(1). */
function initialMediaDraft({ item }: { item: AdminMedia }, _optional: Record<string, never> = {}): MediaDraft {
  return {
    title: item.title,
    slug: item.slug,
    alt: item.alt,
    caption: item.caption,
    credit: item.credit,
    width: item.width,
    height: item.height,
    cssClass: item.cssClass,
    htmlAttributes: item.htmlAttributes,
  };
}

export interface EditMediaPanelController {
  draft: MediaDraft;
  /** The description as shown in the field: the stored text, or "" when never described. */
  description: string;
  setDescription: (value: string) => void;
  setTitle: (value: string) => void;
  /** `slug` is a SEPARATE field from `title` (2026-09-07) — see `AdminMedia.slug`'s own doc. Setting
   *  it here never touches `draft.title`, and vice versa. */
  setSlug: (value: string) => void;
  setAlt: (value: string) => void;
  setCaption: (value: string) => void;
  setCredit: (value: string) => void;
  /** `value` is the raw `<input type="number">` string; blank parses to `null` (native size) via
   *  `parseOptionalPixelSize` — see that helper's own doc. */
  setWidth: (value: string) => void;
  setHeight: (value: string) => void;
  setCssClass: (value: string) => void;
  /** Same undefined/null/value-trims-to-null contract as `setCssClass` — see `AdminMedia
   *  .htmlAttributes`'s own doc. */
  setHtmlAttributes: (value: string) => void;
  /** The specific, visible allowlist-rejection message for `draft.htmlAttributes`'s CURRENT value,
   *  or `null` when it parses clean (including empty/unset) — a live hint only, see this file's own
   *  header for why it must never gate `save()`. */
  htmlAttributesError: string | null;
  saving: boolean;
  error: string | null;
  /** Feedback for the sha256 copy affordance below — resets on its own so a stale "Copied" label
   *  never survives past the moment it's true, without needing the caller to clear it. */
  hashCopied: boolean;
  /** Same pattern as `hashCopied`, for the asset URL field below. Separate state because the two
   *  copy buttons can be clicked independently and each needs its own "Copied" label lifetime. */
  urlCopied: boolean;
  /** Same pattern again, for the "Copy embed code" button. */
  embedCopied: boolean;
  /** The asset's real, public `/m/...` URL — see `lib/api.ts`'s `AdminMedia.publicUrl` doc. `null`
   *  when the server has none to offer (trashed, or no public transform registered yet); `Media.tsx`
   *  hides the row entirely in that case rather than showing a dead link. */
  publicUrl: string | null;
  copyHash: () => Promise<void>;
  /** No-op when `publicUrl` is `null` — see `publicUrl`'s own doc for why that happens and why
   *  `Media.tsx` never renders this button in that state anyway; the guard is here too so a stray
   *  call is inert rather than handing the clipboard API a `null`. */
  copyUrl: () => Promise<void>;
  /** `embedMarkerSnippet({ type: "media", key: "slug", value: item.slug })` — see `@jini-ai/cms/widgets/markers`'s doc for the
   *  shared helper. Computed here (not in `Media.tsx`, which stays markup-only) so the panel can
   *  both display it (in a read-only `<code>`, same idiom as the sha256/URL rows) and copy it. */
  embedSnippet: string;
  /** Copies {@link embedSnippet}. Unlike `copyUrl`, this needs no null-guard: `item.slug` is always
   *  a non-empty string (uploads always derive one, `deriveUniqueMediaSlug`). */
  copyEmbedCode: () => Promise<void>;
  /** Read-only "Created by": the creator's username when this caller can list users, else the
   *  raw principal id; localized "Unknown" for legacy rows with no recorded creator. */
  createdByLabel: string;
  save: () => Promise<void>;
}

  function setTitle({ value, setDraft }: { value: string; setDraft: Dispatch<SetStateAction<MediaDraft>> }, _optional = {}) {
    setDraft((d) => ({ ...d, title: value }));
  }
  function setSlug({ value, setDraft }: { value: string; setDraft: Dispatch<SetStateAction<MediaDraft>> }, _optional = {}) {
    setDraft((d) => ({ ...d, slug: value }));
  }
  function setAlt({ value, setDraft }: { value: string; setDraft: Dispatch<SetStateAction<MediaDraft>> }, _optional = {}) {
    setDraft((d) => ({ ...d, alt: value }));
  }
  function setCaption({ value, setDraft }: { value: string; setDraft: Dispatch<SetStateAction<MediaDraft>> }, _optional = {}) {
    setDraft((d) => ({ ...d, caption: value }));
  }
  function setCredit({ value, setDraft }: { value: string; setDraft: Dispatch<SetStateAction<MediaDraft>> }, _optional = {}) {
    setDraft((d) => ({ ...d, credit: value }));
  }
  function setWidth({ value, setDraft }: { value: string; setDraft: Dispatch<SetStateAction<MediaDraft>> }, _optional = {}) {
    setDraft((d) => ({ ...d, width: parseOptionalPixelSize({ value }) }));
  }
  function setHeight({ value, setDraft }: { value: string; setDraft: Dispatch<SetStateAction<MediaDraft>> }, _optional = {}) {
    setDraft((d) => ({ ...d, height: parseOptionalPixelSize({ value }) }));
  }
  function setCssClass({ value, setDraft }: { value: string; setDraft: Dispatch<SetStateAction<MediaDraft>> }, _optional = {}) {
    setDraft((d) => ({ ...d, cssClass: value.trim() === "" ? null : value }));
  }
  function setHtmlAttributes({ value, setDraft }: { value: string; setDraft: Dispatch<SetStateAction<MediaDraft>> }, _optional = {}) {
    setDraft((d) => ({ ...d, htmlAttributes: value.trim() === "" ? null : value }));
  }

  async function copyHash({ item, setHashCopied, deps }: { item: AdminMedia; setHashCopied: Dispatch<SetStateAction<boolean>>; deps: EditMediaPanelDependencies["deps"] }, _optional = {}) {
    try {
      await deps.writeText(item.sha256);
      setHashCopied(true);
      deps.setTimeout(() => setHashCopied(false), 1500);
    } catch {
      // Clipboard access can be denied (permissions, insecure context) — the full hash is still
      // visible and selectable in the field itself, so a failed copy degrades to "select manually"
      // rather than losing the value.
    }
  }

  async function copyUrl({ publicUrl, setUrlCopied, deps }: { publicUrl: string | null; setUrlCopied: Dispatch<SetStateAction<boolean>>; deps: EditMediaPanelDependencies["deps"] }, _optional = {}) {
    if (publicUrl === null) return;
    try {
      await deps.writeText(publicUrl);
      setUrlCopied(true);
      deps.setTimeout(() => setUrlCopied(false), 1500);
    } catch {
      // Same degrade-to-select-manually reasoning as `copyHash` above — the link itself is still
      // there to click or select even if the clipboard write is denied.
    }
  }

  async function copyEmbedCode({ embedSnippet, setEmbedCopied, deps }: { embedSnippet: string; setEmbedCopied: Dispatch<SetStateAction<boolean>>; deps: EditMediaPanelDependencies["deps"] }, _optional = {}) {
    try {
      await deps.writeText(embedSnippet);
      setEmbedCopied(true);
      deps.setTimeout(() => setEmbedCopied(false), 1500);
    } catch {
      // Same degrade-to-select-manually reasoning as `copyHash`/`copyUrl` above — `Media.tsx` shows
      // the snippet itself in a read-only `<code>` next to this button (same `MediaEditCopyRow`
      // idiom as the other two rows), so a denied clipboard write never leaves the operator with no
      // way to get the value at all.
    }
  }

  async function save({ baselineRef, draft, editedDescription, onCancel, onSaved, saveMutation, item }: {
    baselineRef: RefObject<AdminMedia>; draft: MediaDraft; editedDescription: string | undefined;
    onCancel: () => void; onSaved: () => void; item: AdminMedia;
    saveMutation: MutationResult<{ target: { id: string }; patch: MediaMetadataPatch }, { media: AdminMedia }>;
  }, _optional = {}) {
    const patch = withDescriptionPatch({ patch: diffMediaMetadata({ item: baselineRef.current, draft }), stored: baselineRef.current.description, edited: editedDescription });
    if (Object.keys(patch).length === 0) {
      onCancel();
      return;
    }
    try {
      await saveMutation.mutate({ input: { target: { id: item.id }, patch } });
      onSaved();
    } catch {
      // already surfaced through saveMutation.error -> error below
    }
  }

export function useEditMediaPanel({ hooks, deps, ...props }: EditMediaPanelHookProps & EditMediaPanelDependencies, _optional = {}): EditMediaPanelController {
  const { port, locale } = deps; const { item, onSaved, onCancel } = props;
  const [draft, setDraft] = useState<MediaDraft>(() => initialMediaDraft({ item }));
  // Frozen at mount, exactly like `draft`'s own `useState` initializer above — `useRef(item)` only
  // reads its argument on the FIRST render, so this stays the value `draft` was seeded from even as
  // `props.item` keeps advancing underneath it. See this file's own header.
  const baselineRef = useRef<AdminMedia>(item);
  // `undefined` until the operator types, so an untouched field never reaches the patch.
  const [editedDescription, setEditedDescription] = useState<string | undefined>(undefined);
  const saveMutation = hooks.useFetchMutation({
    run: ({ input }: { input: { target: { id: string }; patch: MediaMetadataPatch } }) => port.updateMedia(input.target, input.patch),
  }, {
    invalidates: [KEYS.list],
  });
  const [hashCopied, setHashCopied] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  // See this file's header for why `publicUrl` is a plain read of the server-computed field, not a
  // port call.
  const publicUrl = item.publicUrl;
  const embedSnippet = deps.embedMarkerSnippet({ type: "media", key: "slug", value: item.slug });
  const htmlAttributesParsed = parseMediaHtmlAttributes({ text: draft.htmlAttributes ?? "", policy: deps.embedPolicy });
  const htmlAttributesError = htmlAttributesParsed.error
    ? describeMediaHtmlAttributeError({ error: htmlAttributesParsed.error, locale, translate: deps.translate })
    : null;
  const error = saveMutation.error ? deps.describeApiError({ e: saveMutation.error, fallback: deps.translate({ locale: locale, key: "failed to save media metadata" }) }) : null;
  const creators = hooks.useFetchQuery({
    key: ["media", "creator-names"],
    fetch: () => (port.listUsers ? port.listUsers() : Promise.resolve({ users: [] })),
  }, {
    enabled: Boolean(item.createdBy),
  });
  const userNames = useMemo(
    () => new Map((creators.data?.users ?? []).map((user) => [user.principalId, user.username] as const)),
    [creators.data],
  );
  const createdByLabel = mediaCreatedByLabel({ item, unknownLabel: deps.translate({ locale: locale, key: "Unknown" }) }, { userNames });
  return {
    draft,
    setTitle: value => setTitle({ value, setDraft }), setSlug: value => setSlug({ value, setDraft }),
    setAlt: value => setAlt({ value, setDraft }), setCaption: value => setCaption({ value, setDraft }), setCredit: value => setCredit({ value, setDraft }),
    description: editedDescription ?? baselineRef.current.description ?? "", setDescription: setEditedDescription,
    setWidth: value => setWidth({ value, setDraft }), setHeight: value => setHeight({ value, setDraft }),
    setCssClass: value => setCssClass({ value, setDraft }), setHtmlAttributes: value => setHtmlAttributes({ value, setDraft }),
    htmlAttributesError, saving: saveMutation.status === "pending", error, hashCopied, urlCopied, embedCopied, publicUrl, embedSnippet,
    copyHash: () => copyHash({ item, setHashCopied, deps }), copyUrl: () => copyUrl({ publicUrl, setUrlCopied, deps }),
    copyEmbedCode: () => copyEmbedCode({ embedSnippet, setEmbedCopied, deps }), createdByLabel,
    save: () => save({ baselineRef, draft, editedDescription, onCancel, onSaved, saveMutation, item }),
  };
}

export function bindEditMediaPanel({ hooks, deps }: {
  hooks: EditMediaPanelDependencies["hooks"] & { useLocaleHook: () => string };
  deps: Omit<EditMediaPanelDependencies["deps"], "locale">;
}, _optional = {}) {
  return function useBoundEditMediaPanel(props: EditMediaPanelHookProps, _optional = {}): EditMediaPanelController {
    const locale = hooks.useLocaleHook();
    return useEditMediaPanel({ ...props, hooks, deps: { ...deps, locale } });
  };
}
