import { useCallback, useEffect, useMemo, useState } from "react";
import type { Translate } from "@jini-ai/core/text";

type SourceConfigItem = { id: string; enabled?: boolean; fields: Record<string, string> };
type SavedConnectionIntent<Transport extends string> = {
  allowedToolNames: string; enabled: boolean; transport: Transport; command: string; needsSignIn: boolean;
};

/**
 * @file `ExternalMcpSettingsPanel.tsx`'s own derived-value logic, split out per the
 * `<Name>.tsx`/`<Name>.hooks.tsx` pattern `TabBar.tsx`/`TabBar.hooks.tsx` establishes (admin
 * TSX-logic-sweep, 2026-09-05) — this repo's rule that a `.tsx` file carries no functions or derived
 * logic of its own.
 */

/** `ExternalMcpSettingsPanel`'s own per-card agent handles. Not `useMemo`'d: an O(n) pass (see
 *  `buildAgentListHandles`'s own `@complexity` doc, which `buildExternalMcpCardHandles` wraps) over
 *  one workspace's own configured external MCP servers — small and cheap enough next to the render
 *  it feeds that memoizing it was not judged worth the added indirection. That is a decision about
 *  memoization, separate from why this now lives outside the component body at all (the
 *  `.tsx` bodies carry no derived logic). */
export function resolveExternalMcpCardHandles({ sources, buildHandles }: { sources: readonly SourceConfigItem[]; buildHandles: (required: { sourceIds: string[] }) => string[] }, _optional: Record<string, never> = {}): string[] {
  return buildHandles({ sourceIds: sources.map((source) => source.id) });
}

/** Each card's saved intent, keyed by server id — the "saved" half of the saved-vs-live comparison
 *  the admissions banner states. Memoized because it is the dependency of a `useMemo` inside
 *  `useExternalMcpAdmissions`: rebuilding the object every render would make that memo useless.
 *
 *  `enabled` joined `allowedToolNames` here for ADM-001 (2026-09-07): the banner now reports a saved
 *  connection the daemon is not running, and without the toggle it would report every server the
 *  operator deliberately switched off as a fault. `SourceConfigItem.enabled` is optional in
 *  `@jini-ai/ui`'s type; `toItem` in `use-external-mcp.hooks.ts` always sets it from the stored
 *  record, so `?? true` only ever covers a source that came from somewhere else — and "on" is the
 *  right reading of a missing flag, since a card with no toggle state is not one the operator
 *  turned off. Saved transport/command identify missing stdio launchers; the existing transport
 *  rule also supplies the legacy stdio default for cards without an explicit transport. */
export function useSavedAllowedToolNamesById<Source extends SourceConfigItem, Transport extends string>(
  { sources, resolveTransport, needsSignIn }: {
    sources: readonly Source[];
    resolveTransport: (fields: Record<string, string>) => Transport;
    needsSignIn: (required: { source: Source }) => boolean;
  },
  _optional: Record<string, never> = {},
): Record<string, SavedConnectionIntent<Transport>> {
  return useMemo(() => {
    const byId: Record<string, SavedConnectionIntent<Transport>> = {};
    for (const source of sources) {
      byId[source.id] = {
        allowedToolNames: source.fields["allowedToolNames"] ?? "",
        enabled: source.enabled ?? true,
        transport: resolveTransport(source.fields),
        command: source.fields["command"] ?? "",
        needsSignIn: needsSignIn({ source }),
      };
    }
    return byId;
  }, [sources, resolveTransport, needsSignIn]);
}

export function useExternalMcpDriftCopy(
  { useLocaleHook, translate }: { useLocaleHook: () => string; translate: (required: { locale: string; key: string }) => string },
  _optional: Record<string, never> = {},
): Translate {
  const locale = useLocaleHook();
  return useCallback((key: string) => translate({ locale: locale, key: key }), [locale, translate]);
}

/**
 * The banner's one-click fix, as the panel's `updateSource` patch.
 *
 * Written through the SAME port the card's own edit form uses, so `mergeSourceUpdate` fills in
 * every field this patch does not mention and `toWriteBody`'s omit-when-blank rules keep `env` and
 * `oauthClientSecret` from being wiped — the asymmetry `use-external-mcp.hooks.ts`'s header calls
 * the safe direction. Reaching for `api.saveExternalMcpServer` directly here would bypass both.
 *
 * @returns The patch, or `null` when the id names no configured card (nothing to write).
 */
export function buildAllowWritePatch(
  { sources, connectionId, remoteName, grantWriteFieldValue }: {
    sources: readonly SourceConfigItem[];
    connectionId: string;
    remoteName: string;
    grantWriteFieldValue: (required: { currentWriteAllowedToolNames: string | undefined; remoteName: string }) => string;
  },
  _options = {},
): { fields: Record<string, string> } | null {
  const source = sources.find((candidate) => candidate.id === connectionId);
  if (!source) return null;
  return { fields: { writeAllowedToolNames: grantWriteFieldValue({ currentWriteAllowedToolNames: source.fields["writeAllowedToolNames"], remoteName }) } };
}

