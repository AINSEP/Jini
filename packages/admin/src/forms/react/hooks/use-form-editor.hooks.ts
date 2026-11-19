import type { FormProviderDescription } from "@jini-ai/core/contracts/forms";
import type { AdminFormProviderSelection, AdminFormsPort } from "../../../core/ports/forms.js";
import type { FormsCatalogPort } from "../../../core/ports/forms-catalog.js";
import { formView } from "../../models.js";
import { describeApiError } from '@jini-ai/core/admin-runtime';
import { useFormsPorts, useFormsOptions } from "./FormsPorts.hooks.js";
import { useFormsController } from "./FormsPorts.hooks.js";
import { createFormEditorController, initialFormEditorState } from "../../controllers/form-editor.controller.js";
import { formAnswerColumns, type FormAnswerColumn } from "../../html-rules.js";
import type { AdminFormDefinition, AdminFormField } from "../../models.js";
import { existingFieldIdsOf } from "../../rules.js";
import {
  useFormEditorActions, useFormEditorLeave, useFormEditorMutations, useFormEditorOutcome, useFormEditorQueries, useFormEditorSeed, useFormEditorSetters, useFormEditorTabs,
} from "./use-form-editor-parts.hooks.js";

/**
 * @file Everything the FormEditor SCREEN does — load, save, status toggle, and the Fields/
 * Submissions tab strip's roving-tabindex focus management — so `FormEditor`'s exported component
 * in `FormEditor.tsx` is only markup.
 *
 * Moved from the host — same load effect, same save/status-toggle error strings, same "later failure
 * keeps the editor on screen" guard (the audit-blocker fix this screen's file header describes —
 * see `FormEditor.tsx`'s own header for the full rationale, which stays with the guard in the view
 * since it describes render behaviour, not this hook's state).
 *
 * `tab` (ADR-063, 2026-08-31): no longer local state — it is `props.tab`, derived from the route
 * (`/forms/:formId` vs `/forms/:formId/submissions`) by `panels.tsx`/`FormEditor.tsx`. Switching
 * tabs calls the injected `navigate` (real app router), the same idiom `Deployment.tsx`'s tab strip
 * uses, rather than a local `setTab` — Submissions has its own independent fetch, so a tab switch
 * is a genuine route change, not a display-layer filter over data already in hand.
 *
 * `tabRefs` moves here too, per Pattern 1 (every `useRef` moves with state/effects, not just
 * `useState`) — the view still attaches each button via its own `ref` callback (an unavoidably
 * DOM-side operation), but the ref array itself and the keydown-to-focus-change logic
 * (`onTabsKeyDown`) are behaviour, not markup.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/forms` needs it.
 *
 * `port`/`navigate` are injected — see `core/ports/forms.ts` (shared with `use-forms-list.hooks.ts`,
 * since both read/write the same `AdminFormDefinition` resource) — rather than reaching `lib/api`/
 * `lib/router` directly, so a test can describe load/save outcomes against `the memory adapter`
 * instead of stubbing global `fetch`. `useWiredFormEditor` below is the zero-argument pair
 * `FormEditor.tsx` actually mounts.
 *
 * `t` (standing i18n rule — a component with a hook gets a BOUND `t` from that hook, not its own
 * `useAdminLocale()`/dictionary import, same shape `use-post-editor.hooks.ts` established for this
 * conversion): injected alongside `port`/`navigate` because `FormEditor.tsx` itself (the copy
 * around this hook's own state — tab labels, Save button, etc.) DOES need translated strings, even
 * though this hook's own error messages don't. Pre-bound to `(key: string) => string`.
 * `useAdminLocale()` and `FORMS_DICT` are called/read only inside {@link useWiredFormEditor}.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): the load is one `useFetchQuery` keyed on
 * `KEYS.form(formId)` (disabled for `isNew`, matching the original `if (isNew) return;` early-out).
 * `form`/`name`/`slug`/`fields`/`notify` live in the section controller — the operator edits `name`/`slug`/
 * `fields`; `notify` has no UI of its own (owner ask 2026-09-22 removed the notify checkbox/
 * recipients input — see this file's own `notify` state comment) and is only ever carried through
 * unchanged. All are seeded from `list.data` exactly once per `formId` via `seededFormIdRef`, the
 * same shape `collections/hooks/use-collection-entry-editor.hooks.ts`'s `seededIdentityRef`
 * establishes (see that file's header for the regression it guards against: a background refetch of
 * the SAME identity must not clobber in-progress edits). `handleSave`/`handleStatusToggle` set `form`
 * (and, for save, the rest of the seeded fields) directly from each MUTATION's own response, and
 * neither mutation invalidates this hook's OWN `KEYS.form(formId)` read (only the sibling
 * `KEYS.list`) — mirroring `save()`/`toggleLifecycle()` in that same collections hook, which
 * invalidate only the sibling `KEYS.entries(...)`, never their own `KEYS.entry(...)`, for the
 * identical reason: a response already in hand needs no redundant background refetch of itself. This
 * eliminates the load race an external audit flagged at this file's old line 117 (`useEffect(load,
 * [props.formId, port])` with no cancellation guard, so a formId change mid-flight could commit a
 * stale response): a keyed query cannot commit a response belonging to a prior key, by construction.
 */

