import { useCallback, useMemo, useState } from 'react';
import { emptySourceDraft, validateSourceDraft } from '@jini-ai/ui-core';
import type { SourceConfigDependencies, SourceConfigPort } from '@jini-ai/ui-core';
import type { SourceConfigItem, SourceDraftValidation, SourceFieldSpec, SourceFieldValues } from '@jini-ai/ui-core';

export interface UseSourceConfigAddFormParams<TSource extends SourceConfigItem> {
  port: SourceConfigPort<TSource>;
  fieldSpecs: readonly SourceFieldSpec[];
  /** Called after a successful add, with the newly created source — the orchestrator uses this to append it to the list without a full reload. */
  onAdded?: (source: TSource) => void;
}

export interface SourceConfigAddFormController {
  values: SourceFieldValues;
  trust: string | undefined;
  validation: SourceDraftValidation;
  submitting: boolean;
  submitAttempted: boolean;
  submitError: string | null;
  setField: (key: string, value: string) => void;
  setTrust: (value: string | undefined) => void;
  submit: () => Promise<void>;
}

/**
 * Owns the "add a source" form draft: field values seeded from `fieldSpecs`,
 * an optional trust selection, validation (`rules.ts`'s
 * `validateSourceDraft`), and submission through the injected port. Mirrors
 * `PluginsView.tsx`'s `SourcesPanel`/`ConnectorsBrowser.tsx`'s "add
 * immediately on submit" shape rather than `McpClientSection.tsx`'s
 * draft-rows-with-a-separate-bulk-Save-button pattern — see
 * `packages/ui/source-map.md` for why that behavior was not ported.
 */
export function useSourceConfigAddForm<TSource extends SourceConfigItem>(
  params: UseSourceConfigAddFormParams<TSource>,
): SourceConfigAddFormController {
  const { port, fieldSpecs, onAdded } = params;
  const [values, setValues] = useState<SourceFieldValues>(() => emptySourceDraft(fieldSpecs));
  const [trust, setTrustState] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validation = useMemo(() => validateSourceDraft(fieldSpecs, values), [fieldSpecs, values]);

  const setField = useCallback((key: string, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
  }, []);

  const setTrust = useCallback((value: string | undefined) => {
    setTrustState(value);
  }, []);

  const submit = useCallback(async () => {
    setSubmitAttempted(true);
    if (!validation.ok) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await port.addSource(trust !== undefined ? { fields: values, trust } : { fields: values });
      if (result.ok && result.source) {
        setValues(emptySourceDraft(fieldSpecs));
        setTrustState(undefined);
        setSubmitAttempted(false);
        onAdded?.(result.source);
      } else {
        setSubmitError(result.message ?? 'Failed to add source.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [fieldSpecs, onAdded, port, trust, validation.ok, values]);

  return { values, trust, validation, submitting, submitAttempted, submitError, setField, setTrust, submit };
}

export type UseWiredSourceConfigAddFormParams<TSource extends SourceConfigItem> = Omit<
  UseSourceConfigAddFormParams<TSource>,
  'port'
> & {
  dependencies: SourceConfigDependencies<TSource>;
};

/** Wirer: binds `port` from a host-supplied `dependencies` (required — see `dependencies.ts`'s file-level comment). */
export function useWiredSourceConfigAddForm<TSource extends SourceConfigItem>(
  params: UseWiredSourceConfigAddFormParams<TSource>,
): SourceConfigAddFormController {
  const { dependencies, ...rest } = params;
  return useSourceConfigAddForm({ ...rest, port: dependencies.port });
}
