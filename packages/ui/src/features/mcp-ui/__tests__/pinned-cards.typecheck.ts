/** Independent type-only copy of UI shapes at 35c4961af718f0f30591c46d2ea2756c4484a731. */
import type { SurfaceAskThenReport, SurfaceExchangeStore, ToolExecutionContext, ToolExecutionOptions } from "@jini-ai/core";


/** One fact. Values and previous snapshots must be JSON-serializable; strings remain supported. */
export interface PinnedSurfaceDetail {
  readonly label: string;
  readonly value: unknown;
  /** Presence enables a diff, including an explicitly absent previous override. */
  readonly previous?: unknown;
  /** Explicit, optionally translated labels keyed by dotted object path. */
  readonly labels?: Readonly<Record<string, string>>;
  /** Optional secondary context beneath the label, using the shared muted hint style. */
  readonly description?: string;
  /**
   * `code` discloses a monospace `<pre>` that keeps line breaks and scrolls inside its own box
   * past a fixed height, so long SQL or JSON remains readable without stretching the dialog past
   * its frame. `status` reserves one line for a short outcome value. Omitted (or `text`) permits
   * value-sensitive presentation, preserving plain inline strings for short prose.
   */
  readonly format?: 'text' | 'code' | 'status';
}


interface PinnedSurfaceFieldBase {
  /** HTML `name`, DOM `id` suffix, and the params key the value is posted under. */
  readonly name: string;
  readonly label: string;
  /** Help text, wired up with `aria-describedby`. */
  readonly hint?: string;
  readonly required?: boolean;
  /** Waive on an exact choice or an alternative control; headerNames restricts entered headers. Kept secrets are validated by the host. */
  readonly requiredUnless?: { readonly field: string; readonly equals: string; readonly orPresent?: string; readonly headerNames?: readonly string[] };
  /** Require only while the controlling public field matches one of these choices. */
  readonly requiredWhen?: { readonly field: string; readonly in: readonly string[] };
  readonly disabled?: boolean;
}


export interface PinnedStringField extends PinnedSurfaceFieldBase {
  readonly kind: 'string';
  /** A sealed saved value satisfies validation while the requirement remains visible. */
  readonly hasSavedValue?: boolean;
  readonly value?: string;
  readonly placeholder?: string;
  readonly multiline?: boolean;
  readonly rows?: number;
  /** Renders as a masked input or multiline textarea; pre-filled values are forbidden.
   *  See {@link TextInputProps.secret}. */
  readonly secret?: boolean;
}


export interface PinnedNumberField extends PinnedSurfaceFieldBase {
  readonly kind: 'number';
  readonly value?: number;
  readonly placeholder?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}


export interface PinnedBooleanField extends PinnedSurfaceFieldBase {
  readonly kind: 'boolean';
  readonly value?: boolean;
}


export interface PinnedEnumField extends PinnedSurfaceFieldBase {
  readonly kind: 'enum';
  readonly value?: string;
  readonly options: readonly PinnedSelectOption[];
  readonly placeholder?: string;
  /**
   * How the same one-of-N value is drawn. `select` (the default) hides the options until opened —
   * right for a long list; `radio` shows them all at once — right for a short one the human is
   * meant to compare before choosing. Presentation only: both post one string under `name`, and
   * both read back through the same `control.value` path, so `kind` stays `'enum'` either way.
   */
  readonly presentation?: 'select' | 'radio';
}


/**
 * A pick-any-number-of-N field.
 *
 * Its own kind rather than a flag on {@link PinnedEnumField}, because it is the only field whose value is
 * an **array** — `form.ts`'s `readField` and `isBlank` both branch on that, and no `presentation`
 * discriminator would have told them to.
 */
export interface PinnedMultiEnumField extends PinnedSurfaceFieldBase {
  readonly kind: 'multi-enum';
  /** Pre-checked values. Unknown entries check nothing rather than erroring. */
  readonly value?: readonly string[];
  readonly options: readonly PinnedSelectOption[];
}


export type PinnedSurfaceField = PinnedStringField | PinnedNumberField | PinnedBooleanField | PinnedEnumField | PinnedMultiEnumField;


