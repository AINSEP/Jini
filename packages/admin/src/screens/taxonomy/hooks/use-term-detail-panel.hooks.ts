import { useEffect, useRef, useState } from "react";
import type { AdminTerm } from "../api/taxonomy-api.types.js";
import { useFetchMutation } from "../../../react/kit.js";
import { KEYS } from "../rules.js";
import type { TaxonomyPort } from "./taxonomy-port.hooks.js";
import type { TaxonomyHostKit } from "../taxonomy-host-kit.js";

/**
 * @file Everything `TermDetailPanel`'s own rename form does, so it can stay markup only.
 *
 * Extracted verbatim — same state, same effect (reset on term change), same handler, same error
 * string. `MergeTermSection` (rendered inside this panel) owns its own state via
 * `use-merge-term-section.hooks.ts`; this hook does not reach into it.
 *
 * `port` is injected — see `taxonomy-port.hooks.ts` (shared with `use-taxonomy.hooks.ts`, since
 * both read/write the same taxonomy/term resource) — rather than importing `lib/api` directly, so
 * a test can describe the rename outcome against `createFakeTaxonomyPort` instead of stubbing
 * global `fetch`. `useWiredTermDetailPanel` below is the zero-argument pair `Taxonomy.tsx` actually
 * mounts.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): `rename` is a `useFetchMutation` that `invalidates:
 * [KEYS.list]` — the rename mutates a name inside `useTaxonomy`'s cached list, and every previous
 * caller of `onRenamed` used it purely to trigger that same list's `load()`. `error` reads the
 * mutation's own `.error`, reset (alongside the local `message`) on the same term-change effect the
 * pre-migration `error`/`message` state already had.
 */

export interface TermDetailPanelOptions {
  term: AdminTerm;
  onRenamed: () => void;
}

export interface TermDetailPanelController {
  newName: string;
  setNewName: (newName: string) => void;
  saving: boolean;
  message: string | null;
  error: string | null;
  rename: (e: React.FormEvent) => Promise<void>;
}

/** What the host passes useTermDetailPanel: the caller's options, the bound port, the resolved admin
 *  locale and the host's {@link TaxonomyHostKit}. */
export interface UseTermDetailPanelArgs {
  options: TermDetailPanelOptions;
  port: TaxonomyPort;
  locale: string;
  kit: TaxonomyHostKit;
}

export function useTermDetailPanel(
  { options, port, locale, kit }: UseTermDetailPanelArgs,
  _optional: Record<string, never> = {}
): TermDetailPanelController {
  const { term, onRenamed } = options;
  const [newName, setNewName] = useState(term.name);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const renameMutation = useFetchMutation({
    run: ({ input: name }: { input: string }) => port.renameTerm({ termId: term.id, newName: name }),
  }, {
    invalidates: [KEYS.list],
  });

  // Stale-response guard (2026-09-05, same class of bug `use-widget-instance-editor.hooks.ts`'s
  // `activeEntityRef` already fixes for its own save()-after-navigate case): `Taxonomy.tsx` mounts
  // `TermDetailPanel` with no `key={term.id}` — switching the selected term re-renders this SAME
  // hook instance with a new `term` prop rather than remounting a fresh one, so a `rename()` in
  // flight for the term the operator just navigated AWAY FROM has no effect-cleanup moment of its
  // own to learn that happened. `activeTermIdRef` always holds the latest term id this hook was
  // RENDERED with (updated every render, not just on effect re-run); `rename()`'s completion
  // handlers below skip committing `message`/`error`/`saving` onto whatever term is on screen now
  // once the operator has switched. `saving`/`error` are local state rather than read straight off
  // `renameMutation.status`/`.error` for the same reason: that mutation object is NOT re-created per
  // term, so a stale settlement could otherwise flip it again after the term-change effect below has
  // already reset it.
  const activeTermIdRef = useRef(term.id);
  activeTermIdRef.current = term.id;
  const resetRename = renameMutation.reset;

  // `renameMutation` intentionally excluded — same deps as the pre-migration effect
  // ([term.id, term.name]); including the mutation object would re-run this on every status change.
  useEffect(() => {
    if (activeTermIdRef.current !== term.id) return;
    setNewName(term.name);
    setMessage(null);
    setError(null);
    setSaving(false);
    resetRename();
  }, [term.id, term.name, resetRename]);

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || newName.trim() === term.name) return;
    const renamingForTermId = term.id;
    setMessage(null);
    setError(null);
    setSaving(true);
    try {
      await renameMutation.mutate({ input: newName.trim() });
      if (activeTermIdRef.current !== renamingForTermId) return; // superseded by a term switch
      setMessage(kit.translate({ locale: locale, key: "Renamed." }));
      onRenamed();
    } catch (err) {
      if (activeTermIdRef.current !== renamingForTermId) return;
      setError(kit.describeApiError({ e: err, fallback: kit.translate({ locale: locale, key: "Failed to rename term" }) }));
    } finally {
      if (activeTermIdRef.current === renamingForTermId) setSaving(false);
    }
  }

  return { newName, setNewName, saving, message, error, rename };
}
