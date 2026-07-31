import { useT } from '../../../i18n/index.js';
import { isActionPending } from '@jini-ai/ui-core';
import { SourceConfigAddForm, type SourceConfigAddFormProps } from './SourceConfigAddForm.js';
import { SourceConfigItemCard } from './SourceConfigItemCard.js';
import type { SourceConfigListCapabilities } from '../hooks/useSourceConfigList.js';
import type { SourceConfigItem, SourceFieldSpec, SourceTestResult, SourceTrustOption, SourceUpdateInput } from '@jini-ai/ui-core';

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
}

/**
 * Pure composition of the add-form + item list (props in, JSX out) — the
 * generic `SourceConfigList<TSource>` primitive's presentational half. The
 * wired orchestrator (`SourceConfigList.tsx`) supplies every prop from its
 * hooks.
 */
export function SourceConfigListView<TSource extends SourceConfigItem>({
  title,
  subtitle,
  emptyMessage,
  fieldSpecs,
  trustOptions,
  sources,
  loading,
  loadError,
  capabilities,
  pendingKeys,
  testResults,
  addForm,
  onRefresh,
  onRemove,
  onTrustChange,
  onTest,
  onUpdate,
}: SourceConfigListViewProps<TSource>) {
  const t = useT();

  return (
    <section className="source-config-list">
      {title || subtitle ? (
        <div className="source-config-list-head">
          {title ? <h3>{t(title)}</h3> : null}
          {subtitle ? <p className="source-config-list-subtitle">{t(subtitle)}</p> : null}
        </div>
      ) : null}

      <SourceConfigAddForm {...addForm} fieldSpecs={fieldSpecs} {...(trustOptions ? { trustOptions } : {})} />

      {loadError ? (
        <div className="source-config-list-error" role="alert">
          {t(loadError)}
        </div>
      ) : null}

      {loading ? (
        <div className="source-config-list-loading" role="status">
          {t('Loading…')}
        </div>
      ) : sources.length === 0 ? (
        <div className="source-config-list-empty">{emptyMessage ? t(emptyMessage) : t('No sources configured yet.')}</div>
      ) : (
        <div className="source-config-list-items">
          {sources.map((source) => (
            <SourceConfigItemCard
              key={source.id}
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
              {...(testResults[source.id] ? { testResult: testResults[source.id] } : {})}
            />
          ))}
        </div>
      )}
    </section>
  );
}
