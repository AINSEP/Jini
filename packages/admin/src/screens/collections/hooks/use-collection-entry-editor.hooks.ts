import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AdminContentType, AdminEntry } from "../api/collections-api.types.js";
import { useFetchMutation, useFetchQuery } from "../../../react/kit.js";
import { KEYS, visibleEntryEditorError } from "../rules.js";
import type { CollectionsHostKit } from "../collections-host-kit.js";
import type { CollectionEntryEditorPort } from "./collection-entry-editor-port.hooks.js";

/**
 * @file Everything the collection entry editor does, so `CollectionEntryEditor.tsx` is only
 * markup. Extracted verbatim — same state, same order, same effect, same error strings.
 *
 * `TermPicker`'s own state/actions live in `use-term-picker.hooks.ts` — a separate hook, because
 * it is a genuinely separate stateful unit (its own load-free local state, its own async action)
 * nested inside this screen, not a piece of this editor's own state.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts` and `hooks/use-dirty-guard.hooks.ts`:
 * `use-<thing>.hooks.ts`. Feature-local because nothing outside `features/collections` needs it;
 * promote to `src/hooks/` only when a second feature actually does.
 *
 * `port`/`navigate`/`locale` are injected — see `collection-entry-editor-port.hooks.ts` — rather
 * than reaching `lib/api`/`lib/router`/`useAdminLocale()` directly, so a test can describe load/
 * save/lifecycle outcomes against `createFakeCollectionEntryEditorPort` instead of stubbing global
 * `fetch`. The host's `useWiredCollectionEntryEditor` is the pair `CollectionEntryEditor.tsx` actually
 * mounts.
 *
 * The rich-text body editor is injected as well (`useBodyEditor`): this package carries no
 * rich-text editor dependency, so the host binds its own editor (extensions, `role` included) and
 * this hook only reads it through {@link CollectionEntryBodyEditor}. The host also injects its
 * collections dictionary/request-error copy (`kit`), its entry lifecycle-failure copy and its
 * version-conflict copy key.
 *
 * `t` is now ALSO injected (standing i18n rule, 2026-08-11, superseding this file's earlier
 * "stays a direct import" note above — see `use-collections.hooks.ts`'s identical update) so
 * `CollectionEntryEditor.tsx` sources its UI copy from this hook instead of its own
 * `useAdminLocale()`/`COLLECTIONS_DICT` import. The dictionary's own `t({ locale, key })` lookup
 * for this hook's OWN error strings arrives as `kit.translate`: a pure lookup that already takes
 * `locale` explicitly.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): the combined content-type/entry read is one
 * `useFetchQuery` keyed on `KEYS.entry({ contentTypeKey, entryId })` — a SIBLING of `use-collection-
 * entries.hooks.ts`'s `KEYS.entries({ contentTypeKey: key })`, deliberately NOT nested under it (see `rules.ts`'s `KEYS`
 * doc for the regression that nesting caused: every save background-refetched this SAME hook's own
 * read, firing 3 extra requests right after the save's own one and breaking several "the last fetch
 * call was the save" test assertions). `save()`/`toggleLifecycle()` still `invalidates:
 * [KEYS.entries({ contentTypeKey })]` directly, so the sibling entries LIST still refreshes — this hook's
 * own read just isn't a fellow traveller of that invalidation. It IS still nested under `KEYS.list`,
 * so a content-type field/lifecycle change (from `use-collections.hooks.ts`/`use-edit-fields-
 * dialog.hooks.ts`) still refreshes an open editor, which is wanted. `entry`/`title`/`slug`/
 * `extFields`/the editor's own content stay local `useState` (the user edits them, and `save()`
 * reassigns `entry` from the write's own response) rather than being read directly off `list.data` —
 * `seededIdentityRef` seeds them from `list.data` exactly once per `(contentTypeKey, entryId)` pair,
 * so a background refetch from a `KEYS.list` invalidation doesn't re-seed and silently overwrite
 * in-progress edits. `contentType` has no such hazard (nothing local ever mutates it) and is read
 * straight off `list.data` every render. The Categories & Tags box loads its own taxonomies
 * (`features/taxonomy/TermPicker.tsx`).
 */

/** The slice of the host's rich-text body editor this hook reads and seeds. */
export interface CollectionEntryBodyEditor {
  getJSON(): unknown;
  commands: { setContent(content: string): unknown };
}

/** What `CollectionEntryEditor` receives: the props the screen route passes. */
export interface CollectionEntryEditorProps {
  contentTypeKey: string;
  entryId: string | null;
}

