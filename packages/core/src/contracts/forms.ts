/** @agent-note Types and one constant. What form-collection providers and form-submission records share. */

/** Contract name under which form-collection providers register. */
export const FORM_COLLECTION_CONTRACT = 'form_collection';

export interface FormProviderSelection { readonly id: string; readonly config: Readonly<Record<string, string>>; }
export interface FormCollectionCapabilities {
  readonly answers: string;
  readonly validation: string;
  readonly spamProtection: string;
}
/** Public settings only; secrets and provider credentials never belong in form definitions. */
export interface FormProviderDescription {
  readonly id: string;
  readonly label: string;
  readonly fields: readonly { readonly key: string; readonly label: string; readonly type: 'text' | 'url'; readonly helpText?: string }[];
  readonly helpText?: string;
  readonly answers: string;
  readonly validation: string;
  readonly frameOrigins: readonly string[];
  readonly available: boolean;
  readonly message?: string;
}
export type FormCollectionPlan =
  | { readonly kind: 'post'; readonly action: string; readonly external: boolean; readonly capabilities: FormCollectionCapabilities }
  | { readonly kind: 'embed'; readonly url: string; readonly title: string; readonly capabilities: FormCollectionCapabilities; readonly consent?: readonly ('necessary' | 'functional' | 'analytics' | 'marketing')[]; readonly publicUrl?: string; readonly fallbackMessage?: string }
  | { readonly kind: 'unavailable'; readonly code: 'provider_unavailable' | 'invalid_configuration'; readonly message: string };
export interface FormCollectionProvider {
  describe?(): Omit<FormProviderDescription, 'id' | 'available'>;
  plan(required: { readonly slug: string; readonly config: Readonly<Record<string, string>> }, optional?: Record<string, never>): FormCollectionPlan;
}

export interface FormFileReference { mediaId: string; filename: string; contentType: string; byteSize: number; }
export type FormAnswer = string | boolean | number | string[] | FormFileReference;

/** A declared form field. `T` names the host's field-type vocabulary; the vocabulary itself is host policy. */
export interface FormFieldDescriptor<T extends string = string> {
  id: string;
  label: string;
  type: T;
  required: boolean;
  /** Optional HTML name; must equal the stable id so historic submission keys remain valid. */
  name?: string;
  placeholder?: string;
  helpText?: string;
  default?: string | number | boolean | string[];
  options?: Array<{ value: string; label: string }>;
  minLength?: number;
  maxLength?: number | null;
  /** Full-match, bounded safe regular expression; groups/alternation/backreferences are refused. */
  pattern?: string;
  min?: number | string;
  max?: number | string;
  step?: number;
  /** Omitted accept means every recognized safe type, never executable/markup/archive formats. */
  accept?: string[];
  maxFileSize?: number;
  /** Presence distinguishes an authored checkbox value (even "") from the native boolean default. */
  checkboxValue?: string;

  /** Length-bounded and HTML-escaped at rendering; class names are inert after escaping. */
  className?: string;

  /** Attribute names require a closed allowlist: escaping a name cannot make it safe.
   * Values remain plain strings and must be HTML-escaped by the renderer. */
  attributes?: Record<string, string>;
}

/** Immutable form-owned context; answers remain in the existing answer map, never in evidence. */
export interface FormSubmissionEvidence<T extends string = string> {
  readonly version: 1;
  readonly fields: FormFieldDescriptor<T>[];
  readonly consent: Array<{ fieldId: string; wording: string; helpText?: string }>;
  readonly schemaHash: string;
  readonly capturedAt: string;
  readonly source: 'native' | 'cloudflare';
  /** Complete authored body retains consent prose outside checkbox labels without guessing. */
  readonly html?: string;
}
