import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdminErasedEntityPort } from '../../core/ports/entities.js';
import type { EntityEditProps } from './types.js';
import { draftForRow, invalidDraftFields, missingRequiredFields } from './rules.js';
import { loadEntityRow, useEntityRead } from './use-entity-read.js';

interface FormState {
  readonly draft: Record<string, unknown>;
  readonly jsonText: Readonly<Record<string, string>>;
  readonly jsonErrors: Readonly<Record<string, boolean>>;
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
  const [mutation, setMutation] = useState<{ scope: unknown; kind: 'save' | 'remove' | null; failed: boolean }>({ scope, kind: null, failed: false });
  const busy = useRef(false);
  let form = formState?.scope === scope ? formState.form : null;
  if (read.data && form === null && (id === null || read.data.row !== null)) {
    const draft = draftForRow({ descriptor: port.descriptor, row: read.data.row });
    const jsonText: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const field of port.descriptor.fields) {
      if (field.kind === 'json') jsonText[field.name] = draft[field.name] === undefined ? '' : JSON.stringify(draft[field.name], null, 2);
    }
    form = { draft, jsonText, jsonErrors: {} };
    setFormState({ scope, form });
  }
  const draft = form?.draft ?? {};
  const missing = missingRequiredFields({ descriptor: port.descriptor, draft });
  const invalid = invalidDraftFields({ descriptor: port.descriptor, draft });
  const pending = mutation.scope === scope ? mutation.kind : null;
  const canSave = form !== null && missing.length === 0 && invalid.length === 0 &&
    !Object.values(form.jsonErrors).some(Boolean) && pending === null;

  function setField({ name, value }: { readonly name: string; readonly value: unknown }): void {
    if (!port.descriptor.fields.some((field) => field.name === name) || busy.current) return;
    setFormState((state) => state?.scope === scope ? { scope, form: { ...state.form, draft: { ...state.form.draft, [name]: value } } } : state);
  }

  function setJsonText({ name, text }: { readonly name: string; readonly text: string }): void {
    if (!port.descriptor.fields.some((field) => field.name === name && field.kind === 'json') || busy.current) return;
    let value: unknown;
    let failed = false;
    try { value = text.trim() === '' ? undefined : JSON.parse(text); } catch { failed = true; }
    setFormState((state) => state?.scope === scope ? {
      scope,
      form: {
        draft: failed ? state.form.draft : { ...state.form.draft, [name]: value },
        jsonText: { ...state.form.jsonText, [name]: text },
        jsonErrors: { ...state.form.jsonErrors, [name]: failed },
      },
    } : state);
  }

  async function mutate({ kind }: { readonly kind: 'save' | 'remove' }): Promise<void> {
    if (busy.current || (kind === 'save' && !canSave) || (kind === 'remove' && (id === null || port.remove === undefined))) return;
    busy.current = true;
    setMutation({ scope, kind, failed: false });
    const active = () => mounted.current && currentScope.current === scope;
    try {
      if (kind === 'remove' && id !== null && port.remove) {
        await port.remove(id);
        if (active()) routes.navigate({ entity: entityName });
      } else {
        // A create omits blanks; an update carries explicit undefined to clear optional fields.
        const saved = id === null
          ? await port.create(Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== undefined)))
          : await port.update(id, draft);
        if (active()) routes.navigate({ entity: entityName, id: saved.id });
      }
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