export interface PinnedFormSurfaceSpec {
  readonly title: string;
  /** Resource framing carried through host form projections; ignored by HTML rendering. */
  readonly preferredFrameSize?: readonly [string, string];
  readonly description?: string;
  /** Read-only context shown above the fields — what the input is *about*. */
  readonly details?: readonly PinnedSurfaceDetail[];
  readonly fields: readonly PinnedSurfaceField[];
  /** Callout above the buttons. */
  readonly warning?: string;
  /** Styles the submit button as destructive. */
  readonly danger?: boolean;
  readonly submitLabel: string;
  /** Alternative submit buttons collect the same fields, with explicit action params. */
  readonly additionalSubmitActions?: readonly { readonly id: string; readonly label: string; readonly params: Readonly<Record<string, unknown>> }[];
  /** The tool the collected values are sent to. */
  readonly toolName: string;
  /**
   * Merged UNDER the collected field values, so a field can never be shadowed by a base param it
   * shares a name with. Where a confirmation token belongs when the form is a confirmation.
   */
  readonly baseParams?: Readonly<Record<string, unknown>>;
  /** Omit for a form with no cancel button. Give it a tool name to notify the server of the dismissal. */
  readonly cancel?: { readonly label: string; readonly toolName?: string; readonly params?: Readonly<Record<string, unknown>> };
  readonly text?: Partial<PinnedSurfaceStatusText & PinnedSecretInputText>;
  readonly app?: PinnedBridgeScriptSpec;
  readonly lang?: string;
  readonly tokens?: Partial<Record<PinnedSurfaceTokenName, string>>;
}


export interface PinnedSurfaceOutcomeSpec {
  readonly title: string;
  /** Resource framing carried through host outcome projections; ignored by HTML rendering. */
  readonly preferredFrameSize?: readonly [string, string];
  readonly description?: string;
  /** The facts of what actually happened — same shape as a confirmation's own `details`, but
   *  reporting the RESULT (e.g. the real URL, the real status) rather than what was proposed. */
  readonly details?: readonly PinnedSurfaceDetail[];
  /**
   * Styles the status line and, when {@link openLinkUrl} is also present, the open-link button.
   * THREE states, not a boolean — matching this package's own callers, which distinguish a genuine
   * partial outcome (e.g. a downstream product's static-publish "uploaded, but not yet confirmed reachable") from
   * both a plain success and a plain failure specifically so neither is misreported: folding
   * `'partial'` into `'success'` would claim something is live when it may not be reachable yet;
   * folding it into `'failure'` would hide that the operation itself did NOT fail (nothing needs
   * retrying, only a separate follow-up step). See `document.ts`'s own `[data-state="partial"]` rule
   * for why this needs a third visual state as well as a third value here, not merely a third string
   * that renders identically to one of the other two.
   */
  readonly state: 'success' | 'partial' | 'failure';
  /** The one human-facing sentence explaining the outcome — the actionable message on failure, or a
   *  short confirmation on success. Never a raw credential or provider response body; that boundary
   *  is the CALLER's responsibility (this builder only renders what it is given). */
  readonly message: string;
  /** When present, renders one button ("Open site" by default) that calls the bridge's `openLink`.
   *  Only meaningful alongside `state: 'success'` — a caller should not supply this for a failure. */
  readonly openLinkUrl?: string;
  readonly openLinkLabel?: string;
  /** A pending external action may be skipped through its existing surface exchange. */
  readonly cancel?: PinnedConfirmationToolAction;
  /** Identity reported to the Host in `ui/initialize`. Defaults to a generic one. */
  readonly app?: PinnedBridgeScriptSpec;
  readonly lang?: string;
  readonly tokens?: Partial<Record<PinnedSurfaceTokenName, string>>;
}


export interface PinnedSelectOption {
  /** The value posted back. */
  readonly value: string;
  /** What the human reads. Defaults to `value`. */
  readonly label?: string;
  readonly disabled?: boolean;
}


export interface PinnedBridgeScriptSpec {
  /** Reported to the Host as `appInfo.name` in `ui/initialize`. */
  readonly appName: string;
  /** Reported to the Host as `appInfo.version`. */
  readonly appVersion: string;
  /** Defaults to {@link MCP_UI_PROTOCOL_VERSION}. */
  readonly protocolVersion?: string;
}


/** Verbs the host can translate for a secret's reveal toggle; the field label is appended. */
export interface PinnedSecretInputText {
  readonly showSecret: string;
  readonly hideSecret: string;
}


/**
 * Every user-visible string a surface's script writes at runtime.
 *
 * Surfaces are HTML strings built outside React, so `features/i18n`'s `useT` cannot reach them — a
 * translated surface is one whose builder was handed translated text. These are the defaults for a
 * caller that has none.
 */
export interface PinnedSurfaceStatusText {
  /** Shown while a tool call is in flight. */
  readonly working: string;
  /** Shown when the call resolves. */
  readonly done: string;
  /** Prefixed to the Host's own error message when the call rejects. */
  readonly failedPrefix: string;
  /** Shown when the human dismisses a surface that has no cancel tool to call. */
  readonly dismissed: string;
  /** Prefixed to the comma-joined labels of unfilled required fields. */
  readonly missingPrefix: string;
  /** Shown when the Host says the dialog is no longer pending; the buttons stay disabled. */
  readonly expired: string;
}


