import type { AdminFormProviderSelection, AdminFormsPort, AdminFormUpdatePatch } from "../../../core/ports/forms.js";
import { createFormEditorController, type FormEditorState } from "../../controllers/form-editor.controller.js";
import { formEditorBaseline, formEditorDraft } from "../../form-editor-dirty.js";
import { formHtmlEmbed } from "../../html-rules.js";
import { formSaveInput, isVersionConflict, sameFormDefinition } from "../../form-editor-refresh.js";
import type { FormEditorGeneration, FormEditorRefresh, TaggedFormRead } from "./use-form-editor-refresh.hooks.js";
import { formView, type AdminFormDefinition, type AdminFormField, type AdminFormNotify } from "../../models.js";
import { FORM_TABS, KEYS, nextTabIndex, visibleFormEditorError } from "../../rules.js";
import { useRef, useState } from "react";
import { useDirtyGuard, useFetchMutation, useFetchQuery } from "../../../react/kit.js";

/**
 * @file The sub-hooks `useFormEditor` is assembled from: query loading (the version-aware refresh
 * that replaced the once-per-`formId` seed lives in `use-form-editor-refresh.hooks.ts`), the three mutations, the save/status/copy actions, the leave confirmation and the tab strip.
 * Split out of `use-form-editor.hooks.ts` so each stays under the function-size limit; the state
 * they share still lives in the one section controller that hook creates.
 */

export type FormEditorStateValue<K extends keyof FormEditorState> = FormEditorState[K] | ((current: FormEditorState[K]) => FormEditorState[K]);
export type EditorStateController = ReturnType<typeof createFormEditorController> | null;
type Translate = (key: string) => string;
type Navigate = (path: string) => void;
type Authoring = { provider?: AdminFormProviderSelection; mode?: "builder" | "html"; html?: string | undefined };
type SaveInput = { id?: string | undefined; patch: AdminFormUpdatePatch };
type FormEditorSnapshot = Pick<FormEditorState, "form" | "mode" | "html" | "name" | "slug" | "fields" | "notify" | "provider">;

/** One setter per editable key of the section controller. */
export function useFormEditorSetters({ stateController }: { stateController: EditorStateController }, _optional = {}) {
  return {
    setProvider: (value: AdminFormProviderSelection) => stateController?.update({ key: "provider", value }),
    setForm: (value: FormEditorStateValue<"form">) => stateController?.update({ key: "form", value }),
    setHtml: (value: FormEditorStateValue<"html">) => stateController?.update({ key: "html", value }),
    setCopyFeedback: (value: FormEditorStateValue<"copyFeedback">) => stateController?.update({ key: "copyFeedback", value }),
    setName: (value: FormEditorStateValue<"name">) => stateController?.update({ key: "name", value }),
    setSlug: (value: FormEditorStateValue<"slug">) => stateController?.update({ key: "slug", value }),
    setFields: (value: FormEditorStateValue<"fields">) => stateController?.update({ key: "fields", value }),
  };
}

/** Provider discovery and the form definition read (disabled for a new form). */
export function useFormEditorQueries({ port, formId, isNew, generation }: { port: AdminFormsPort; formId: string; isNew: boolean; generation: FormEditorGeneration }, _optional = {}) {
  const discovery = useFetchQuery({ key: ["forms", "providers"], fetch: async () => {
    if (!port.listFormProviders) throw new Error("Form provider settings are unavailable.");
    return { data: await port.listFormProviders({}) };
  } });
  // Tagged at fetch start with the requested route and its generation, so the refresh rule can tell
  // a read begun before a write or a route change from one it may apply.
  const list = useFetchQuery({ key: KEYS.form(formId), fetch: (): Promise<TaggedFormRead> => {
    const read = generation.readTag();
    return port.getFormDefinition({ id: formId }).then(form => ({ data: formView({ form }), read }));
  } }, { enabled: !isNew });
  return { discovery, list };
}