export interface CollectionEntryEditorController<TEditor extends CollectionEntryBodyEditor = CollectionEntryBodyEditor> {
  contentType: AdminContentType | null | undefined;
  entry: AdminEntry | null;
  title: string;
  setTitle: (title: string) => void;
  slug: string;
  setSlug: (slug: string) => void;
  extFields: Record<string, unknown>;
  setExtFields: Dispatch<SetStateAction<Record<string, unknown>>>;
  message: string | null;
  error: string | null;
  loadError: string | null;
  loaded: boolean;
  saving: boolean;
  /** True while `save()` OR a lifecycle toggle is in flight — unlike `saving` (Save's own label),
   *  this also covers `toggleLifecycle`'s standalone lifecycle write (Unpublish, and Publish's own
   *  lifecycle leg once its save leg has landed — see H2's `publishWithSave`). Drives `disabled` on
   *  Publish/Unpublish/Save so a second click can't race an in-flight write on the same entry. */
  busy: boolean;
  editor: TEditor | null;
  save: () => Promise<void>;
  toggleLifecycle: (required: { op: "publish" | "unpublish" }, optional?: Record<string, never>) => Promise<void>;
  /** M2: a `json`-kind dynamic field control reports its own parse validity here on every change
   *  (and clears it to valid on unmount) — see `use-json-field-control.hooks.ts`. `save()`/
   *  Publish refuse to write while any field is reporting invalid. */
  setFieldValidity: (fieldName: string, valid: boolean) => void;
  /** Bound translator — `CollectionEntryEditor.tsx`'s only source of UI copy; see this file's own
   *  header. */
  t: (required: { key: string }, optional?: Record<string, never>) => string;
}

export interface CollectionEntryEditorDependencies<TEditor extends CollectionEntryBodyEditor = CollectionEntryBodyEditor> {
  port: CollectionEntryEditorPort;
  navigate: (path: string, options?: { replace?: boolean }) => void;
  locale: string;
  t: (required: { key: string }, optional?: Record<string, never>) => string;
  /** The host's collections dictionary and request-error copy — see `collections-host-kit.ts`. */
  kit: CollectionsHostKit;
  /** The host's copy for a failed publish/unpublish of one entry. */
  entryLifecycleFailureMessage: (required: { locale: string; op: "publish" | "unpublish" }) => string;
  /** The host's untranslated version-conflict copy key, looked up through `kit.translate`. */
  versionConflictMessage: string;
  /** The admin shell's slug-redirect rule (`shell/lib/slug-redirect-path`), bound by the host. */
  slugRedirectPath: (required: { base: string; requestedId: string; item: { id: string; slug: string } }) => string | null;
  /** The host's rich-text body editor hook, labelled `ariaLabel` (null until it mounts). */
  useBodyEditor: (required: { ariaLabel: string }) => TEditor | null;
}

export function useCollectionEntryEditor<TEditor extends CollectionEntryBodyEditor = CollectionEntryBodyEditor>(
  { props, ...deps }: { props: CollectionEntryEditorProps } & CollectionEntryEditorDependencies<TEditor>,
  _optional: Record<string, never> = {},
): CollectionEntryEditorController<TEditor> {
  const {
    port, navigate, locale, t, kit, entryLifecycleFailureMessage, versionConflictMessage, slugRedirectPath, entry, setEntry, title, setTitle, slug, setSlug, extFields, setExtFields, message, setMessage, lastLifecycleOp,
    setLastLifecycleOp, invalidFields, validationError, setValidationError, setFieldValidity, editor,
  } = useCollectionEntryWorkingCopy({ deps });
  const { list, contentType, loaded, loadError } = useCollectionEntryQuery({ props, port, locale, kit });
  useCollectionEntrySeed({ setTitle, setSlug, setExtFields, editor, props, list, setEntry, navigate, slugRedirectPath });
  const { updateMutation, createMutation, lifecycleMutation } = useCollectionEntryMutations({ port, props });
  const { saveExisting, save } = createCollectionEntrySave({
    updateMutation, title, extFields, editor, setEntry, contentType, setMessage, setValidationError, invalidFields, locale, kit, entry, createMutation, props,
    slug, navigate,
  });
  const { toggleLifecycle } = createCollectionEntryLifecycle({
    setMessage, setValidationError, invalidFields, locale, kit, setLastLifecycleOp, saveExisting, lifecycleMutation, setEntry, entry,
  });
  return createCollectionEntryController({
    updateMutation, createMutation, lifecycleMutation, validationError, locale, kit, entryLifecycleFailureMessage, versionConflictMessage, lastLifecycleOp,
    contentType, entry, title, setTitle, slug, setSlug, extFields, setExtFields, message, loadError, loaded, editor, save, toggleLifecycle, setFieldValidity,
    t,
  });
}

