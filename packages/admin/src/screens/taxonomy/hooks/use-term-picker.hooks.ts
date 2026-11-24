import { useEffect, useState } from "react";
import type { AdminTaxonomyWithTerms } from "../api/taxonomy-api.types.js";
import { useFetchMutation, useFetchQuery } from "../../../react/kit.js";
import { hasPermission } from "@jini-ai/core/admin-runtime";
import { KEYS, TAXONOMY_MANAGE_PERMISSION, findTermByName, splitTermNames, termPickerSubject } from "../rules.js";

import type { TermPickerPort } from "./term-picker-port.hooks.js";

import { type Translate } from '@jini-ai/core/text';
import type { TaxonomyHostKit } from "../taxonomy-host-kit.js";
/**
 * @file `TermPicker`'s own state and async action — the Categories & Tags box the post, page and
 * collection-entry editors all mount (`TermPicker.tsx`). One content ref (`contentType` +
 * `contentId`: `post`/`page` + the post id, or a collection key + the entry id) is all it needs; it
 * reads the taxonomy list and the content's own terms itself, so an editor passes nothing else.
 *
 * `port`/`locale` are injected — see `term-picker-port.hooks.ts` — so a test describes the outcome
 * against `createFakeTermPickerPort` instead of stubbing global `fetch`. The host's
 * `useWiredTermPicker` is the pair its `TermPicker` view actually mounts.
 *
 * The taxonomy list shares the Categories & Tags screen's own cache key (`KEYS.list`), so a term
 * added there shows here without a reload. The boxes start ticked for the terms the content holds
 * (`assignedTerms`, `KEYS.assignedTerms`). Ticking/unticking edits a local draft; Save sends the
 * difference — `assignTerms` for the added ids, `unassignTerms` for the removed ones — then re-reads.
 * The draft is kept after a save, so a box ticked while the save was in flight stays ticked (M1) and
 * simply shows as a new unsaved change.
 *
 * Adding a term by name (2026-09-26): each taxonomy row has an add input — always shown for a tag
 * box (`hierarchical: false`) and for a taxonomy with no terms yet, behind "+ Add term" for a
 * category box that already has some. Enter (or a comma, in a tag box) adds what was typed: a name
 * that matches an existing term, ignoring case, just ticks that term; a new one is created through
 * the Categories & Tags screen's own create-term port (`port.createTerm`, invalidating `KEYS.list`
 * the same way) and then ticked. The create is immediate — a term needs an id before it can be
 * ticked — but putting it on this content still waits for Save, like every other tick. The input
 * shows only when the admin holds `admin.taxonomy.manage` (UX only; the route is the boundary).
 */

export interface TermPickerController {
  taxonomies: AdminTaxonomyWithTerms[];
  /** No taxonomy exists at all — the box has nothing to offer and is not shown. */
  hidden: boolean;
  /** What the box's agent labels call the tagged content. */
  subject: "post" | "page" | "entry";
  selected: Set<string>;
  toggle: (termId: string) => void;
  /** The first read of the taxonomies or of the content's terms has not landed yet. */
  loading: boolean;
  /** The ticked set differs from what the content holds. */
  dirty: boolean;
  saving: boolean;
  message: string | null;
  error: string | null;
  save: () => Promise<void>;
  /** This feature's dictionary, bound to the admin locale. */
  t: Translate;
  /** The admin may create terms — without it no add input or trigger shows. */
  canCreate: boolean;
  /** This taxonomy's add input is on screen. */
  showAddInput: (taxonomyId: string) => boolean;
  /** This (category) taxonomy shows "+ Add term" to open its add input. */
  showAddTrigger: (taxonomyId: string) => boolean;
  setAddOpen: (taxonomyId: string, open: boolean) => void;
  /** What is typed in this taxonomy's add input. */
  newTermName: (taxonomyId: string) => string;
  setNewTermName: (taxonomyId: string, name: string) => void;
  /** Enter adds what was typed; so does a comma in a tag box. Escape closes an opened category input. */
  onNewTermKeyDown: (taxonomyId: string, event: { key: string; nativeEvent?: { isComposing: boolean }; preventDefault(): void }) => void;
  /** Ticks the typed name's existing term, or creates it and ticks it. */
  addTerm: (taxonomyId: string) => Promise<void>;
  /** A suggestion was picked from the add box's list: tick that existing term, clear the box. */
  pickSuggestion: (taxonomyId: string, name: string) => void;
  /** A term is being created in this taxonomy. */
  creating: (taxonomyId: string) => boolean;
  createError: (taxonomyId: string) => string | null;
  /** This taxonomy's terms not ticked yet — the add input's suggestions. */
  suggestions: (taxonomyId: string) => string[];
}

