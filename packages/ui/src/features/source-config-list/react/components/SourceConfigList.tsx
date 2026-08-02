import { DRAFT_TEST_SCOPE } from '../../constants.js';
import type { SourceConfigDependencies } from '../../ports.js';
import type { SourceConfigItem, SourceFieldSpec, SourceTrustOption } from '../../types.js';
import { useSourceConfigList, useWiredSourceConfigList } from '../hooks/useSourceConfigList.js';
import { useSourceConfigAddForm, useWiredSourceConfigAddForm } from '../hooks/useSourceConfigAddForm.js';
import { SourceConfigListView } from './SourceConfigListView.js';

export interface SourceConfigListProps<TSource extends SourceConfigItem> {
  /** Host-supplied transport adapter. Required — see `dependencies.ts`'s file-level comment for why this generic primitive has no zero-config default. */
  dependencies: SourceConfigDependencies<TSource>;
  /** Which fields the add form (and each item card's expanded detail) renders. Each of the four origin sources has a genuinely different field set — this is the seam. */
  fieldSpecs: readonly SourceFieldSpec[];
  /** Omit entirely for a source shape with no trust concept (the origin MCP-server shape has none). */
  trustOptions?: readonly SourceTrustOption[];
  title?: string;
  subtitle?: string;
  emptyMessage?: string;
  addLabel?: string;
  /** Custom hook overrides for dependency injection / testing. */
  useWiredSourceConfigList?: typeof useWiredSourceConfigList;
  useWiredSourceConfigAddForm?: typeof useWiredSourceConfigAddForm;
}

/**
 * `SourceConfigList<TSource>` — the generic "add a source by URL/key, set
 * trust, list, per-item test/refresh/remove" primitive. Consolidates the
 * shape independently found in the origin product's `McpClientSection.tsx`,
 * `byok/*`, `PluginsView.tsx`'s `SourcesPanel`, and `EntryShell.tsx`'s
 * `OnboardingByokSetupPanel` — see `packages/ui/source-map.md` for full
 * per-source provenance and every dropped behavior.
 *
 * Composes the two feature hooks + the presentational `SourceConfigListView`
 * — this file itself does no rendering logic of its own beyond wiring.
 */
export function SourceConfigList<TSource extends SourceConfigItem>({
  dependencies,
  fieldSpecs,
  trustOptions,
  title,
  subtitle,
  emptyMessage,
  addLabel,
  useWiredSourceConfigList: useWiredSourceConfigListHook = useWiredSourceConfigList,
  useWiredSourceConfigAddForm: useWiredSourceConfigAddFormHook = useWiredSourceConfigAddForm,
}: SourceConfigListProps<TSource>) {
  const list = useWiredSourceConfigListHook<TSource>({ dependencies });
  const addForm = useWiredSourceConfigAddFormHook<TSource>({
    dependencies,
    fieldSpecs,
    onAdded: list.addSourceToList,
  });

  return (
    <SourceConfigListView<TSource>
      fieldSpecs={fieldSpecs}
      sources={list.sources}
      loading={list.loading}
      loadError={list.error}
      capabilities={list.capabilities}
      pendingKeys={list.pendingKeys}
      testResults={list.testResults}
      addForm={{
        values: addForm.values,
        trust: addForm.trust,
        validation: addForm.validation,
        submitAttempted: addForm.submitAttempted,
        submitting: addForm.submitting,
        submitError: addForm.submitError,
        onFieldChange: addForm.setField,
        onTrustChange: addForm.setTrust,
        onSubmit: () => void addForm.submit(),
        // Test-before-save: tests the CURRENT draft values, not a persisted
        // item — there is no id yet (see `ports.ts`'s `testSource` doc
        // comment). Pending/result state for this case is tracked under
        // `DRAFT_TEST_SCOPE` by `useSourceConfigList.test`.
        canTest: list.capabilities.canTest,
        testing: list.isPending(DRAFT_TEST_SCOPE, 'test'),
        onTest: () => void list.test(undefined, addForm.values),
        ...(list.testResults[DRAFT_TEST_SCOPE] ? { testResult: list.testResults[DRAFT_TEST_SCOPE] } : {}),
        ...(addLabel ? { addLabel } : {}),
      }}
      onRefresh={(id) => void list.refresh(id)}
      onRemove={(id) => void list.remove(id)}
      onTrustChange={(id, trust) => void list.setTrust(id, trust)}
      onTest={(id) => void list.test(id)}
      onUpdate={(id, patch) => void list.update(id, patch)}
      {...(trustOptions ? { trustOptions } : {})}
      {...(title ? { title } : {})}
      {...(subtitle ? { subtitle } : {})}
      {...(emptyMessage ? { emptyMessage } : {})}
    />
  );
}

// Re-exported so a host/test can compose the hooks directly (e.g. to inject
// a fake port without going through `dependencies.ts`) without importing
// from `../hooks/*` paths itself.
export { useSourceConfigList, useSourceConfigAddForm };