function createCollectionEntryController<TEditor extends CollectionEntryBodyEditor>(
  {
    updateMutation, createMutation, lifecycleMutation, validationError, locale, kit, entryLifecycleFailureMessage, versionConflictMessage, lastLifecycleOp,
    contentType, entry, title, setTitle, slug, setSlug, extFields, setExtFields, message, loadError, loaded, editor, save, toggleLifecycle, setFieldValidity, t,
  }:
    Pick<ReturnType<typeof useCollectionEntryMutations>, "updateMutation" | "createMutation" | "lifecycleMutation"> &
    Pick<ReturnType<typeof useCollectionEntryWorkingCopy>, "validationError" | "locale" | "kit" | "entryLifecycleFailureMessage" | "versionConflictMessage"
    | "lastLifecycleOp" | "entry" | "title" | "setTitle" | "slug" | "setSlug" | "extFields" | "setExtFields" | "message" | "setFieldValidity" | "t"> &
    { editor: TEditor | null } &
    Pick<ReturnType<typeof useCollectionEntryQuery>, "contentType" | "loadError" | "loaded"> &
    Pick<ReturnType<typeof createCollectionEntrySave>, "save"> &
    Pick<ReturnType<typeof createCollectionEntryLifecycle>, "toggleLifecycle">
): CollectionEntryEditorController<TEditor> {
  const saving = updateMutation.status === "pending" || createMutation.status === "pending";
  // Publish now folds a save into its lifecycle write (H2), so a second click must be blocked for
  // BOTH legs, not just the save leg `saving` alone would cover.
  const busy = saving || lifecycleMutation.status === "pending";
  // Precedence logic lives in `rules.ts`'s `visibleEntryEditorError` — extracted out of this hook
  // (not just for the usual "computes a value" reason, but because the branching here pushed the
  // hook's own complexity over ESLint's ceiling). `validationError` (M2) takes precedence over it,
  // mirroring `use-new-content-type-dialog`'s own local-validation-first ordering: an unparseable
  // JSON field blocks the write entirely, so its message should win over a stale mutation error
  // from a previous attempt.
  const error = validationError ?? visibleEntryEditorError({
    updateError: updateMutation.error,
    createError: createMutation.error,
    lifecycleError: lifecycleMutation.error,
    saveFallback: kit.translate({ locale: locale, key: "save failed" }),
    lifecycleFallback: lastLifecycleOp ? entryLifecycleFailureMessage({ locale, op: lastLifecycleOp }) : null,
    versionConflictMessage: kit.translate({ locale: locale, key: versionConflictMessage }),
    kit,
  });

  return {
    contentType,
    entry,
    title,
    setTitle,
    slug,
    setSlug,
    extFields,
    setExtFields,
    message,
    error,
    loadError,
    loaded,
    saving,
    busy,
    editor,
    save,
    toggleLifecycle,
    setFieldValidity,
    t,
  };
}

function createCollectionEntryLifecycle(
  { setMessage, setValidationError, invalidFields, locale, kit, setLastLifecycleOp, saveExisting, lifecycleMutation, setEntry, entry }:
    Pick<ReturnType<typeof useCollectionEntryWorkingCopy>, "setMessage" | "setValidationError" | "invalidFields" | "locale" | "kit" | "setLastLifecycleOp"
    | "setEntry" | "entry"> &
    Pick<ReturnType<typeof createCollectionEntrySave>, "saveExisting"> &
    Pick<ReturnType<typeof useCollectionEntryMutations>, "lifecycleMutation">
) {
  const { publishWithSave } = createCollectionEntryPublisher({
    setMessage, setValidationError, invalidFields, locale, kit, setLastLifecycleOp, saveExisting, lifecycleMutation, setEntry,
  });

  async function toggleLifecycle({ op }: { op: "publish" | "unpublish" }, _optional = {}) {
    if (!entry) return;
    if (op === "publish") {
      await publishWithSave(entry);
      return;
    }
    setLastLifecycleOp(op);
    try {
      const { entry: saved } = await lifecycleMutation.mutate({ input: { id: entry.id, op, expectedVersion: entry.version } });
      setEntry(saved);
      setMessage(`Entry ${op}ed · version ${saved.version}`);
    } catch {
      // already surfaced through lifecycleMutation.error -> error below
    }
  }
  return { toggleLifecycle };
}

