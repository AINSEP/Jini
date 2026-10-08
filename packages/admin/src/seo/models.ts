import type { AdminSeoSettings, AdminSeoSettingsPatch, AdminSeoMeta, AdminSeoAnalysis, AdminSeoOverridesPatch, AdminSeoEntryChoice } from '../core/ports/seo.js';
import type { MediaAsset } from '../contracts/media-picker.js';
import type { SitemapUrlEntry } from './rules.js';
export type SeoSettings = AdminSeoSettings;
export type SeoSettingsPatch = AdminSeoSettingsPatch;
export type SeoEntryMeta = AdminSeoMeta;
export type SeoEntryAnalysis = AdminSeoAnalysis;
export type SeoEntryOverridesPatch = AdminSeoOverridesPatch;
export type SeoIssue = import('../core/ports/seo.js').AdminSeoIssue;
/** Extra host fields survive picker reads; only id/title/status participate in rendering. */
export type AdminPost = AdminSeoEntryChoice & {
  readonly workspaceId?: string; readonly kind?: string; readonly slug?: string;
  readonly bodyJson?: unknown; readonly updatedAt?: string; readonly version?: number;
};
/** The existing picker returns its media row unchanged; slug is an optional projection. */
export interface SeoMediaSelection extends MediaAsset {
  readonly slug?: string; readonly workspaceId?: string; readonly caption?: string; readonly credit?: string;
  readonly sha256?: string; readonly status?: string; readonly createdAt?: string; readonly updatedAt?: string;
  readonly version?: number; readonly width?: number | null; readonly height?: number | null;
  readonly cssClass?: string | null; readonly htmlAttributes?: string | null;
}
export type AdminMedia = SeoMediaSelection;
export type SeoTranslator = (key: string, vars?: Record<string, string | number>) => string;
/** Host API error classes remain host-owned; format their empty-message semantics at the seam. */
export type SeoErrorFormatter = (required: { error: unknown; fallback: string }, optional?: Record<string, never>) => string;

export interface SeoController {
  settings: SeoSettings | null;
  error: string | null;
  saving: boolean;
  notice: string | null;
  /** Takes a `SeoSettingsPatch` rather than a `Partial<SeoSettings>` so an emptied optional field
   *  can send `null` and actually clear its site default — `setSeoSettings` is a merge, so an
   *  omitted key means "unchanged" (see the core port's `AdminSeoSettingsPatch`). */
  save: (patch: SeoSettingsPatch) => Promise<void>;
  /** The site-wide default OG/Twitter image field's own controlled value (MediaRefField picker
   *  support, 2026-09-05) — every OTHER default on this screen stays an uncontrolled `defaultValue`
   *  (read via `FormData` on submit, `react/pages/SeoPage.tsx`'s own file header), but a picker needs somewhere to
   *  WRITE a selection into, which an uncontrolled input has no seam for. Re-synced from `settings`
   *  whenever it (re)loads — including after a successful save, so the field reflects what was
   *  actually persisted rather than the operator's last unsaved edit. `""` until settings load. */
  defaultOgImage: string;
  setDefaultOgImage: (value: string) => void;
  /** Resolves `true` on success, `false` on a caught failure (`error` is set either way this
   *  already did) — `SitemapModal.tsx`'s own footer Regenerate button uses the boolean to decide
   *  whether to refetch `/sitemap.xml`, so a failed attempt never re-fetches the same stale
   *  content. The pre-existing caller, `react/pages/SeoPage.tsx`'s own Regenerate button, still just fires this as
   *  a plain `onClick` and discards the return value — this is a widening, not a breaking change. */
  regenerateSitemap: () => Promise<boolean>;
  /** Whether `SitemapModal.tsx` ("View sitemap") is open. `react/pages/SeoPage.tsx` stays markup-only (this file's
   *  own header) by keeping this state here alongside the rest of the screen's state, the same way
   *  `SeoEntrySection`'s own `entryId` selection lives in `useSeoEntrySection` rather than in
   *  `react/pages/SeoPage.tsx` itself. */
  sitemapModalOpen: boolean;
  openSitemapModal: () => void;
  closeSitemapModal: () => void;
  /** Legacy component metadata retained for the copied render contract. Translation is always
   *  taken from the injected module t function, never from a package-owned locale dictionary. */
  locale: string;
}


export interface EntryPickerController {
  entries: readonly AdminPost[] | null;
  error: string | null;
}


export interface SeoEntryPanelOptions {
  entryId: string;
}

export interface SeoEntryPanelController {
  resolved: SeoEntryMeta | null;
  analysis: SeoEntryAnalysis | null;
  loadError: string | null;
  saving: boolean;
  saveError: string | null;
  notice: string | null;
  /** Reads back whatever the operator touched for `key`, falling back to the resolved
   *  (server-effective) value for any field not yet edited this session. A field the operator
   *  EMPTIED reads back as `null` (the pending clear), which `react/pages/SeoPage.tsx`'s own `?? ""` renders as an
   *  empty box — so the field the operator cleared stays cleared on screen. */
  fieldValue: <K extends keyof SeoEntryOverridesPatch>(key: K, resolvedValue: SeoEntryOverridesPatch[K]) => SeoEntryOverridesPatch[K];
  setField: <K extends keyof SeoEntryOverridesPatch>(key: K, value: SeoEntryOverridesPatch[K]) => void;
  save: () => Promise<void>;
  /** The patch `save` will PUT — only the fields the operator actually touched this session, with
   *  `null` for each one they emptied. An untouched field is ABSENT, never `null`: "unchanged" must
   *  never become "clear". */
  touched: SeoEntryOverridesPatch;
}


