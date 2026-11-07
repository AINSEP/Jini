/**
 * The card builders a tool needs to ask a human for input, described as types only.
 *
 * The builders themselves render HTML and stay in the UI package; a domain package that needs a
 * card cannot import that package, so it declares this port and the host passes the builders in.
 * The resource a builder returns is a type parameter: callers hand it back unread, never inspect it.
 */
import type { SurfaceAskThenReport, SurfaceExchangeStore } from './surface-exchanges.js';
import type { ToolExecutionContext, ToolExecutionOptions } from './tool-registry.js';

export type SurfaceCardUri = `ui://${string}`;
export interface SurfaceCardApp { readonly appName: string; readonly appVersion: string; readonly protocolVersion?: string }
export interface SurfaceCardDetail {
  readonly label: string; readonly value: unknown; readonly description?: string; readonly format?: 'text' | 'code' | 'status';
}
export interface SurfaceCardChoice { readonly value: string; readonly label?: string; readonly disabled?: boolean }

interface SurfaceCardFieldBase {
  readonly name: string; readonly label: string; readonly hint?: string; readonly required?: boolean; readonly disabled?: boolean;
  readonly requiredUnless?: { readonly field: string; readonly equals: string; readonly orPresent?: string; readonly headerNames?: readonly string[] };
  readonly requiredWhen?: { readonly field: string; readonly in: readonly string[] };
}
export interface SurfaceCardStringField extends SurfaceCardFieldBase {
  readonly kind: 'string'; readonly hasSavedValue?: boolean; readonly value?: string; readonly placeholder?: string;
  readonly multiline?: boolean; readonly rows?: number; readonly secret?: boolean;
}
export interface SurfaceCardEnumField extends SurfaceCardFieldBase {
  readonly kind: 'enum'; readonly value?: string; readonly options: readonly SurfaceCardChoice[];
  readonly placeholder?: string; readonly presentation?: 'select' | 'radio';
}
export interface SurfaceCardMultiEnumField extends SurfaceCardFieldBase {
  readonly kind: 'multi-enum'; readonly value?: readonly string[]; readonly options: readonly SurfaceCardChoice[];
}
export type SurfaceCardField = SurfaceCardStringField | SurfaceCardEnumField | SurfaceCardMultiEnumField;
/** A secret field never carries a value. `allowBlank` keeps a stored value or permits a public client. */
export type SurfaceCardSecretField =
  | (SurfaceCardField & { readonly secret?: false })
  | (Omit<SurfaceCardStringField, 'value' | 'secret'> & { readonly secret: true; readonly value?: never; readonly allowBlank?: boolean });

interface SurfaceCardCopy {
  readonly title: string; readonly description?: string; readonly details?: readonly SurfaceCardDetail[];
  readonly app?: SurfaceCardApp; readonly lang?: string; readonly preferredFrameSize?: readonly [string, string];
}
export interface SurfaceCardSecretForm extends SurfaceCardCopy {
  readonly fields: readonly SurfaceCardSecretField[]; readonly warning?: string; readonly danger?: boolean;
  readonly submitLabel: string; readonly cancelLabel?: string;
}
export interface SurfaceCardFormSpec extends Omit<SurfaceCardSecretForm, 'fields' | 'cancelLabel'> {
  readonly uri: SurfaceCardUri; readonly fields: readonly SurfaceCardField[]; readonly toolName: string;
  readonly baseParams?: Readonly<Record<string, unknown>>;
  readonly cancel?: { readonly label: string; readonly toolName?: string; readonly params?: Readonly<Record<string, unknown>> };
}
export interface SurfaceCardOutcome extends SurfaceCardCopy {
  readonly state: 'success' | 'partial' | 'failure'; readonly message: string;
  readonly openLinkUrl?: string; readonly openLinkLabel?: string;
  readonly cancel?: { readonly label: string; readonly toolName: string; readonly params: Readonly<Record<string, unknown>> };
}

export type SurfaceCardSecretRun<Saved> =
  | { readonly status: 'saved'; readonly saved: Saved } | { readonly status: 'cancelled' } | { readonly status: 'expired' }
  | { readonly status: 'abandoned' } | { readonly status: 'blank' } | { readonly status: 'failed'; readonly safeMessage: string };

/** Authorization and target resolution happen in `prepare`, persistence in `save`.
 * @agent-note `save` receives the exact submitted bytes and must keep them in the host's sealed
 * store; it returns only a safe summary. `outcome` and `result` never see submitted values. */
