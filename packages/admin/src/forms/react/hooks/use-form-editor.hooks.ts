import type { AdminFormsPort } from "../../../core/ports/forms.js";
import { formView } from "../../models.js";
import { useFormsPorts, useFormsOptions } from "./FormsPorts.hooks.js";
import { useController } from "../../../core/react/use-controller.js";
import { createFormEditorController, initialFormEditorState, type FormEditorState } from "../../controllers/form-editor.controller.js";
import { formHtmlEmbed, formAnswerColumns, type FormAnswerColumn } from "../../html-rules.js";
import { useEffect, useRef } from "react";
import type { AdminFormDefinition, AdminFormField, AdminFormNotify } from "../../models.js";
import { useFetchMutation, useFetchQuery } from "@jini-ai/ui/fetch-query";
import { FORM_TABS, KEYS, existingFieldIdsOf, nextTabIndex, visibleFormEditorError } from "../../rules.js";

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
  /** Bound translator — see this file's own header for why it arrives via the hook rather than
   *  `FormEditor.tsx` calling `useAdminLocale()`/`FORMS_DICT` directly. */
  t: (key: string) => string;
}

export function useFormEditor(
  props: { formId: string; tab: "fields" | "submissions"; port: AdminFormsPort; navigate: (path: string) => void; t: (key: string) => string },
  { clipboard }: { clipboard?: { writeText: (text: string) => Promise<void> } } = {},
): FormEditorController {
  const { port, navigate, t } = props;
  const { tab } = props;
  const isNew = props.formId === "new";
  const { controller: stateController, snapshot: stateSnapshot } = useController({ create: () => createFormEditorController({}), dependencies: [] });
  const state = stateSnapshot ?? initialFormEditorState({});
  const form = state.form;
  const setForm = (value: FormEditorStateValue<"form">) => stateController?.update({ key: "form", value });
  const mode = state.mode;
  const html = state.html;
  const setHtml = (value: FormEditorStateValue<"html">) => stateController?.update({ key: "html", value });
  const copyFeedback = state.copyFeedback;
  const setCopyFeedback = (value: FormEditorStateValue<"copyFeedback">) => stateController?.update({ key: "copyFeedback", value });
  const name = state.name;
  const setName = (value: FormEditorStateValue<"name">) => stateController?.update({ key: "name", value });
  const slug = state.slug;
  const setSlug = (value: FormEditorStateValue<"slug">) => stateController?.update({ key: "slug", value });
  const fields = state.fields;
  const setFields = (value: FormEditorStateValue<"fields">) => stateController?.update({ key: "fields", value });
  // No UI edits this (owner ask 2026-09-22 removed the notify checkbox/recipients input from the
  // Fields tab — a future outside mail integration will design its own way to set it). Seeded from
  // the loaded form and carried through unchanged on every save, so an operator saving a form never
  // wipes out a `notify` setting that predates this UI removal. Lives in the section controller, not a
  // `const`, only so `handleSave`'s existing-form branch can resync it from the write's own response
  // exactly like `form`/`name`/`slug`/`fields` already do below.
  const notify = state.notify;
  // Roving-tabindex focus targets for the tab strip below, indexed the same as `FORM_TABS` — see
  // `nextTabIndex`'s doc comment for why the index math itself lives outside the component.
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const list = useFetchQuery({ key: KEYS.form(props.formId), fetch: () => port.getFormDefinition({ id: props.formId }).then(form => ({ data: formView({ form }) })) }, { enabled: !isNew });

  // Seeds `form`/`name`/`slug`/`fields`/`notify` from `list.data` exactly once per `formId` — see
  // this file's own header for the regression this guards against (a background refetch of the SAME
  // formId must not clobber in-progress edits).
  const seededFormIdRef = useRef<string | null>(null);
  const seededControllerRef = useRef<typeof stateController>(null);
  useEffect(() => {
    if (seededControllerRef.current !== stateController) { seededControllerRef.current = stateController; seededFormIdRef.current = null; }
    if (seededFormIdRef.current !== props.formId) seededFormIdRef.current = null;
    if (!stateController) return;
    if (isNew || list.status === "loading" || !list.data) return;
    if (seededFormIdRef.current === props.formId) return;
    seededFormIdRef.current = props.formId;

    const loaded = list.data.data;
    stateController.seed({ form: loaded });
  }, [props.formId, isNew, list.status, list.data, stateController]);

  // None of these invalidate `KEYS.form(props.formId)` — only `KEYS.list`. `handleSave`/
  // `handleStatusToggle` below already set `form` (and, for save, the rest of the seeded fields)
  // directly from each mutation's own response, so invalidating this hook's OWN read key would only
  // buy a redundant background refetch of data already in hand — the same reasoning
  // `use-collection-entry-editor.hooks.ts`'s `save()`/`toggleLifecycle()` document for why THEIR
  // `invalidates` names only the sibling `KEYS.entries(...)`, never their own `KEYS.entry(...)`.
  const updateMutation = useFetchMutation({
    run: ({ input }: { input: { name: string; fields: AdminFormField[]; notify: AdminFormNotify; mode?: "builder" | "html"; html?: string | undefined } }) =>
      // Targets the loaded record's real id, never `props.formId` directly — the admin URL now
      // carries the form's slug when one resolves (ui-fixes-backlog.md #8), so `props.formId` may
      // itself BE that slug. `form.id` is always the real id regardless of which one the URL held,
      // which is what lets the PUT route stay id-only (no matching slug support needed — see
      // `get-by-id.ts`'s own comment on why only the GET route resolves either). The `?? props
      // .formId` fallback only matters if this ever fired before `form` loaded, which it can't:
      // `FormEditor.tsx`'s `!isNew && !form` guards keep the whole editor (Save button included)
      // off-screen until `form` is set.
      port.updateFormDefinition({ id: form?.id ?? props.formId }, input),
  }, {
    invalidates: [KEYS.list],
  });
  const createMutation = useFetchMutation({
    run: ({ input }: { input: { name: string; slug: string; fields: AdminFormField[]; notify: AdminFormNotify; mode?: "builder" | "html"; html?: string | undefined } }) =>
      port.createFormDefinition({ name: input.name, slug: input.slug, fields: input.fields, ...(input.mode ? { mode: input.mode, html: input.html } : {}) }, { notify: input.notify }),
  }, {
    invalidates: [KEYS.list],
  });
  const statusMutation = useFetchMutation({
    run: ({ input }: { input: { id: string; status: "active" | "disabled" } }) => port.updateFormDefinition({ id: input.id }, { status: input.status }),
  }, {
    invalidates: [KEYS.list],
  });

  function onModeChange(next: "builder" | "html") {
    stateController?.changeMode({ mode: next }, { submitLabel: t("Send") });
  }

  async function copyEmbed() {
    if (!form) return;
    try {
      await (clipboard ?? navigator.clipboard).writeText(formHtmlEmbed({ slug: form.slug }));
      setCopyFeedback(t("Copied!"));
    } catch { setCopyFeedback(t("Could not copy embed")); }
  }

  async function handleSave() {
    // Ordinary Builder saves keep their existing endpoint/permissions. A mode change is explicit.
    const authoring = mode === "html" ? { mode, html } : form?.mode === "html" ? { mode } : {};
    try {
      if (isNew) {
        // `notify` here is always this hook's own blank default — a new form has no earlier value
        // to carry through, and there is no UI on this screen to set one instead.
        const created = await createMutation.mutate({ input: { name, slug, fields, notify, ...authoring } });
        // Slug, not id — see this hook's own file header / `get-by-id.ts` for the id-or-slug
        // resolution this now lands on (ui-fixes-backlog.md #8).
        navigate(`/forms/${created.slug}`);
      } else {
        // `notify` is the value this hook seeded from the loaded form and has never changed since —
        // sent back unchanged so saving name/slug/field edits can never wipe a stored notify setting
        // (see this hook's own `notify` state comment).
        // Set directly from the write's own response — `updateMutation` doesn't invalidate this
        // hook's own `KEYS.form(id)` read (see the mutations' own comment above), so there is no
        // background refetch to wait for or to accidentally clobber an in-progress edit with.
        // Mirrors `use-collection-entry-editor.hooks.ts`'s `save()`.
        const updatedCore = await updateMutation.mutate({ input: { name, fields, notify, ...authoring } });
        const updated = formView({ form: updatedCore });
        stateController?.seed({ form: updated });
      }
    } catch {
      // already surfaced through updateMutation.error/createMutation.error -> error below
    }
  }

  async function handleStatusToggle() {
    if (!form) return;
    try {
      const updatedCore = await statusMutation.mutate({ input: {
        id: form.id,
        status: form.status === "active" ? "disabled" : "active",
      } });
      setForm(formView({ form: updatedCore }));
    } catch {
      // already surfaced through statusMutation.error -> error below
    }
  }

  const saving = updateMutation.status === "pending" || createMutation.status === "pending" || statusMutation.status === "pending";
  const error = visibleFormEditorError({
    updateError: updateMutation.error,
    createError: createMutation.error,
    statusError: statusMutation.error,
    listError: list.error,
    hasForm: form !== null,
    saveFallback: t("save failed"),
    statusUpdateFallback: t("status update failed"),
    loadFormFallback: t("failed to load form"),
  });

  // Navigates to `/forms/:formId` or `/forms/:formId/submissions` (ADR-063) — `panels.tsx`'s
  // `forms` panel keys `FormEditor` off `ctx.params.formId` on BOTH routes, so this is a route
  // change, not a remount: in-progress Fields edits survive a trip to Submissions and back.
  function onTabChange(nextTab: "fields" | "submissions") {
    navigate(nextTab === "submissions" ? `/forms/${props.formId}/submissions` : `/forms/${props.formId}`);
  }

  function onTabsKeyDown(e: React.KeyboardEvent) {
    const currentIndex = FORM_TABS.findIndex((t) => t.id === tab);
    const index = nextTabIndex({ key: e.key, currentIndex });
    if (index === null) return;
    e.preventDefault();
    onTabChange(FORM_TABS[index]!.id);
    tabRefs.current[index]?.focus();
  }

  return {
    isNew,
    form,
    mode, onModeChange, html, setHtml, copyEmbed, copyFeedback,
    answerColumns: formAnswerColumns({ fields: form?.fields ?? [] }),
    name,
    setName,
    slug,
    setSlug,
    fields,
    setFields,
    tab,
    onTabChange,
    error,
    saving,
    existingFieldIds: existingFieldIdsOf({ form }),
    showTabs: !isNew && form !== null,
    tabRefs,
    onTabsKeyDown,
    handleSave,
    handleStatusToggle,
    t,
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
type FormEditorStateValue<K extends keyof FormEditorState> = FormEditorState[K] | ((current: FormEditorState[K]) => FormEditorState[K]);

export function useWiredFormEditor(props: { formId: string; tab: "fields" | "submissions" }, _optional = {}): FormEditorController {
  const { formsApi, formsNavigation } = useFormsPorts();
  const { t, clipboard, adminBase } = useFormsOptions();
  const navigate = (routePath: string) => {
    if (!formsNavigation) throw new Error('Missing forms navigation port');
    formsNavigation.navigate({ base: adminBase, routePath });
  };
  return useFormEditor({ ...props, port: formsApi, navigate, t }, clipboard ? { clipboard } : {});
}
