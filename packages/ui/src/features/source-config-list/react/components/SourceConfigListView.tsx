import { useT } from '../../../i18n/index.js';
import { sourceConfigAddFormHandle, sourceConfigItemHandles } from '../../agent-handles.js';
import { isActionPending } from '../../rules.js';
import type {
  SourceConfigItem,
  SourceFieldSpec,
  SourceTestResult,
  SourceTrustOption,
  SourceUpdateInput,
} from '../../types.js';
import { SourceConfigAddForm, type SourceConfigAddFormProps } from './SourceConfigAddForm.js';
import { SourceConfigItemCard } from './SourceConfigItemCard.js';
import type { SourceConfigListCapabilities } from '../hooks/useSourceConfigList.js';

export interface SourceConfigListViewProps<TSource extends SourceConfigItem> {
  title?: string;
  subtitle?: string;
  emptyMessage?: string;
  fieldSpecs: readonly SourceFieldSpec[];
  trustOptions?: readonly SourceTrustOption[];
  sources: TSource[];
  loading: boolean;
  loadError?: string | null;
  capabilities: SourceConfigListCapabilities;
  pendingKeys: ReadonlySet<string>;
  testResults: Record<string, SourceTestResult>;
  addForm: Omit<SourceConfigAddFormProps, 'fieldSpecs' | 'trustOptions'>;
  onRefresh: (id: string) => void;
  onRemove: (id: string) => void;
  onTrustChange: (id: string, trust: string) => void;
  onTest: (id: string) => void;
  onUpdate: (id: string, patch: SourceUpdateInput) => void;
  /**
   * This whole list's own agent handle — publishes the add form as `<agentHandle>-add` and each
   * item card as `<agentHandle>-item-<slug of source.id>` (see `../../agent-handles.ts`'s
   * "list-level scheme" doc). Omit and no `data-agent-*` markup is emitted for either, same as
   * every other `agentHandle` prop in this feature.
   *
   * `addForm.agentHandle`, if the caller already set one explicitly, wins over the derived
   * `<agentHandle>-add` — this prop is a convenience default for the common case of one base
   * covering the whole list, not a override of a caller's more specific choice.
   */
  agentHandle?: string;
}

/**
 * Pure composition of the add-form + item list (props in, JSX out) — the
 * generic `SourceConfigList<TSource>` primitive's presentational half. The
 * wired orchestrator (`SourceConfigList.tsx`) supplies every prop from its
 * hooks.
 */
export function SourceConfigListView<TSource extends SourceConfigItem>(props: SourceConfigListViewProps<TSource>) {
  const { title, subtitle, fieldSpecs, trustOptions, addForm, agentHandle } = props;
  const resolvedAddFormHandle = addForm.agentHandle ?? (agentHandle ? sourceConfigAddFormHandle(agentHandle) : undefined);

  return (
    <section className="source-config-list">
      <SourceConfigListHead title={title} subtitle={subtitle} />

      <SourceConfigAddForm
        {...addForm}
        fieldSpecs={fieldSpecs}
        {...(trustOptions ? { trustOptions } : {})}
        {...(resolvedAddFormHandle ? { agentHandle: resolvedAddFormHandle } : {})}
      />

      <SourceConfigListError loadError={props.loadError} />

      <SourceConfigListBody {...props} />
    </section>
  );
}

/** The optional title/subtitle block — omitted entirely when neither is given. */
function SourceConfigListHead({ title, subtitle }: { title?: string | undefined; subtitle?: string | undefined }) {
  const t = useT();
  if (!title && !subtitle) return null;
  return (
    <div className="source-config-list-head">
      {title ? <h3>{t(title)}</h3> : null}
      {subtitle ? <p className="source-config-list-subtitle">{t(subtitle)}</p> : null}
    </div>
  );
}

function SourceConfigListError({ loadError }: { loadError?: string | null | undefined }) {
  const t = useT();
  if (!loadError) return null;
  return (
    <div className="source-config-list-error" role="alert">
      {t(loadError)}
    </div>
  );
}

/** The loading indicator, the empty message, or one item card per source — in that order of precedence. */
function SourceConfigListBody<TSource extends SourceConfigItem>(props: SourceConfigListViewProps<TSource>) {
  const t = useT();
  const { sources, loading, emptyMessage, agentHandle } = props;
  if (loading) {
    return (
      <div className="source-config-list-loading" role="status">
        {t('Loading…')}
      </div>
    );
  }
  if (sources.length === 0) {
    return <div className="source-config-list-empty">{emptyMessage ? t(emptyMessage) : t('No sources configured yet.')}</div>;
  }
  // Positionally aligned with `sources` below — computed once per render rather than per card, so
  // the O(n) suffix-search dedup in `buildAgentListHandles` runs once for the whole list, not once
  // per item.
  const itemHandles = agentHandle ? sourceConfigItemHandles(agentHandle, sources.map((source) => source.id)) : undefined;
  return (
    <div className="source-config-list-items">
      {sources.map((source, index) => (
        <SourceConfigListItem key={source.id} {...props} source={source} {...(itemHandles ? { itemHandle: itemHandles[index] } : {})} />
      ))}
    </div>
  );
}

/** One source's card, with the list-level per-id callbacks and pending state bound to that source. */
function SourceConfigListItem<TSource extends SourceConfigItem>({
  source,
  itemHandle,
  fieldSpecs,
  trustOptions,
  capabilities,
  pendingKeys,
  testResults,
  onRefresh,
  onRemove,
  onTrustChange,
  onTest,
  onUpdate,
}: SourceConfigListViewProps<TSource> & { source: TSource; itemHandle?: string | undefined }) {
  const testResult = testResults[source.id];
  return (
    <SourceConfigItemCard
      source={source}
      fieldSpecs={fieldSpecs}
      capabilities={capabilities}
      removing={isActionPending(pendingKeys, source.id, 'remove')}
      refreshing={isActionPending(pendingKeys, source.id, 'refresh')}
      settingTrust={isActionPending(pendingKeys, source.id, 'trust')}
      testing={isActionPending(pendingKeys, source.id, 'test')}
      updating={isActionPending(pendingKeys, source.id, 'update')}
      onRefresh={() => onRefresh(source.id)}
      onRemove={() => onRemove(source.id)}
      onTrustChange={(trust) => onTrustChange(source.id, trust)}
      onTest={() => onTest(source.id)}
      onUpdate={(patch) => onUpdate(source.id, patch)}
      {...(trustOptions ? { trustOptions } : {})}
      {...(testResult ? { testResult } : {})}
      {...(itemHandle !== undefined ? { agentHandle: itemHandle } : {})}
    />
  );
}
