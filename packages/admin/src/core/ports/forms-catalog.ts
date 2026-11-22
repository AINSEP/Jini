/**
 * @file `FormsCatalogPort` — the forms domain's field vocabulary and safety rules, injected by the host.
 *
 * Admin edits form definitions but does not own what a field kind is, which file types are safe or which
 * patterns a browser may run. The host binds the forms domain's tables to this shape; a shape change on
 * either side fails typecheck at the binding. Field kinds are open strings, as in `AdminFormsPort`.
 */
export interface FormFieldKindInfo {
  readonly control: 'input' | 'textarea' | 'select' | 'group';
  readonly htmlType: string;
  readonly multiple?: boolean;
  readonly choices?: boolean;
  readonly textual?: boolean;
  readonly attributes?: Readonly<Record<string, string>>;
}

export interface FormsCatalogPort {
  readonly fieldKinds: Readonly<Record<string, FormFieldKindInfo>>;
  readonly maxFileBytes: number;
  readonly safeFileTypes: Readonly<Record<string, readonly string[]>>;
  isBrowserSafePattern(required: { pattern: string }, optional?: Record<string, never>): boolean;
  escapeHtml(required: { value: string }, optional?: Record<string, never>): string;
}