/** A button that calls a tool when clicked. */
export interface PinnedConfirmationToolAction {
  readonly label: string;
  readonly toolName: string;
  /** Passed verbatim as the tool's `arguments`. The only safe home for a confirmation token. */
  readonly params: Readonly<Record<string, unknown>>;
}


/** The token names a caller may override. */
export type PinnedSurfaceTokenName = "--jini-mcpui-bg" | "--jini-mcpui-panel" | "--jini-mcpui-border" | "--jini-mcpui-border-strong" | "--jini-mcpui-text" | "--jini-mcpui-text-strong" | "--jini-mcpui-text-muted" | "--jini-mcpui-text-soft" | "--jini-mcpui-text-faint" | "--jini-mcpui-accent" | "--jini-mcpui-accent-strong" | "--jini-mcpui-accent-ink" | "--jini-mcpui-danger" | "--jini-mcpui-radius-xs" | "--jini-mcpui-radius-sm" | "--jini-mcpui-radius-md" | "--jini-mcpui-radius-lg" | "--jini-mcpui-radius-xl" | "--jini-mcpui-radius-pill" | "--jini-mcpui-font" | "--jini-mcpui-font-mono";


/** Secret fields cannot carry a value, even through a previously declared variable.
 * `allowBlank` permits an empty string for stored-value preservation or public-client auth. */
export type PinnedSecretCardField =
  | (PinnedSurfaceField & { readonly secret?: false })
  | (Omit<PinnedStringField, 'value' | 'secret'> & {
      readonly secret: true; readonly value?: never; readonly allowBlank?: boolean;
    });


/** The host controls copy, field construction and display; routing/dismissal belong to the engine. */
export type PinnedSecretCardForm = Omit<PinnedFormSurfaceSpec, 'fields' | 'toolName' | 'baseParams' | 'cancel'> & {
  readonly fields: readonly PinnedSecretCardField[];
  readonly cancelLabel?: string;
};


export type PinnedSecretCardRun<Saved> =
  | { readonly status: 'saved'; readonly saved: Saved }
  | { readonly status: 'cancelled' }
  | { readonly status: 'expired' }
  | { readonly status: 'abandoned' }
  | { readonly status: 'blank' }
  | { readonly status: 'failed'; readonly safeMessage: string };


/** A domain spec, with authorization and target resolution in prepare and persistence in save.
 * Projections must contain safe metadata only. Neither projection receives the submitted values. */
export interface PinnedSecretCardSpec<Prep, Saved, Result> {
  readonly toolId: string;
  /** Validate public model input, authorize and resolve the target before opening a card.
   * Reject secret-bearing input; never read stored plaintext for form construction. */
  prepare(required: { ctx: ToolExecutionContext }): Promise<Prep>;
  form(required: { prep: Prep }): PinnedSecretCardForm;
  /** Only declared field names are forwarded. Domain validation remains authoritative.
   * Values keep their native field types and exact bytes; stored secrets are never needed here. */
  save(required: { values: Readonly<Record<string, unknown>>; prep: Prep; signal: AbortSignal }): Promise<Saved>;
  /** Return undefined for cancellation/expiry when the form already reports that state locally. */
  outcome(required: { prep: Prep; run: PinnedSecretCardRun<Saved> }): PinnedSurfaceOutcomeSpec | undefined;
  result(required: { prep: Prep; run: PinnedSecretCardRun<Saved> }): Result;
}


export interface PinnedSecretCardText {
  readonly noEmitter?: string;
  readonly saveFailure?: string;
  readonly cancelLabel?: string;
}


export interface PinnedSecretCardOptions {
  /** Allowlist known error kinds to fixed text. Never return raw error.message. */
  readonly safeError?: (error: unknown) => string | undefined;
  readonly text?: PinnedSecretCardText;
  readonly frameSize?: readonly [string, string];
  readonly uriHost?: string;
  /** Fixed metadata only: errors and submitted values are deliberately absent. */
  readonly logFailure?: (metadata: { toolId: string; exchangeId: string; saved: false }) => void;
}


export interface PinnedSecretCardDeps {
  readonly surfaceExchanges: Pick<SurfaceExchangeStore, 'open'>;
  readonly askThenReport: SurfaceAskThenReport;
}


export type PinnedSecretCardHandler<Result> = (required: ToolExecutionContext, optional?: ToolExecutionOptions) => Promise<Result>;

export interface PinnedSecretCardTool<Prep, Result> {
  readonly toolId: string;
  secretFieldNames(prep: Prep): string[];
  handler(deps: PinnedSecretCardDeps): PinnedSecretCardHandler<Result>;
}

export type PinnedSurfaceFieldBasePublic = PinnedSurfaceFieldBase;