export interface TermPickerDependencies {
  port: TermPickerPort;
  locale: string;
  /** The host's translator, request-error copy and failure channel. */
  kit: TaxonomyHostKit;
}

/** Which post, page or collection entry the picker tags. */
export interface TermPickerTarget {
  contentType: string;
  contentId: string;
}

const NO_TERMS: readonly string[] = [];
const NO_TAXONOMIES: AdminTaxonomyWithTerms[] = [];

/** The ids in `from` that are not in `other`. */
function missingFrom(from: Iterable<string>, other: ReadonlySet<string>): string[] {
  return [...from].filter((id) => !other.has(id));
}

/**
 * The one error line the box shows: a failed save wins, then a failed read of the content's own
 * terms, then a failed taxonomy-list read.
 * @param required - The save mutation's and both queries' errors, and the admin locale.
 * @returns The described error, or `null` when nothing failed.
 */
function pickerError({ saveError, assignedError, taxonomiesError, locale, kit }: {
  saveError: unknown;
  assignedError: unknown;
  taxonomiesError: unknown;
  locale: string;
  kit: TaxonomyHostKit;
}): string | null {
  if (saveError) return kit.describeApiError({ e: saveError, fallback: kit.translate({ locale: locale, key: "Failed to save categories & tags" }) });
  const loadError = assignedError ?? taxonomiesError;
  return loadError ? kit.describeApiError({ e: loadError, fallback: kit.translate({ locale: locale, key: "Failed to load categories & tags" }) }) : null;
}

/**
 * The box's load state from its two reads.
 * @param required - Both queries' statuses and how many taxonomies the list holds.
 * @returns `hidden` once the list is known to be empty; `loading` while either first read is out.
 */
function pickerStatus({ taxonomiesStatus, assignedStatus, taxonomyCount }: {
  taxonomiesStatus: string;
  assignedStatus: string;
  taxonomyCount: number;
}): { hidden: boolean; loading: boolean } {
  return {
    hidden: taxonomiesStatus === "success" && taxonomyCount === 0,
    loading: taxonomiesStatus === "loading" || assignedStatus === "loading",
  };
}

/** What the host passes `useTermPicker`: the content ref it tags plus the injected
 *  {@link TermPickerDependencies}. */
export interface UseTermPickerArgs extends TermPickerDependencies {
  target: TermPickerTarget;
}

/**
 * The ticked set the boxes edit, its Save, and Save's confirmation line.
 * @param required - The content ref and its query key, the terms it holds, and the injected deps.
 * @returns The ticked set, its edit/save actions and the save's own state.
 */
function useTermPickerSelection({ target, key, assigned, port, locale, kit }: TermPickerDependencies & {
  target: TermPickerTarget;
  key: ReturnType<typeof KEYS.assignedTerms>;
  assigned: Set<string>;
}) {
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // A draft belongs to one content ref; changing the query key must also drop its local edits.
  useEffect(() => {
    setDraft(null);
    setMessage(null);
  }, [target.contentType, target.contentId]);
  const selected = draft ?? assigned;

  const saveMutation = useFetchMutation({
    run: async ({ input }: { input: { add: string[]; remove: string[] } }) => {
      if (input.add.length > 0) await port.assignTerms({ ...target, termIds: input.add });
      if (input.remove.length > 0) await port.unassignTerms({ ...target, termIds: input.remove });
    },
  }, {
    invalidates: [key],
  });

  function tick(termIds: string[]) {
    setMessage(null);
    setDraft((current) => new Set([...(current ?? assigned), ...termIds]));
  }

  function toggle(termId: string) {
    setMessage(null);
    setDraft((current) => {
      const next = new Set(current ?? assigned);
      if (next.has(termId)) next.delete(termId);
      else next.add(termId);
      return next;
    });
  }

  const add = missingFrom(selected, assigned);
  const remove = missingFrom(assigned, selected);
  const dirty = add.length > 0 || remove.length > 0;

  async function save() {
    if (!dirty) return;
    setMessage(null);
    try {
      await saveMutation.mutate({ input: { add, remove } });
      setMessage(kit.translate({ locale: locale, key: "Categories & tags saved." }));
    } catch {
      // already surfaced through saveMutation.error -> error below
    }
  }

  return { selected, tick, toggle, dirty, save, message, saving: saveMutation.status === "pending", saveError: saveMutation.error };
}