function createCollectionEntryPublisher(
  { setMessage, setValidationError, invalidFields, locale, kit, setLastLifecycleOp, saveExisting, lifecycleMutation, setEntry }:
    Pick<Parameters<typeof createCollectionEntryLifecycle>[0], "setMessage" | "setValidationError" | "invalidFields" | "locale" | "kit" | "setLastLifecycleOp"
    | "saveExisting" | "lifecycleMutation" | "setEntry">
) {
  /**
   * H2 fix: Publish was wired straight to `lifecycleMutation`, so it published whatever was last
   * SAVED, silently dropping any edit made since — the button's own label claims it saves "its
   * current title, fields and body". This saves the working copy first (through `saveExisting`,
   * shared with `save()`) and only publishes once that save lands, against the SAVE's own new
   * version rather than the stale `entry.version` a same-tick save+publish would otherwise race.
   * A save failure stops here (its own error already surfaces via `updateMutation.error`) and
   * leaves the entry unpublished — the safe direction, per the plan's own fix note.
   *
   * @complexity Time/space: O(1) — at most two sequential mutation calls.
   */
  async function publishWithSave(current: AdminEntry) {
    // No `if (!editor) return` guard here: the only caller, `toggleLifecycle`, already requires a
    // loaded `entry`, and `entry` is only ever seeded by the load effect above, which itself waits
    // for a live `editor` — so by the time Publish can run, the editor exists.
    setMessage(null);
    setValidationError(null);
    if (invalidFields.size > 0) {
      setValidationError(kit.translate({ locale: locale, key: "Fix the invalid JSON before saving." }));
      return;
    }
    setLastLifecycleOp("publish");
    let saved: AdminEntry;
    try {
      saved = await saveExisting(current);
    } catch {
      return; // already surfaced through updateMutation.error -> error below
    }
    try {
      const { entry: published } = await lifecycleMutation.mutate({ input: {
        id: saved.id,
        op: "publish",
        expectedVersion: saved.version,
      } });
      setEntry(published);
      setMessage(`Entry published · version ${published.version}`);
    } catch {
      // already surfaced through lifecycleMutation.error -> error below
    }
  }
  return { publishWithSave };
}

function createCollectionEntrySave(
  {
    updateMutation, title, extFields, editor, setEntry, contentType, setMessage, setValidationError, invalidFields, locale, kit, entry, createMutation, props,
    slug, navigate,
  }:
    Pick<ReturnType<typeof useCollectionEntryMutations>, "updateMutation" | "createMutation"> &
    Pick<ReturnType<typeof useCollectionEntryWorkingCopy>, "title" | "extFields" | "editor" | "setEntry" | "setMessage" | "setValidationError" | "invalidFields"
    | "locale" | "kit" | "entry" | "slug" | "navigate"> &
    Pick<ReturnType<typeof useCollectionEntryQuery>, "contentType"> &
    { props: CollectionEntryEditorProps }
) {
  /**
   * Writes the existing entry's current working copy (title/fields/body) through `updateMutation`
   * and mirrors the saved row into `entry` — the one place that write happens, shared by `save()`
   * and H2's `publishWithSave()` (Publish must save the working copy before it publishes it; see
   * this file's own module header / the H2 fix notes for why the two were unified rather than
   * publish going straight to `lifecycleMutation` against the stale, already-loaded `entry.version`).
   *
   * @complexity Time/space: O(1) — one mutation call, one state write.
   */
  async function saveExisting(current: AdminEntry): Promise<AdminEntry> {
    const { entry: saved } = await updateMutation.mutate({ input: {
      target: { id: current.id, expectedVersion: current.version },
      // `bodyJson` was omitted here while the create branch below sent it, so editing an existing
      // entry's rich text reported "Saved · version N" and left the stored body untouched. Silent
      // data loss on the primary content surface; `PostEditor` has always done this correctly.
      patch: { title, fieldsJson: { ext: { site: extFields } }, bodyJson: editor?.getJSON() },
    } });
    setEntry(saved);
    return saved;
  }

  async function save() {
    if (!contentType || !editor) return;
    setMessage(null);
    setValidationError(null);
    if (invalidFields.size > 0) {
      setValidationError(kit.translate({ locale: locale, key: "Fix the invalid JSON before saving." }));
      return;
    }
    try {
      if (entry) {
        const saved = await saveExisting(entry);
        setMessage(`Saved · version ${saved.version}`);
      } else {
        const { entry: created } = await createMutation.mutate({ input: {
          input: { type: props.contentTypeKey, slug: slug.trim(), title },
          options: { fieldsJson: { ext: { site: extFields } }, bodyJson: editor.getJSON() },
        } });
        setEntry(created);
        setMessage(`Created · version ${created.version}`);
        navigate(`/collections/${props.contentTypeKey}/${created.slug}`);
      }
    } catch {
      // already surfaced through updateMutation.error/createMutation.error -> error below
    }
  }
  return { saveExisting, save };
}

