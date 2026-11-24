import type { WidgetDocRendering } from "../doc/doc-render-contract.js";
import type { DocNodeHost } from "../doc/doc-render-contract.js";
import type { MarkerAttribute } from "../../../../../widgets/markers/index.js";
import type { renderGallery } from "../../../../../widgets/html/gallery-render.js";
import type { renderMediaRawHtml, MediaHtmlEvent } from "../../../../../widgets/html/media-html.js";
import type { formatDateLabel } from "../../../../../widgets/date-label.js";
import type { renderEntryList, renderEntryListStructuredData } from "../../../../../listing/index.js";
import type { COLLECTION_LIST_FAQ_PAGE, isCollectionListLayout } from "../../../../../entries/site/contracts.js";
import type { stampFormFieldMaxLengths, renderFormSuccessSlot, renderFormErrorSlot } from "../../../../../forms/form-controls.js";
import type { fieldMaxChars } from "../../../../../forms/field-length-caps.js";
import type { renderFormCollection, renderHtmlForm, renderHtmlFormBody, renderFormSchemaHash } from "../../../../../forms/html-render.js";

/** What the `media` / `gallery` / `media-image` widget renderers need from their host, bound once by
 *  the host's composition (media tag rendering and URL policy live in the `media` / `widgets`
 *  domains, and the Raw HTML diagnostics sink is host-owned — the pipeline reports and never logs). */
export interface WidgetMediaHost {
  readonly media: Pick<DocNodeHost["media"], "renderImageTag" | "renderVideoTag" | "mediaPublicPath" | "mediaUrlKey" | "plausibleMediaRefId">;
  /** The "no marker attributes" value (`NO_MARKER_ATTRIBUTES`), returned for a malformed `markerAttributes` prop. */
  readonly noMarkerAttributes: readonly MarkerAttribute[];
  readonly renderGallery: typeof renderGallery;
  readonly renderMediaRawHtml: typeof renderMediaRawHtml;
  /** Receives the Raw HTML pipeline's `{ code, detail }` events (dropped markup, kind mismatch, unknown slug). */
  readonly report: (event: MediaHtmlEvent) => void;
}

/** The class names the entries widgets (`social-links`, `recent-entries`, `entry-summary`) emit; the
 *  host's theme CSS targets them, so the widgets carry no class name of their own. Each value is the
 *  full `class` attribute text (a list class may carry several tokens). */
export interface WidgetEntriesClasses {
  /** `<ul>` of the `social-links` widget. */
  readonly socialList: string;
  /** `<a>` of each social link. */
  readonly socialLink: string;
  /** `<ul>` of the `list` layout of `recent-entries`. */
  readonly recentList: string;
  /** `<li>` of each entry in a list, and of an `entry-summary`. */
  readonly entrySummary: string;
  /** `<li>` of the empty state. */
  readonly empty: string;
}

/** The `recent-entries` widget's collaborators: the entry-list renderer (`listing` domain), the
 *  collection-list vocabulary (`entries` domain) and the host's own entry-list marker attribute. */
export interface WidgetEntriesHost {
  readonly renderEntryList: typeof renderEntryList;
  readonly renderEntryListStructuredData: typeof renderEntryListStructuredData;
  readonly isCollectionListLayout: typeof isCollectionListLayout;
  readonly collectionListFaqPage: typeof COLLECTION_LIST_FAQ_PAGE;
  /** The attribute the host's entry-list stylesheet and style-injection check look for. */
  readonly entryListAttribute: string;
  /** The class names the entries widgets emit (see {@link WidgetEntriesClasses}). */
  readonly classes: WidgetEntriesClasses;
}

/** The class names the `post-content` widget emits (the host's post theme CSS targets them). */
export interface WidgetPostContentClasses {
  /** The header block (title and meta). */
  readonly header: string;
  /** The date and byline row inside the header. */
  readonly meta: string;
  /** The body block. */
  readonly body: string;
}

/** The `post-content` widget's collaborators: the date policy (host-owned, `widgets` domain label)
 *  and the class names the widget emits. */
export interface WidgetPostContentHost {
  /** The class names the widget emits (see {@link WidgetPostContentClasses}). */
  readonly classes: WidgetPostContentClasses;
  readonly formatDateLabel: typeof formatDateLabel;
  /** The go-live time when the post has one, else its last-saved time. */
  readonly postDisplayDateIso: (required: { publishAt: string | null; updatedAt: string }, optional?: Record<string, never>) => string;
}

/** The legacy class and attribute names, and the fallback copy, the host's form stylesheet and scripts
 *  target. Jini defaults to its own `jini-*` names elsewhere; this widget emits exactly what it is
 *  handed here. */
export interface ContactFormPresentation {
  /** Class on every `<form>` (`FORM_CLASS`). */
  readonly formClass: string;
  /** Class on the error slot (`FORM_ERROR_CLASS`). */
  readonly errorClass: string;
  /** The built-in shell's generic widget class, placed before `formClass` (e.g. `widget`). */
  readonly widgetClass: string;
  /** The built-in shell's own form class, placed after `formClass`. */
  readonly contactFormClass: string;
  /** Extra class on the built-in shell's success slot. */
  readonly successExtraClass: string;
  /** Extra class on the built-in shell's error slot. */
  readonly errorExtraClass: string;
  /** The built-in shell's submit button label. */
  readonly submitLabel: string;
  /** The success message shown when the widget has no `successMessage` prop of its own. */
  readonly successMessageFallback: string;
  /** The baseline `<style>` every form-rendering widget carries. */
  readonly baselineStyle: string;
  /** The inline `<script>` appended after a form that has a range field. */
  readonly rangeReadoutScript: string;
  readonly fieldClasses: {
    readonly fieldClass: string;
    readonly fieldHelpClass: string;
    readonly errorClass: string;
    readonly fieldCheckboxClass: string;
  };
  /** The `data-*` hook attributes the renderers stamp on fields, the form, and its result slots. */
  readonly hooks: { readonly field: string; readonly form: string; readonly success: string; readonly error: string };
}

/** The `contact-form` widget's collaborators: the `forms` domain renderers, the host's presentation
 *  names, and the id allocator (each embed occurrence gets its own prefix, nothing retained). */
export interface ContactFormWidgetHost {
  readonly forms: {
    readonly stampFormFieldMaxLengths: typeof stampFormFieldMaxLengths;
    readonly renderFormSuccessSlot: typeof renderFormSuccessSlot;
    readonly renderFormErrorSlot: typeof renderFormErrorSlot;
    readonly fieldMaxChars: typeof fieldMaxChars;
    readonly renderFormCollection: typeof renderFormCollection;
    readonly renderHtmlForm: typeof renderHtmlForm;
    readonly renderHtmlFormBody: typeof renderHtmlFormBody;
    readonly renderFormSchemaHash: typeof renderFormSchemaHash;
  };
  readonly presentation: ContactFormPresentation;
  /** A fresh unique token for one embed occurrence's id prefix (host binds a UUID source). */
  readonly newOccurrenceId: () => string;
}

/** Every widget-renderer collaborator group, bound once by the host's composition. */
export interface WidgetRenderHost {
  readonly media: WidgetMediaHost;
  readonly entries: WidgetEntriesHost;
  readonly postContent: WidgetPostContentHost;
  readonly contactForm: ContactFormWidgetHost;
}

export type { WidgetDocRendering };