export interface SurfaceCardSecretSpec<Prep, Saved, Result> {
  readonly toolId: string;
  prepare(required: { ctx: ToolExecutionContext }): Promise<Prep>;
  form(required: { prep: Prep }): SurfaceCardSecretForm;
  save(required: { values: Readonly<Record<string, unknown>>; prep: Prep; signal: AbortSignal }): Promise<Saved>;
  outcome(required: { prep: Prep; run: SurfaceCardSecretRun<Saved> }): SurfaceCardOutcome | undefined;
  result(required: { prep: Prep; run: SurfaceCardSecretRun<Saved> }): Result;
}
export interface SurfaceCardSecretOptions {
  readonly safeError?: (error: unknown) => string | undefined;
  readonly text?: { readonly noEmitter?: string; readonly saveFailure?: string; readonly cancelLabel?: string };
  readonly frameSize?: readonly [string, string];
  readonly uriHost?: string;
  readonly logFailure?: (metadata: { toolId: string; exchangeId: string; saved: false }) => void;
}
/** @agent-note Both members come from the daemon the tool runs in: `surfaceExchanges` is the same
 * store instance the host's answer route delivers into (a second store never receives the answer),
 * and `askThenReport` is the daemon's helper from its surface-exchanges entry. */
export interface SurfaceCardSecretDeps {
  readonly surfaceExchanges: Pick<SurfaceExchangeStore, 'open'>;
  readonly askThenReport: SurfaceAskThenReport;
}
export interface SurfaceCardSecretTool<Prep, Result> {
  readonly toolId: string;
  secretFieldNames(prep: Prep): string[];
  handler(deps: SurfaceCardSecretDeps): (required: ToolExecutionContext, optional?: ToolExecutionOptions) => Promise<Result>;
}

export type SurfaceCardSignInState = { state: 'waiting'; signInUrl: string; exchangeId?: string } | { state: 'connected' | 'skipped' };
export interface SurfaceCardSignInSpec {
  uri: SurfaceCardUri; toolId: string; app: SurfaceCardApp;
  waiting: { title: string; description: string; message: string; openLinkLabel: string; cancelLabel: string };
  connected: { title: string; message: string };
  skipped: { title: string; message: string };
}
/** @agent-note `card` must render every state under one URI: the last emission replaces the
 * waiting card. `connect` must honor its `signal`; Skip aborts only this wait, never the run. */
export interface SurfaceCardSignInWait<Resource, Result> {
  surfaceExchanges: Pick<SurfaceExchangeStore, 'open'>; ctx: ToolExecutionContext; toolId: string;
  card: (state: SurfaceCardSignInState) => Resource;
  missingEmitterMessage: string;
  skippedResult: () => Result;
  connect: (input: { signal: AbortSignal; showSignIn: (input: { signInUrl: string }) => Promise<void> }) => Promise<Result>;
}

/**
 * The five card builders, with the signatures the UI package exports.
 * @agent-note Fulfilled by `mcpUiCards` from `@jini-ai/ui/mcp-ui/cards`, which the UI package pins
 * with `satisfies SurfaceCardsPort<UIResource>`; the host passes it in one line. A consumer that
 * calls `waitAtSignInCard` is generic in `Resource` (the type flows back through `card`); one that
 * only builds may take `Omit<SurfaceCardsPort, 'waitAtSignInCard'>`. Never key a form `uri` by a
 * confirmation token.
 */
export interface SurfaceCardsPort<Resource = unknown> {
  readonly defineSecretCardTool: <Prep, Saved, Result>(
    required: SurfaceCardSecretSpec<Prep, Saved, Result>, options?: SurfaceCardSecretOptions,
  ) => SurfaceCardSecretTool<Prep, Result>;
  readonly buildSignInCard: (required: SurfaceCardSignInSpec & SurfaceCardSignInState, optional?: Record<string, never>) => Resource;
  readonly waitAtSignInCard: <Result extends { status: string }>(
    required: SurfaceCardSignInWait<Resource, Result>, optional?: ToolExecutionOptions,
  ) => Promise<Result>;
  readonly buildFormSurface: (spec: SurfaceCardFormSpec) => Resource;
  readonly buildOutcomeSurface: (spec: SurfaceCardOutcome & { readonly uri: SurfaceCardUri }) => Resource;
}