export interface FormEditorController {
  isNew: boolean;
  /** `null` until the initial load settles (or always, for `isNew`) — the caller renders a loading
   *  state or the empty create form accordingly. */
  form: AdminFormDefinition | null;
  providers?: readonly FormProviderDescription[] | undefined;
  providersError?: string | null;
  provider: AdminFormProviderSelection;
  setProvider: (value: AdminFormProviderSelection) => void;
  name: string;
  setName: (value: string) => void;
  slug: string;
  setSlug: (value: string) => void;
  mode: "builder" | "html";
  onModeChange: (mode: "builder" | "html") => void;
  html: string;
  setHtml: (html: string) => void;
  copyEmbed: () => void;
  copyFeedback: string | null;
  answerColumns: FormAnswerColumn[];
  fields: AdminFormField[];
  setFields: (fields: AdminFormField[]) => void;
  tab: "fields" | "submissions";
  /** Navigates to this form's Fields or Submissions route — real `navigate()`, not local state
   *  (ADR-063: Submissions has its own independent fetch, so a tab switch is a genuine route
   *  change, the same idiom `Deployment.tsx`'s tab strip uses). Pushes a history entry (no
   *  `replace`) so browser back/forward move naturally between the two routes, unlike the
   *  `?tab=` screens' `replace: true` view-filter switches. */
  onTabChange: (tab: "fields" | "submissions") => void;
  error: string | null;
  saving: boolean;
  /** Already-persisted field ids on the loaded form — see `existingFieldIdsOf`. */
  existingFieldIds: string[];
  /** Tabs render only for an existing, loaded form — never for `isNew`, and never before `form`
   *  has loaded. */
  showTabs: boolean;
  /** Per-tab-button refs, indexed the same as `FORM_TABS` — attach via each button's own `ref`
   *  callback in the view. */
  tabRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
  /** Roving-tabindex keydown handler for the tablist `<div>` — ArrowLeft/ArrowRight/Home/End move
   *  both the selected tab and DOM focus together. */
  onTabsKeyDown: (e: React.KeyboardEvent) => void;
  handleSave: () => void;
  handleStatusToggle: () => void;
  /** Back with unsaved edits opens an app confirm modal instead of discarding them silently
   *  (Chrome check, 2026-10-11). `onBack` routes through the injected navigation port;
   *  only a dirty draft requires confirmation. */
  leave: { confirmOpen: boolean; onBack: (event: { preventDefault: () => void }) => void; confirm: () => void; cancel: () => void };
  /** Bound translator — see this file's own header for why it arrives via the hook rather than
   *  `FormEditor.tsx` calling `useAdminLocale()`/`FORMS_DICT` directly. */
  t: (key: string) => string;
}

/** Load and save the editor through its injected port, preserving authoring and collection metadata.
 * @complexity O(f + b) draft state for fields/HTML bytes; one definition request per save, no provider I/O.
 * @overallScore 95 — Low: the existing screen lifecycle remains one hook with independently tested callbacks. */