function useCollectionEntryMutations(
  { port, props }:
    Pick<ReturnType<typeof useCollectionEntryWorkingCopy>, "port"> &
    { props: CollectionEntryEditorProps }
) {
  const updateMutation = useFetchMutation({
    run: ({ input }: { input: { target: { id: string; expectedVersion: number }; patch: { title?: string; fieldsJson?: unknown; bodyJson?: unknown } } }) =>
      port.updateEntry({ target: input.target, patch: input.patch }),
  }, {
    invalidates: [KEYS.entries({ contentTypeKey: props.contentTypeKey })],
  });
  const createMutation = useFetchMutation({
    run: ({ input }: { input: { input: { type: string; slug: string; title: string }; options: { fieldsJson?: unknown; bodyJson?: unknown } } }) =>
      port.createEntry({ input: input.input, options: input.options }),
  }, {
    invalidates: [KEYS.entries({ contentTypeKey: props.contentTypeKey })],
  });
  const lifecycleMutation = useFetchMutation({
    run: ({ input }: { input: { id: string; op: "publish" | "unpublish"; expectedVersion: number } }) => port.entryLifecycle(input),
  }, {
    invalidates: [KEYS.entries({ contentTypeKey: props.contentTypeKey })],
  });
  return { updateMutation, createMutation, lifecycleMutation };
}

function useCollectionEntrySeed(
  { setTitle, setSlug, setExtFields, editor, props, list, setEntry, navigate, slugRedirectPath }:
    Pick<ReturnType<typeof useCollectionEntryWorkingCopy>, "setTitle" | "setSlug" | "setExtFields" | "editor" | "setEntry" | "navigate"
    | "slugRedirectPath"> &
    Pick<ReturnType<typeof useCollectionEntryQuery>, "list"> &
    { props: CollectionEntryEditorProps }
) {
  function seedExistingWorkingCopy(
    { found, editor }: { found: AdminEntry; editor: CollectionEntryBodyEditor },
    _options: Record<string, never> = {},
  ): void {
    setTitle(found.title);
    setSlug(found.slug);
    const site = (found.fieldsJson as { ext?: { site?: Record<string, unknown> } } | null)?.ext?.site;
    setExtFields(site ? { ...site } : {});
    editor.commands.setContent((found.bodyJson ?? "") as never);
  }

  // Seeds `entry`/`title`/`slug`/`extFields`/the editor's content from `list.data` exactly once per
  // `(contentTypeKey, entryId)` identity — see this file's own header for why a background refetch
  // of the SAME identity (e.g. this hook's own `save()` invalidating its parent key) must NOT re-run
  // this and clobber in-progress edits.
  const seededIdentityRef = useRef<string | null>(null);
  useEffect(() => {
    const identity = `${props.contentTypeKey}:${props.entryId ?? "new"}`;
    if (seededIdentityRef.current !== identity) seededIdentityRef.current = null;
    if (!editor || list.status === "loading" || !list.data) return;
    if (seededIdentityRef.current === identity) return;
    seededIdentityRef.current = identity;

    const found = list.data.entry;
    setEntry(found);
    if (found) {
      seedExistingWorkingCopy({ found, editor });
      // readable-slugs S6b: an old id-based bookmark quietly catches up to the slug URL, same
      // `slugRedirectPath` (`lib/slug-redirect-path.ts`) rule posts/pages/widgets/menus already apply.
      // No separate `if (props.entryId)` guard: `found` is only non-null when `list`'s fetch looked
      // an entry up by a truthy `props.entryId`, and even a missing id stringifies to a non-UUID
      // (`"undefined"`), which `slugRedirectPath` already answers with `null` — so no redirect.
      const redirectPath = slugRedirectPath({ base: `/collections/${props.contentTypeKey}`, requestedId: String(props.entryId), item: found });
      if (redirectPath) navigate(redirectPath, { replace: true });
    } else {
      setTitle("");
      setSlug("");
      setExtFields({});
      editor.commands.setContent("");
    }
  }, [props.contentTypeKey, props.entryId, editor, list.status, list.data]);
}

