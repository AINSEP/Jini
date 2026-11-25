/**
 * @file The UI library's shapes the admin kit restates (see `kit.tsx`'s file doc): execution config
 * and credential controller, settings slices, source-config lists, privacy and memory records, and a
 * few small ports. Split out of `kit.tsx` only for size; `./react/kit` re-states them as part of its
 * own public types, nothing else imports this file. The execution contract itself lives in core and
 * is re-exported by name from `kit.tsx`, not restated here.
 */
import type { InputHTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import type { ExecutionCardAgent, ExecutionPort } from '@jini-ai/core/contracts/execution';
import type { ByokConfig } from '@jini-ai/core/contracts/execution';

/* ---------- settings slices ---------- */
export type SettingsRefreshScope = readonly string[] | null;
export interface SettingsSliceRefreshPort {
  publish(required: { namespaces: readonly string[] }, optional?: Record<string, never>): void;
  subscribe(required: { listener: (scope: SettingsRefreshScope) => void }, optional?: Record<string, never>): () => void;
}
export interface SettingsSliceOptions<T> {
  load: (required: Record<string, never>, optional?: Record<string, never>) => Promise<T>;
  save: (required: { next: T; previous: T }, optional?: Record<string, never>) => Promise<readonly string[]>;
  defaultValue: T;
  namespaces?: readonly string[];
  refreshPort: SettingsSliceRefreshPort;
  reconcileRefresh?: (required: { current: T; loaded: T }, optional?: Record<string, never>) => T;
}
export type KitSaveState = { status: 'idle' } | { status: 'saving' } | { status: 'saved' } | { status: 'error'; message: string };
export interface SettingsSlice<T> {
  value: T | null; loadError: string | null; saveState: KitSaveState; onChange: (next: T) => void; refresh: () => Promise<void>;
}

/* ---------- execution credential and http adapter ---------- */
export interface ExecutionCredentialView { isSet: boolean; masked: string | null; baseUrl: string | null }
export interface ExecutionCredentialPatch {
  apiKey?: string; protocol?: string; providerId?: string | null; baseUrl?: string; model?: string; maxTokens?: number;
}
export interface ExecutionCredentialPort<TStored extends ExecutionCredentialView> {
  loadAdminExecutionCredential(required: Record<string, never>, optional?: Record<string, never>): Promise<TStored>;
  saveAdminExecutionCredential(required: { patch: ExecutionCredentialPatch }, optional?: Record<string, never>): Promise<TStored>;
}
export interface ExecutionCredentialEffects<TStored extends ExecutionCredentialView> {
  namespace: string;
  refreshPort: SettingsSliceRefreshPort;
  readLegacyCredential(required: Record<string, never>, optional?: Record<string, never>): string | null;
  clearLegacyCredential(required: Record<string, never>, optional?: Record<string, never>): void;
  describeError(required: { error: unknown; fallback: string }, optional?: Record<string, never>): string;
  hasTypedKey(required: { apiKey: string }, optional?: Record<string, never>): boolean;
  storedKeyIsForOtherEndpoint(required: { stored: TStored | null; baseUrl: string }, optional?: Record<string, never>): boolean;
  hasUsableKey(required: { apiKey: string; stored: TStored | null; baseUrl: string }, optional?: Record<string, never>): boolean;
  storedKeyBlocksProbe(required: { apiKey: string; stored: TStored | null; baseUrl: string }, optional?: Record<string, never>): boolean;
  credentialHint(required: { stored: TStored | null; storedKeyIsForOtherEndpoint: boolean }, optional?: { locale?: string | undefined }): string | undefined;
}
export type ExecutionCredentialSaveState = KitSaveState;
export interface UseExecutionCredentialInput { locale?: string | undefined; byok: ByokConfig; onByokChange: (next: ByokConfig) => void }
export interface ExecutionCredentialController<TStored extends ExecutionCredentialView> {
  stored: TStored | null; apiKeyStoredExternally: boolean; apiKeyPlaceholder: string | undefined; storedKeyIsForOtherEndpoint: boolean;
  canDiscoverModels: boolean; saveState: ExecutionCredentialSaveState; settingsSaveState: ExecutionCredentialSaveState; canSaveKey: boolean;
  saveKey: () => Promise<void>; saveSettings: () => Promise<void>; legacyKey: string | null; migrateLegacyKey: () => Promise<void>;
  dismissLegacyPrompt: () => void;
}
export interface ExecutionProbeFlags { useStoredCredential?: boolean; useAdminStoredCredential?: boolean }
export interface ExecutionProbeTransport {
  detectExecutionAgents(required: Record<string, never>, optional?: { force?: boolean }): Promise<{ data: readonly ExecutionCardAgent[] }>;
  testExecutionConnection(required: Pick<ByokConfig, 'protocol' | 'baseUrl' | 'apiKey' | 'model'> & ExecutionProbeFlags, optional?: Record<string, never>): Promise<{ ok: boolean; message?: string }>;
  testExecutionAgent(required: { agentId: string; model?: string }, optional?: Record<string, never>): ReturnType<NonNullable<ExecutionPort['testAgent']>>;
  listExecutionModels(required: Pick<ByokConfig, 'protocol' | 'baseUrl' | 'apiKey'> & ExecutionProbeFlags, optional?: Record<string, never>)
    : Promise<{ ok: boolean; models: readonly string[]; message?: string }>;
}
export interface CreateExecutionPortOptions { useStoredCredential?: boolean; useAdminStoredCredential?: boolean }

/* ---------- source-config lists ---------- */
export type SourceFieldKind = 'text' | 'url' | 'password' | 'select' | 'textarea' | 'secret-textarea';
export interface SourceFieldOption { value: string; label: string }
export interface SourceFieldSpec { key: string; label: string; kind: SourceFieldKind; placeholder?: string; required?: boolean; options?: SourceFieldOption[] }
export type SourceFieldValues = Record<string, string>;
export type SourceConnectionStatus = 'idle' | 'testing' | 'connected' | 'error';
export interface SourceTestResult { ok: boolean; message?: string; latencyMs?: number }
export interface SourceConfigItem {
  id: string; label?: string; trust?: string; enabled?: boolean; fields: SourceFieldValues; status?: SourceConnectionStatus; statusMessage?: string;
}
export interface SourceUpdateInput { label?: string; enabled?: boolean; fields?: SourceFieldValues }
export interface AddSourceInput { fields: SourceFieldValues; trust?: string }
export interface AddSourceResult<TSource extends SourceConfigItem = SourceConfigItem> { ok: boolean; source?: TSource; message?: string }
export interface SourceConfigPort<TSource extends SourceConfigItem = SourceConfigItem> {
  fetchSources(): Promise<TSource[]>;
  addSource(input: AddSourceInput): Promise<AddSourceResult<TSource>>;
  removeSource(id: string): Promise<boolean>;
  refreshSource?(id: string): Promise<TSource | null>;
  setTrust?(id: string, trust: string): Promise<TSource | null>;
  updateSource?(id: string, patch: SourceUpdateInput): Promise<TSource | null>;
  testSource?(id: string | undefined, draft?: SourceFieldValues): Promise<SourceTestResult>;
}
export interface SourceConfigDependencies<TSource extends SourceConfigItem = SourceConfigItem> { port: SourceConfigPort<TSource> }

/* ---------- privacy and memory records ---------- */
export interface TelemetryPreferences { metrics?: boolean; content?: boolean }
export interface PrivacyConsentState { telemetry: TelemetryPreferences; installationId: string | null; privacyDecisionAt: number | null }
export type MemoryConfigFlagKey = 'chatExtractionEnabled' | 'profileEnabled' | 'rewriteEnabled' | 'verifyEnabled';
export type MemoryType = 'profile' | 'user' | 'feedback' | 'project' | 'reference' | 'rule';
export interface MemoryEntrySummary { id: string; name: string; description: string; type: MemoryType }
export type MemoryExtractionPhase = 'running' | 'success' | 'skipped' | 'failed' | 'deleted' | 'cleared';
export type MemoryExtractionSkipReason = 'no-provider' | 'memory-disabled' | 'chat-disabled' | 'empty-message' | 'no-match';
export interface MemoryExtractionProvider { kind?: string | undefined; credentialSource?: string | undefined }
export interface MemoryExtractionRecord {
  id: string; phase: MemoryExtractionPhase; kind?: 'llm' | 'heuristic' | 'connector' | undefined; reason?: MemoryExtractionSkipReason | undefined;
  provider?: MemoryExtractionProvider | undefined; error?: string | undefined; userMessagePreview?: string | undefined;
  writtenCount?: number | undefined; writtenIds?: string[] | undefined; startedAt: number; finishedAt?: number | undefined;
}

/* ---------- small ports and props ---------- */
export interface FolderPathDropPort { getPathForFile(file: File): string }
export type HtmlPreviewPort = (input: { source: string }, options: { signal: AbortSignal }) => Promise<string>;
export interface HtmlPreviewState { document: string; loading: boolean; error: string | null }
export interface CursorPage<Item> { items: Item[]; nextCursor: string | null }
export interface CursorPages<Filters, Item> {
  rows: Item[] | null; nextCursor: string | null; failure: { error: unknown } | null; appliedFilters: Filters;
  applyFilters: (filters: Filters) => void; loadingMore: boolean; loadMore: () => Promise<void>;
}
export interface SecretToggleProps {
  readonly label: string; readonly toggleLabels?: { readonly show: string; readonly hide: string };
  readonly toggleAttrs?: Readonly<Record<string, string | boolean | undefined>>;
  readonly revealed?: boolean; readonly onRevealedChange?: (revealed: boolean) => void;
}
export type SecretInputProps = SecretToggleProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/* ---------- settings screens' own slots (x8-w3) ---------- */
/** Props of the host's "show N lines, expand on demand" text clamp (`SeeMore`). */
export interface SeeMoreProps {
  children: ReactNode;
  lines?: number | undefined;
  moreLabel?: string | undefined;
  lessLabel?: string | undefined;
  className?: string | undefined;
  textClassName?: string | undefined;
  toggleClassName?: string | undefined;
  toggleAriaLabel?: string | undefined;
  agentHandle?: string | false | undefined;
}
/** One model entry the searchable model picker lists (the execution contract's `AgentModelOption`, narrowed to what the picker reads). */
export interface SearchableModelOption { id: string; label: string }
/** Props of the host's searchable model dropdown (a plain select plus a search box once the list is long). */
export interface SearchableModelSelectProps {
  models: readonly SearchableModelOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  searchPlaceholder: string;
  additionalOptions?: readonly { value: string; label: string }[] | undefined;
  minSearchableOptions?: number;
  className?: string | undefined;
  menuClassName?: string | undefined;
  testId?: string | undefined;
  searchInputTestId?: string | undefined;
  agentHandle?: string | false | undefined;
}

/* ---------- package-file tree ---------- */
/** One visible row of the package-files tree: the ARIA positions and handlers a row spreads onto its element. `expanded` is set only on folders. */
export interface PackageFileTreeRowView {
  readonly key: string; readonly name: string; readonly path: string; readonly depth: number; readonly setSize: number; readonly posInSet: number;
  readonly expanded: boolean | undefined; readonly selected: boolean | undefined; readonly tabIndex: number;
  onClick(): void; onFocus(): void;
}
/** The tree's rows plus the key handler for its container: expansion, roving focus and keyboard navigation live behind the host's hook. */
export interface PackageFileTreeController { readonly rows: readonly PackageFileTreeRowView[]; onKeyDown(event: KeyboardEvent<HTMLElement>): void }
/** The files a tree is built from (only the paths matter) and the selection and open callback it reports through. */
export interface PackageFileTreeInput {
  readonly files: readonly { readonly relativePath: string; readonly sizeBytes: number; readonly content: string | null; readonly omitted: null }[];
  readonly selectedPath: string | null;
  onOpen(required: { path: string }, optional?: Record<string, never>): void;
}