/** The update, create and status-toggle mutations. */
export function useFormEditorMutations({ port, formId }: { port: AdminFormsPort; formId: string }, _optional = {}) {
  // None of these invalidate `KEYS.form(props.formId)` — only `KEYS.list`. `handleSave`/
  // `handleStatusToggle` below already set `form` (and, for save, the rest of the seeded fields)
  // directly from each mutation's own response, so invalidating this hook's OWN read key would only
  // buy a redundant background refetch of data already in hand — the same reasoning
  // `use-collection-entry-editor.hooks.ts`'s `save()`/`toggleLifecycle()` document for why THEIR
  // `invalidates` names only the sibling `KEYS.entries(...)`, never their own `KEYS.entry(...)`.
  const updateMutation = useFetchMutation({
    run: ({ input }: { input: SaveInput }) =>
      // Targets the loaded record's real id, never `props.formId` directly — the admin URL now
      // carries the form's slug when one resolves (ui-fixes-backlog.md #8), so `props.formId` may
      // itself BE that slug. `input.id` (captured with the basis from the same applied snapshot as the
      // draft) is always the real id regardless of which one the URL held,
      // which is what lets the PUT route stay id-only (no matching slug support needed — see
      // `get-by-id.ts`'s own comment on why only the GET route resolves either). The `?? props
      // .formId` fallback only matters if this ever fired before `form` loaded, which it can't:
      // `FormEditor.tsx`'s `!isNew && !form` guards keep the whole editor (Save button included)
      // off-screen until `form` is set.
      port.updateFormDefinition({ id: input.id ?? formId }, input.patch),
  }, {
    invalidates: [KEYS.list],
  });
  const createMutation = useFetchMutation({
    run: ({ input }: { input: { name: string; slug: string; fields: AdminFormField[]; notify: AdminFormNotify } & Authoring }) =>
      port.createFormDefinition({ name: input.name, slug: input.slug, fields: input.fields, ...(input.provider ? { provider: input.provider } : {}), ...(input.mode ? { mode: input.mode, html: input.html } : {}) }, { notify: input.notify }),
  }, {
    invalidates: [KEYS.list],
  });
  const statusMutation = useFetchMutation({
    run: ({ input }: { input: { id: string; status: "active" | "disabled" } }) => port.updateFormDefinition({ id: input.id }, { status: input.status }),
  }, {
    invalidates: [KEYS.list],
  });
  return { updateMutation, createMutation, statusMutation };
}

type EditorActionDeps = {
  isNew: boolean; state: FormEditorSnapshot; stateController: EditorStateController; setters: ReturnType<typeof useFormEditorSetters>;
  mutations: ReturnType<typeof useFormEditorMutations>; navigate: Navigate; t: Translate;
  generation: FormEditorGeneration; refresh: Pick<FormEditorRefresh, "applyIncoming" | "conflict" | "afterWrite">;
  clipboard: { writeText: (text: string) => Promise<void> } | undefined;
};

async function copyEmbed({ state, setters, t, clipboard }: EditorActionDeps) {
  if (!state.form) return;
  try {
    await (clipboard ?? navigator.clipboard).writeText(formHtmlEmbed({ slug: state.form.slug }));
    setters.setCopyFeedback(t("Copied!"));
  } catch { setters.setCopyFeedback(t("Could not copy embed")); }
}

async function handleCreate({ state, mutations, navigate }: EditorActionDeps) {
  const { slug } = state;
  // Same authoring rule as an update with nothing saved yet: HTML mode is explicit, and a
  // non-built-in collection is carried. A new form has no basis to send.
  const { patch: { name, fields, notify, mode, html, provider } } = formSaveInput({ state: { ...state, form: null } });
  const authoring = { ...(mode ? { mode, html } : {}), ...(provider ? { provider } : {}) };
  try {
    // `notify` here is always this hook's own blank default — a new form has no earlier value
    // to carry through, and there is no UI on this screen to set one instead.
    const created = await mutations.createMutation.mutate({ input: { name, slug, fields, notify, ...authoring } });
    // Slug, not id — see this hook's own file header / `get-by-id.ts` for the id-or-slug
    // resolution this now lands on (ui-fixes-backlog.md #8).
    navigate(`/forms/${created.slug}`);
  } catch {
    // already surfaced through createMutation.error -> error below
  }
}

async function handleSave(deps: EditorActionDeps) {
  const { isNew, state, stateController, mutations, generation, refresh } = deps;
  if (isNew) { await handleCreate(deps); return; }
  // `notify` is the value seeded from the loaded form and never changed since — sent back unchanged
  // so saving name/slug/field edits can never wipe a stored notify setting. The real id and the
  // basis come from the same applied snapshot as this draft (see `formSaveInput`).
  const input = formSaveInput({ state });
  const write = generation.beginWrite();
  let response: Awaited<ReturnType<typeof mutations.updateMutation.mutate>> | undefined;
  let failure: unknown;
  try { response = await mutations.updateMutation.mutate({ input }); } catch (error) { failure = error; }
  // A route change since the Save began makes this another form's completion: never seed it.
  if (!generation.settleWrite(write)) return;
  // Seeded from the write's own response — `updateMutation` doesn't invalidate this hook's own
  // `KEYS.form(id)` read, so there is no redundant background refetch of data already in hand.
  if (response) stateController?.seed({ form: formView({ form: response }) });
  else if (isVersionConflict({ error: failure })) refresh.conflict();
  // Any other failure is already surfaced through updateMutation.error -> error below.
  refresh.afterWrite();
}

/** Applies a status response. Same definition (including the uneditable `notify`, which must not be
 * dropped): advance status and basis without reseeding dirty fields. Otherwise the response also
 * carries an outside definition edit, so it goes through apply-or-prompt. A status response must not
 * relabel a stale draft as current: its version covers an edit the draft has never seen, so
 * adopting it would let the next Save overwrite that edit without a conflict. */