/**
 * Each taxonomy row's add input: what is typed, which category inputs are open, and which taxonomy
 * the last create was for.
 * @param required - The taxonomy list and whether the admin may create terms.
 * @returns The per-taxonomy input state and its setters.
 */
function useTermPickerAddInputs({ taxonomies, canCreate }: { taxonomies: AdminTaxonomyWithTerms[]; canCreate: boolean }) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [openAdds, setOpenAdds] = useState<ReadonlySet<string>>(new Set());
  /** The taxonomy the last create was for — `createMutation`'s error and pending state belong to it. */
  const [createTarget, setCreateTarget] = useState<string | null>(null);

  function groupOf(taxonomyId: string) {
    return taxonomies.find((group) => group.taxonomy.id === taxonomyId);
  }

  function clearNewTermName(taxonomyId: string) {
    setNames((current) => ({ ...current, [taxonomyId]: "" }));
  }

  function setNewTermName(taxonomyId: string, name: string) {
    if (createTarget === taxonomyId) setCreateTarget(null);
    setNames((current) => ({ ...current, [taxonomyId]: name }));
  }

  function setAddOpen(taxonomyId: string, open: boolean) {
    setOpenAdds((current) => {
      const next = new Set(current);
      if (open) next.add(taxonomyId);
      else next.delete(taxonomyId);
      return next;
    });
  }

  function showAddInput(taxonomyId: string): boolean {
    const group = groupOf(taxonomyId);
    if (!canCreate || !group) return false;
    return !group.taxonomy.hierarchical || group.terms.length === 0 || openAdds.has(taxonomyId);
  }

  return { names, createTarget, setCreateTarget, groupOf, clearNewTermName, setNewTermName, setAddOpen, showAddInput };
}

/**
 * Adding a term by name — see this file's header: tick a matching term, or create it and tick it.
 * @param required - The add-input state, the selection's `tick`, and the injected deps.
 * @returns The add actions and each taxonomy's create state.
 */
function useTermPickerAddFlow({ inputs, tick, port, locale, kit }: TermPickerDependencies & {
  inputs: ReturnType<typeof useTermPickerAddInputs>;
  tick: (termIds: string[]) => void;
}) {
  const { names, createTarget, setCreateTarget, groupOf, clearNewTermName, setNewTermName, setAddOpen } = inputs;
  const createMutation = useFetchMutation({
    run: ({ input }: { input: { taxonomyId: string; name: string } }) => port.createTerm(input),
  }, {
    invalidates: [KEYS.list],
  });

  async function addTerm(taxonomyId: string) {
    const group = groupOf(taxonomyId);
    if (!group) return;
    const wanted = splitTermNames({ text: names[taxonomyId] ?? "", hierarchical: group.taxonomy.hierarchical });
    if (wanted.length === 0) return;
    setCreateTarget(taxonomyId);
    const ids: string[] = [];
    try {
      for (const name of wanted) {
        const existing = findTermByName({ terms: group.terms, name });
        ids.push(existing ? existing.id : (await createMutation.mutate({ input: { taxonomyId, name } })).term.id);
      }
    } catch {
      // already surfaced through createMutation.error -> createError below; the terms added
      // before the failure stay ticked and the typed text stays for a retry
      tick(ids);
      return;
    }
    tick(ids);
    setCreateTarget(null);
    clearNewTermName(taxonomyId);
    setAddOpen(taxonomyId, false);
  }

  function pickSuggestion(taxonomyId: string, name: string) {
    const existing = findTermByName({ terms: groupOf(taxonomyId)?.terms ?? [], name });
    if (!existing) {
      setNewTermName(taxonomyId, name);
      return;
    }
    tick([existing.id]);
    clearNewTermName(taxonomyId);
  }

  function onNewTermKeyDown(taxonomyId: string, event: { key: string; nativeEvent?: { isComposing: boolean }; preventDefault(): void }) {
    // Enter/comma can belong to the IME conversion rather than to the term picker.
    if (event.nativeEvent?.isComposing) return;
    const hierarchical = groupOf(taxonomyId)?.taxonomy.hierarchical ?? true;
    if (event.key === "Escape") {
      // Closes a category box's opened input; one that is always shown just stays.
      setAddOpen(taxonomyId, false);
      return;
    }
    if (event.key !== "Enter" && !(event.key === "," && !hierarchical)) return;
    // Also keeps Enter from submitting an editor form the box sits inside.
    event.preventDefault();
    void addTerm(taxonomyId);
  }

  return {
    addTerm,
    pickSuggestion,
    onNewTermKeyDown,
    creating: (taxonomyId: string) => createTarget === taxonomyId && createMutation.status === "pending",
    createError: (taxonomyId: string) =>
      createTarget === taxonomyId && createMutation.error
        ? kit.describeApiError({ e: createMutation.error, fallback: kit.translate({ locale: locale, key: "Failed to create term" }) })
        : null,
  };
}

