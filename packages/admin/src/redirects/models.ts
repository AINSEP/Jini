/** View configuration; redirect records and write contracts belong to core/ports/redirects. */
export type RedirectsTranslate = (key: string, vars?: Record<string, string | number>) => string;
export type RedirectsMessageKey = 'importRulesLabel' | 'deleteRedirectBody';
export interface RedirectsRowAction {
  key: string;
  label: string;
  destructive?: boolean;
  onSelect: () => void;
}
export interface RedirectsWriteState { status: 'idle' | 'pending' | 'success' | 'error'; error: Error | null }