function applyStatusResponse({ stateController, setters, refresh, response }: Pick<EditorActionDeps, "stateController" | "setters" | "refresh"> & { response: AdminFormDefinition }) {
  const applied = stateController?.getSnapshot().form ?? null;
  if (!applied || sameFormDefinition({ a: applied, b: response })) { setters.setForm(response); return; }
  if (refresh.applyIncoming({ form: response }) !== "seed") setters.setForm({ ...applied, status: response.status });
}

async function handleStatusToggle({ state, mutations, setters, stateController, generation, refresh }: EditorActionDeps) {
  const { form } = state;
  if (!form) return;
  const write = generation.beginWrite();
  let response: AdminFormDefinition | undefined;
  try {
    // Still exactly `{ status }`: a conditional definition write is never paired with a status change.
    response = formView({ form: await mutations.statusMutation.mutate({ input: { id: form.id, status: form.status === "active" ? "disabled" : "active" } }) });
  } catch {
    // already surfaced through statusMutation.error -> error below
  }
  if (!generation.settleWrite(write)) return;
  if (response) applyStatusResponse({ stateController, setters, refresh, response });
  refresh.afterWrite();
}

/** Copy-embed, mode switch, save and status toggle, each bound to this render's state. */
export function useFormEditorActions(deps: EditorActionDeps, _optional = {}) {
  return {
    onModeChange: (next: "builder" | "html") => { deps.stateController?.changeMode({ mode: next }, { submitLabel: deps.t("Send") }); },
    copyEmbed: () => copyEmbed(deps),
    handleSave: () => handleSave(deps),
    handleStatusToggle: () => handleStatusToggle(deps),
  };
}

/** The unsaved-changes confirmation behind the in-app Back link. */
export function useFormEditorLeave({ state, isNew, navigate }: { state: FormEditorSnapshot; isNew: boolean; navigate: Navigate }, _optional = {}) {
  const { form, name, slug, fields, mode, html, provider } = state;
  // Same guard as the post and widget editors (reload/close prompt included); the in-app Back
  // gets the admin's confirm modal rather than `confirmLeave`'s `window.confirm`.
  const { isDirty } = useDirtyGuard({ current: formEditorDraft({ name, slug, fields, mode, html, provider }), original: formEditorBaseline({ form, isNew }) });
  const [confirmOpen, setConfirmOpen] = useState(false);
  return {
    confirmOpen,
    onBack(event: { preventDefault: () => void }) {
      event.preventDefault();
      if (!isDirty) { navigate("/forms"); return; }
      setConfirmOpen(true);
    },
    confirm() {
      setConfirmOpen(false);
      navigate("/forms");
    },
    cancel: () => setConfirmOpen(false),
  };
}

/** Saving flag and the user-visible error, across the three mutations and the load. */
export function useFormEditorOutcome({ mutations, list, form, t }: {
  mutations: ReturnType<typeof useFormEditorMutations>; list: ReturnType<typeof useFormEditorQueries>["list"]; form: AdminFormDefinition | null; t: Translate;
}, _optional = {}) {
  const { updateMutation, createMutation, statusMutation } = mutations;
  // A refused stale Save is shown as the reload notice, not as a save failure.
  const updateError = isVersionConflict({ error: updateMutation.error }) ? null : updateMutation.error;
  const saving = updateMutation.status === "pending" || createMutation.status === "pending" || statusMutation.status === "pending";
  const error = visibleFormEditorError({
    updateError,
    createError: createMutation.error,
    statusError: statusMutation.error,
    listError: list.error,
    hasForm: form !== null,
    saveFallback: t("save failed"),
    statusUpdateFallback: t("status update failed"),
    loadFormFallback: t("failed to load form"),
  });
  return { saving, error };
}

/** Route-driven tab switching plus the roving-tabindex focus targets of the tab strip. */
export function useFormEditorTabs({ tab, formId, navigate }: { tab: "fields" | "submissions"; formId: string; navigate: Navigate }, _optional = {}) {
  // Roving-tabindex focus targets for the tab strip below, indexed the same as `FORM_TABS` — see
  // `nextTabIndex`'s doc comment for why the index math itself lives outside the component.
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Navigates to `/forms/:formId` or `/forms/:formId/submissions` — `panels.tsx`'s
  // `forms` panel keys `FormEditor` off `ctx.params.formId` on BOTH routes, so this is a route
  // change, not a remount: in-progress Fields edits survive a trip to Submissions and back.
  function onTabChange(nextTab: "fields" | "submissions") {
    navigate(nextTab === "submissions" ? `/forms/${formId}/submissions` : `/forms/${formId}`);
  }

  function onTabsKeyDown(e: React.KeyboardEvent) {
    const currentIndex = FORM_TABS.findIndex((t) => t.id === tab);
    const index = nextTabIndex({ key: e.key, currentIndex });
    if (index === null) return;
    e.preventDefault();
    onTabChange(FORM_TABS[index]!.id);
    tabRefs.current[index]?.focus();
  }
  return { tabRefs, onTabChange, onTabsKeyDown };
}