function useCollectionEntryQuery(
  { props, port, locale, kit }:
    Pick<ReturnType<typeof useCollectionEntryWorkingCopy>, "port" | "locale" | "kit"> &
    { props: CollectionEntryEditorProps }
) {
  const list = useFetchQuery({
    key: KEYS.entry({ contentTypeKey: props.contentTypeKey, entryId: props.entryId }),
    fetch: async () => {
      const [typesResult, entriesResult] = await Promise.all([
        port.listContentTypes(),
        props.entryId ? port.listEntries({ type: props.contentTypeKey }) : Promise.resolve({ items: [] as AdminEntry[] }),
      ]);
      return {
        contentType: typesResult.items.find((type) => type.key === props.contentTypeKey) ?? null,
        // Id or slug (readable-slugs S6b) — id first, since entry slugs are only unique per content
        // type while ids are globally unique; a slug is checked only when the id lookup misses.
        entry: props.entryId
          ? (entriesResult.items.find((e) => e.id === props.entryId)
            ?? entriesResult.items.find((e) => e.slug === props.entryId)
            ?? null)
          : null,
      };
    },
  });

  const contentType = list.data?.contentType;
  const loaded = list.status !== "loading";
  const loadError = list.error ? kit.describeApiError({ e: list.error, fallback: kit.translate({ locale: locale, key: "failed to load entry" }) }) : null;
  return { list, contentType, loaded, loadError };
}

function useCollectionEntryWorkingCopy<TEditor extends CollectionEntryBodyEditor>(
  { deps }:
    { deps: CollectionEntryEditorDependencies<TEditor> }
) {
  const { port, navigate, locale, t, kit, entryLifecycleFailureMessage, versionConflictMessage, slugRedirectPath, useBodyEditor } = deps;
  const [entry, setEntry] = useState<AdminEntry | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [extFields, setExtFields] = useState<Record<string, unknown>>({});
  const [message, setMessage] = useState<string | null>(null);
  // The op the CURRENTLY (or most recently) in-flight `toggleLifecycle` call was for — needed
  // because `entryLifecycleFailureMessage` names it, and unlike `save()` (one fallback string for
  // both create/update), publish/unpublish share one mutation object with no other way to recover
  // which op a given failure was for.
  const [lastLifecycleOp, setLastLifecycleOp] = useState<"publish" | "unpublish" | null>(null);
  // M2: which `json`-kind dynamic fields currently hold unparseable text — see
  // `use-json-field-control.hooks.ts`'s own header. `save()`/`publishWithSave()` refuse to write
  // while this is non-empty, rather than silently sending the last value that DID parse under a
  // "Saved" message (the bug: an entry could show "Saved · version N" for text that was never
  // stored).
  const [invalidFields, setInvalidFields] = useState<ReadonlySet<string>>(new Set());
  const [validationError, setValidationError] = useState<string | null>(null);

  /**
   * Stable setter passed down to every dynamic field control (`setFieldValidity` on the
   * controller) — `useCallback` with a functional update, so a field re-reporting the SAME
   * validity it already had returns the identical `Set` instance rather than a new one, keeping
   * `invalidFields` referentially stable across renders that don't actually change it.
   *
   * @complexity Time/space: O(1) amortized — a `Set` copy only on an actual validity flip.
   */
  const setFieldValidity = useCallback((fieldName: string, valid: boolean) => {
    setInvalidFields((current) => {
      const currentlyInvalid = current.has(fieldName);
      if (valid === !currentlyInvalid) return current;
      const next = new Set(current);
      if (valid) next.delete(fieldName);
      else next.add(fieldName);
      return next;
    });
  }, []);

  // Names the body editor's `contenteditable`, which had none. The host's binding restates `role`
  // for the reason its post editor's own `editorProps.attributes` gives.
  const editor = useBodyEditor({ ariaLabel: t({ key: "Content" }) });
  return {
    port, navigate, locale, t, kit, entryLifecycleFailureMessage, versionConflictMessage, slugRedirectPath, entry, setEntry, title, setTitle, slug, setSlug, extFields, setExtFields, message, setMessage, lastLifecycleOp,
    setLastLifecycleOp, invalidFields, validationError, setValidationError, setFieldValidity, editor,
  };
}

