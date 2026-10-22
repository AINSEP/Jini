import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdminErasedEntityPort } from '../../core/ports/entities.js';
import type { EntityEditProps } from './types.js';
import { draftForRow, invalidDraftFields, missingRequiredFields } from './rules.js';
import { loadEntityRow, useEntityRead, type EntityLoadedRow } from './use-entity-read.js';

interface FormState {
  readonly draft: Record<string, unknown>;
  readonly jsonText: Readonly<Record<string, string>>;
  readonly jsonErrors: Readonly<Record<string, boolean>>;
}

type MutationKind = 'save' | 'remove';
type Descriptor = AdminErasedEntityPort['descriptor'];

/** The first form for a loaded row, or null while it is loading or an edited row was not found. */
function initialForm({ descriptor, loaded, id }: {
  readonly descriptor: Descriptor; readonly loaded: EntityLoadedRow | undefined; readonly id: string | null;
}): FormState | null {
  if (!loaded || (id !== null && loaded.row === null)) return null;
  const draft = draftForRow({ descriptor, row: loaded.row });
  const jsonText: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const field of descriptor.fields) {
    if (field.kind === 'json') jsonText[field.name] = draft[field.name] === undefined ? '' : JSON.stringify(draft[field.name], null, 2);
  }
  return { draft, jsonText, jsonErrors: {} };
}

function canSaveForm({ form, missing, invalid, pending }: {
  readonly form: FormState | null; readonly missing: readonly unknown[]; readonly invalid: readonly unknown[]; readonly pending: MutationKind | null;
}): boolean {
  if (form === null || pending !== null) return false;
  return missing.length === 0 && invalid.length === 0 && !Object.values(form.jsonErrors).some(Boolean);
}

function parseJsonText(text: string): { readonly value: unknown; readonly failed: boolean } {
  try { return { value: text.trim() === '' ? undefined : JSON.parse(text), failed: false }; } catch { return { value: undefined, failed: true }; }
}

function mutationAllowed({ kind, canSave, id, port }: {
  readonly kind: MutationKind; readonly canSave: boolean; readonly id: string | null; readonly port: AdminErasedEntityPort;
}): boolean {
  if (kind === 'save') return canSave;
  return id !== null && port.remove !== undefined;
}

/** Run the port call; resolves to the saved row's id, or null after a removal. */
async function performMutation({ kind, port, id, draft }: {
  readonly kind: MutationKind; readonly port: AdminErasedEntityPort; readonly id: string | null; readonly draft: Record<string, unknown>;
}): Promise<string | null> {
  if (kind === 'remove' && id !== null && port.remove) {
    await port.remove(id);
    return null;
  }
  // A create omits blanks; an update carries explicit undefined to clear optional fields.
  const saved = id === null
    ? await port.create(Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== undefined)))
    : await port.update(id, draft);
  return saved.id;
}

/** Called by the editor mounted for one entity/id pair. */
export function useEntityEdit({ port, ...props }: EntityEditProps & { readonly port: AdminErasedEntityPort }) {
  const { entityName, id, registry, routes } = props;
  const scope = useMemo(() => ({ port, registry, entityName, id }), [port, registry, entityName, id]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const load = useCallback(() => loadEntityRow({ registry, entityName, id }), [registry, entityName, id, port]);
  const read = useEntityRead({ load, scope });
  const [formState, setFormState] = useState<{ scope: unknown; form: FormState } | null>(null);
  const [mutation, setMutation] = useState<{ scope: unknown; kind: MutationKind | null; failed: boolean }>({ scope, kind: null, failed: false });
  const busy = useRef(false);
  let form = formState?.scope === scope ? formState.form : null;
  if (form === null) {
    form = initialForm({ descriptor: port.descriptor, loaded: read.data, id });
    if (form !== null) setFormState({ scope, form });
  }
  const draft = form?.draft ?? {};
  const missing = missingRequiredFields({ descriptor: port.descriptor, draft });
  const invalid = invalidDraftFields({ descriptor: port.descriptor, draft });
  const pending = mutation.scope === scope ? mutation.kind : null;
  const canSave = canSaveForm({ form, missing, invalid, pending });

  function setField({ name, value }: { readonly name: string; readonly value: unknown }): void {
    if (!port.descriptor.fields.some((field) => field.name === name) || busy.current) return;
    setFormState((state) => state?.scope === scope ? { scope, form: { ...state.form, draft: { ...state.form.draft, [name]: value } } } : state);
  }

  function setJsonText({ name, text }: { readonly name: string; readonly text: string }): void {
    if (!port.descriptor.fields.some((field) => field.name === name && field.kind === 'json') || busy.current) return;
    const { value, failed } = parseJsonText(text);
    setFormState((state) => state?.scope === scope ? {
      scope,
      form: {
        draft: failed ? state.form.draft : { ...state.form.draft, [name]: value },
        jsonText: { ...state.form.jsonText, [name]: text },
        jsonErrors: { ...state.form.jsonErrors, [name]: failed },
      },
    } : state);
  }

  async function mutate({ kind }: { readonly kind: MutationKind }): Promise<void> {
    if (busy.current || !mutationAllowed({ kind, canSave, id, port })) return;
    busy.current = true;
    setMutation({ scope, kind, failed: false });
    const active = () => mounted.current && currentScope.current === scope;
    try {
      const savedId = await performMutation({ kind, port, id, draft });
      if (active()) routes.navigate(savedId === null ? { entity: entityName } : { entity: entityName, id: savedId });
      if (active()) setMutation({ scope, kind: null, failed: false });
    } catch {
      if (active()) setMutation({ scope, kind: null, failed: true });
    } finally { busy.current = false; }
  }

  return {
    form, read, missing, invalid, canSave, pending,
    failed: mutation.scope === scope && mutation.failed,
    setField, setJsonText,
    save: () => mutate({ kind: 'save' }),
    remove: () => mutate({ kind: 'remove' }),
  };
}