export function useFormEditor(
  props: { formId: string; tab: "fields" | "submissions"; port: AdminFormsPort; catalog: FormsCatalogPort; navigate: (path: string) => void; t: (key: string) => string },
  { clipboard }: { clipboard?: { writeText: (text: string) => Promise<void> } } = {},
): FormEditorController {
  const { port, catalog, navigate, t, tab } = props;
  const isNew = props.formId === "new";
  const { controller: stateController, snapshot: stateSnapshot } = useFormsController({ create: () => createFormEditorController({ catalog }), dependencies: [] });
  const state = stateSnapshot ?? initialFormEditorState({});
  const { form, mode, html, copyFeedback, name, slug, fields, provider } = state;
  const setters = useFormEditorSetters({ stateController });
  // No UI edits `notify` (owner ask 2026-09-22 removed the notify checkbox/recipients input from the
  // Fields tab — a future outside mail integration will design its own way to set it). Seeded from
  // the loaded form and carried through unchanged on every save, so an operator saving a form never
  // wipes out a `notify` setting that predates this UI removal. Lives in the section controller, not a
  // `const`, only so `handleSave`'s existing-form branch can resync it from the write's own response
  // exactly like `form`/`name`/`slug`/`fields` already do below.
  const { discovery, list } = useFormEditorQueries({ port, formId: props.formId, isNew });
  useFormEditorSeed({ stateController, formId: props.formId, isNew, list });
  const mutations = useFormEditorMutations({ port, form, formId: props.formId });
  const actions = useFormEditorActions({ isNew, state, stateController, setters, mutations, navigate, t, clipboard });
  const leave = useFormEditorLeave({ state, isNew, navigate });
  const { saving, error } = useFormEditorOutcome({ mutations, list, form, t });
  const tabs = useFormEditorTabs({ tab, formId: props.formId, navigate });

  return {
    isNew,
    form, provider, setProvider: setters.setProvider,
    providers: discovery.data?.data,
    providersError: discovery.error ? `${t("Could not load form providers")}: ${describeApiError({ e: discovery.error, fallback: t("The settings service did not respond. Try opening this editor again.") })}` : null,
    mode, onModeChange: actions.onModeChange, html, setHtml: setters.setHtml, copyEmbed: actions.copyEmbed, copyFeedback,
    answerColumns: formAnswerColumns({ fields: form?.fields ?? [] }, { yes: t("Yes"), no: t("No") }),
    name, setName: setters.setName, slug, setSlug: setters.setSlug, fields, setFields: setters.setFields,
    tab, onTabChange: tabs.onTabChange, error, saving,
    existingFieldIds: existingFieldIdsOf({ form }),
    showTabs: !isNew && form !== null,
    tabRefs: tabs.tabRefs, onTabsKeyDown: tabs.onTabsKeyDown,
    handleSave: actions.handleSave, handleStatusToggle: actions.handleStatusToggle,
    leave, t,
  };
}

/**
 * Binds the real `/api/.../forms` client, `lib/router`'s `navigate`, and a `FORMS_DICT`-bound
 * translator — see `adapters/http.ts`.
 *
 * The zero-argument-deps half of the `useX(dependencies)` / `useWiredX()` pair, so
 * `FormEditor.tsx` composes this and a test composes {@link useFormEditor} with
 * `the memory adapter`, a fake `navigate`, and a fake `t`.
 */
export function useWiredFormEditor(props: { formId: string; tab: "fields" | "submissions" }, _optional = {}): FormEditorController {
  const { formsApi, formsCatalog, formsNavigation } = useFormsPorts();
  const { t, clipboard, adminBase } = useFormsOptions();
  const navigate = (routePath: string) => {
    if (!formsNavigation) throw new Error('Missing forms navigation port');
    formsNavigation.navigate({ base: adminBase, routePath });
  };
  return useFormEditor({ ...props, port: formsApi, catalog: formsCatalog, navigate, t }, clipboard ? { clipboard } : {});
}