export function useTermPicker(
  { target: props, port, locale, kit }: UseTermPickerArgs,
  _optional: Record<string, never> = {}
): TermPickerController {
  const target = { contentType: props.contentType, contentId: props.contentId };
  const key = KEYS.assignedTerms(props.contentType, props.contentId);
  // Same fetch (and so the same cached `{ items }` shape) as `use-taxonomy.hooks.ts`'s list read —
  // two readers of one key must store one shape.
  const taxonomiesQuery = useFetchQuery({ key: KEYS.list, fetch: () => port.listTaxonomies() });
  const assignedQuery = useFetchQuery({ key, fetch: async () => (await port.assignedTerms(target)).termIds });
  const taxonomies = taxonomiesQuery.data?.items ?? NO_TAXONOMIES;
  const assigned = new Set(assignedQuery.data ?? NO_TERMS);
  const selection = useTermPickerSelection({ target, key, assigned, port, locale, kit });
  const { selected } = selection;
  const permissionsQuery = useFetchQuery({ key: KEYS.permissions, fetch: () => port.me() });
  const canCreate = hasPermission({ permissions: permissionsQuery.data?.effectivePermissions ?? [], permission: TAXONOMY_MANAGE_PERMISSION });
  const inputs = useTermPickerAddInputs({ taxonomies, canCreate });
  const addFlow = useTermPickerAddFlow({ inputs, tick: selection.tick, port, locale, kit });
  const { groupOf, showAddInput } = inputs;

  const error = pickerError({
    saveError: selection.saveError,
    assignedError: assignedQuery.error,
    taxonomiesError: taxonomiesQuery.error,
    locale,
    kit,
  });
  const { hidden, loading } = pickerStatus({
    taxonomiesStatus: taxonomiesQuery.status,
    assignedStatus: assignedQuery.status,
    taxonomyCount: taxonomies.length,
  });

  return {
    taxonomies,
    hidden,
    subject: termPickerSubject({ contentType: props.contentType }),
    selected,
    toggle: selection.toggle,
    loading,
    dirty: selection.dirty,
    saving: selection.saving,
    message: selection.message,
    error,
    save: selection.save,
    t: (key) => kit.translate({ locale: locale, key: key }),
    canCreate,
    showAddInput,
    showAddTrigger: (taxonomyId) => canCreate && Boolean(groupOf(taxonomyId)) && !showAddInput(taxonomyId),
    setAddOpen: inputs.setAddOpen,
    newTermName: (taxonomyId) => inputs.names[taxonomyId] ?? "",
    setNewTermName: inputs.setNewTermName,
    ...addFlow,
    suggestions: (taxonomyId) =>
      (groupOf(taxonomyId)?.terms ?? []).filter((term) => !selected.has(term.id)).map((term) => term.name),
  };
}