export interface SeoEntrySectionController {
  entryId: string;
  setEntryId: (entryId: string) => void;
}


export type SitemapModalView = "table" | "raw";
/** `"disabled"` is a real, terminal state, not a stalled `"loading"`: with `sitemapEnabled` false the
 *  modal deliberately never fetches, so there is nothing in flight to be loading. Naming it keeps
 *  `SitemapModal.tsx`'s header honest — `sitemapModalTitle`/`SitemapModalHeaderActions` both key off
 *  `status === "ready"`, so a URL count and the raw/table toggle stay off a sitemap that is off. */
export type SitemapModalStatus = "disabled" | "loading" | "error" | "ready";

/** What {@link useSitemapModal} needs from its caller. An object rather than trailing positional
 *  parameters specifically so the `SitemapModal.tsx` `useModal` test seam forwards it whole: a
 *  positional `enabled` can be silently dropped by a shorter test double (TypeScript accepts a
 *  function of fewer parameters), which is exactly how the "this never fetches" claim below went
 *  untested while the fetch fired on every open. */
export interface SitemapModalInputs {
  /** `settings.sitemapEnabled` — when `false`, `/sitemap.xml` is never requested at all. */
  enabled: boolean;
  /** Retained for the existing hook ABI; SitemapModal forwards close directly to Jini. */
  onClose: () => void;
}

/** What {@link useSitemapModal} (and {@link useWiredSitemapModal}) hands back to
 *  `SitemapModal.tsx` — the modal's full render-time contract. */
export interface SitemapModalController {
  status: SitemapModalStatus;
  /** A describable failure message, set only while `status === "error"`. */
  error: string | null;
  /** The exact response text from `GET /sitemap.xml`, set only while `status === "ready"`. */
  xmlText: string;
  /** Every parsed `<url>` entry, unfiltered — `SitemapModal.tsx`'s header URL count reads this. */
  entries: SitemapUrlEntry[];
  /** `entries` narrowed by {@link filter}. */
  filteredEntries: SitemapUrlEntry[];
  filter: string;
  setFilter: (value: string) => void;
  view: SitemapModalView;
  setView: (view: SitemapModalView) => void;
  /** Re-runs the fetch — `SitemapModal.tsx`'s footer Regenerate button calls this after a
   *  successful regenerate, so the count/table/raw view all reflect the freshly rebuilt sitemap
   *  without the operator closing and reopening the modal. */
  refetch: () => void;
}


export interface MediaRefFieldController {
  /** Whether `MediaPickerDialog` is open. */
  pickerOpen: boolean;
  openPicker: () => void;
  closePicker: () => void;
  /** `MediaPickerDialog`'s `onSelect` — writes the exact `{slug}:public` ref
   *  (`buildMediaRef`, `rules.ts`, readable-slugs S5b) into the field and closes the dialog. */
  handleSelect: (item: SeoMediaSelection) => void;
  /** Clears the field to `""` — an OG image must be removable (SPEC intent). */
  clear: () => void;
  /** The field's current value resolved to a thumbnail `<img src>`, or `null` when the value is
   *  empty or unparseable — see `resolveMediaRefPreviewUrl`'s own doc. */
  previewUrl: string | null;
  /** `MediaPickerDialog`'s `accept` — images only: every field this backs is an og:image /
   *  twitter:image, and a crawler cannot use a video there (2026-10-05, same filter the post
   *  featured-image chooser passes). */
  accept: readonly string[];
}


export type SeoState = Omit<SeoController, 'save' | 'setDefaultOgImage' | 'regenerateSitemap' | 'openSitemapModal' | 'closeSitemapModal' | 'locale'>;
export type SeoEntryState = Pick<SeoEntryPanelController, 'resolved' | 'analysis' | 'loadError' | 'saving' | 'saveError' | 'notice' | 'touched'>;
export interface SitemapState { status: SitemapModalStatus; error: string | null; xmlText: string; filter: string; view: SitemapModalView }
export const initialSeoState: SeoState = { settings: null, error: null, saving: false, notice: null, defaultOgImage: '', sitemapModalOpen: false };
export const initialSeoEntryState: SeoEntryState = { resolved: null, analysis: null, loadError: null, saving: false, saveError: null, notice: null, touched: {} };
export const initialEntryPickerState: EntryPickerController = { entries: null, error: null };
/** Error messages remain visible; the host transport owns decoding its API errors. */
export function describeSeoError({ error, fallback }: { error: unknown; fallback: string }, _optional: Record<string, never> = {}): string {
  return error instanceof Error ? error.message : fallback;
}