/** Everything `ExternalMcpSettingsPanel` renders its "Add server" button and form from. */
export interface ExternalMcpAddFormController<FieldSpec, AddForm> {
  /** Whether the add form is showing (the "Add server" button's `aria-expanded`). */
  formOpen: boolean;
  /** "Add server": opens a closed form, closes an open one (without discarding the draft). */
  toggleForm: () => void;
  /** Cancel: discards the draft, not just hides it — reopening must not resurrect a half-typed
   *  server (or a typed secret) the operator chose to abandon — then closes the form. */
  cancelForm: () => void;
  /** The field specs for the draft's last-known transport/auth mode — one render behind a change,
   *  per `ExternalMcpSettingsPanel.tsx`'s "two-pass reactive field-spec sync" header. */
  fieldSpecs: FieldSpec[];
  /** `@jini-ai/ui`'s add-form controller (values, validation, submit, reset), seeded from
   *  {@link fieldSpecs}. */
  addForm: AddForm;
}

/**
 * Owns `ExternalMcpSettingsPanel`'s "Add server" form: its open state, the draft, and the lagged
 * transport/auth-mode sync that keeps the form's field specs following the operator's own choices
 * (see `ExternalMcpSettingsPanel.tsx`'s "two-pass reactive field-spec sync" header for why the sync
 * is one render behind, by design).
 *
 * `fieldSpecs` is deliberately rebuilt every render (not `useMemo`'d), exactly as it was when this
 * lived in the component body — this move changes where the logic lives, not how often it runs.
 *
 * @param input.dependencies - The same source-config port the panel's list uses.
 * @param input.list - Receives a newly added server (`addSourceToList`), so the roster shows it
 *   without a reload.
 * @returns See {@link ExternalMcpAddFormController}.
 * @complexity O(1) per render beyond `buildExternalMcpFieldSpecs`'s fixed-size spec list.
 */
export function useExternalMcpAddForm<Source, Dependencies, FieldSpec, AddForm extends {
  values: Record<string, string>; setField: (name: string, value: string) => void; reset: () => void;
}>(
  { dependencies, list, useDriftCopyHook, useSourceConfigAddFormHook, buildFieldSpecs, resolveTransport, resolveAuthMode }: {
    dependencies: Dependencies;
    list: { addSourceToList: (source: Source) => void };
    useDriftCopyHook: () => Translate;
    useSourceConfigAddFormHook: (required: { dependencies: Dependencies; fieldSpecs: FieldSpec[]; onAdded: (source: Source) => void }) => AddForm;
    buildFieldSpecs: (required: { transport: string; authMode: string }, optional: { t: Translate }) => FieldSpec[];
    resolveTransport: (fields: Record<string, string>) => string;
    resolveAuthMode: (fields: Record<string, string>) => string;
  },
  _optional: Record<string, never> = {},
): ExternalMcpAddFormController<FieldSpec, AddForm> {
  const t = useDriftCopyHook();
  const [formOpen, setFormOpen] = useState(false);
  const [transportGuess, setTransportGuess] = useState<string>("stdio");
  const [authModeGuess, setAuthModeGuess] = useState<string>("static_env");
  const fieldSpecs = buildFieldSpecs({ transport: transportGuess, authMode: authModeGuess }, { t });

  const addForm = useSourceConfigAddFormHook({
    dependencies,
    fieldSpecs,
    onAdded: (source) => {
      list.addSourceToList(source);
      setFormOpen(false);
    },
  });

  // Pre-select sensible defaults the instant the form opens, so the two `select` fields never show

  useEffect(() => {
    if (!formOpen) return;
    if (addForm.values.transport === "") addForm.setField("transport", "stdio");
    if (addForm.values.authMode === "") addForm.setField("authMode", "static_env");
  }, [formOpen, addForm.values.transport, addForm.values.authMode, addForm.setField]);

  // The lagged sync `ExternalMcpSettingsPanel.tsx`'s header describes.
  useEffect(() => {
    const nextTransport = resolveTransport(addForm.values);
    const nextAuthMode = resolveAuthMode(addForm.values);
    if (nextTransport !== transportGuess) setTransportGuess(nextTransport);
    if (nextAuthMode !== authModeGuess) setAuthModeGuess(nextAuthMode);
  }, [addForm.values, transportGuess, authModeGuess, resolveTransport, resolveAuthMode]);

  return {
    formOpen,
    toggleForm: () => setFormOpen((open) => !open),
    cancelForm: () => {
      addForm.reset();
      setFormOpen(false);
    },
    fieldSpecs,
    addForm,
  };
}
