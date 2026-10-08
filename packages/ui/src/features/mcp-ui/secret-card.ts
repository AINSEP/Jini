/**
 * One human-only secret-card lifecycle. Keystrokes go directly to the held exchange and save
 * port, never through model input, chat text, or logs. Saved values must stay in the host's
 * sealed store; save returns only a safe summary for result/outcome projections.
 *
 * Fail closed without an emitter: returning a form or accepting a second model call would
 * strand the held call or route a secret through model context. Cancel posts a dismissal so
 * the call wakes immediately instead of waiting for its TTL. askThenReport keeps the exchange
 * open until the real save finishes; reusing the form URI replaces premature "Done." with its
 * actual outcome. The host supplies the daemon's existing helper, never a second store.
 */
import {
  ToolInputError, redactSecrets, SURFACE_DISMISSED_PARAM, SURFACE_EXCHANGE_ID_PARAM,
  SURFACE_TYPED_ANSWER_PARAM,
  type SurfaceAskThenReport, type SurfaceExchangeStore, type SurfaceMessage,
  type ToolExecutionContext, type ToolExecutionOptions,
} from '@jini-ai/core';
import type { UIResourceUri } from './resource.js';
import { buildFormSurface, type FormSurfaceSpec } from './surfaces/form.js';
import { buildOutcomeSurface, type SurfaceOutcomeSpec } from './surfaces/outcome.js';
import type { StringField, SurfaceField } from './surfaces/fields.js';

/** Secret fields cannot carry a value, even through a previously declared variable.
 * `allowBlank` permits an empty string for stored-value preservation or public-client auth. */
export type SecretCardField =
  | (SurfaceField & { readonly secret?: false })
  | (Omit<StringField, 'value' | 'secret'> & {
      readonly secret: true; readonly value?: never; readonly allowBlank?: boolean;
    });

/** The host controls copy, field construction and display; routing/dismissal belong to the engine. */
export type SecretCardForm = Omit<FormSurfaceSpec, 'fields' | 'toolName' | 'baseParams' | 'cancel'> & {
  readonly fields: readonly SecretCardField[];
  readonly cancelLabel?: string;
};

export type SecretCardRun<Saved> =
  | { readonly status: 'saved'; readonly saved: Saved }
  | { readonly status: 'cancelled' }
  | { readonly status: 'expired' }
  | { readonly status: 'abandoned' }
  | { readonly status: 'blank' }
  | { readonly status: 'failed'; readonly safeMessage: string };

/** A domain spec, with authorization and target resolution in prepare and persistence in save.
 * Projections must contain safe metadata only. Neither projection receives the submitted values. */
export interface SecretCardSpec<Prep, Saved, Result> {
  readonly toolId: string;
  /** Validate public model input, authorize and resolve the target before opening a card.
   * Reject secret-bearing input; never read stored plaintext for form construction. */
  prepare(required: { ctx: ToolExecutionContext }): Promise<Prep>;
  form(required: { prep: Prep }): SecretCardForm;
  /** Only declared field names are forwarded. Domain validation remains authoritative.
   * Values keep their native field types and exact bytes; stored secrets are never needed here. */
  save(required: { values: Readonly<Record<string, unknown>>; prep: Prep; signal: AbortSignal }): Promise<Saved>;
  /** Return undefined for cancellation/expiry when the form already reports that state locally. */
  outcome(required: { prep: Prep; run: SecretCardRun<Saved> }): SurfaceOutcomeSpec | undefined;
  result(required: { prep: Prep; run: SecretCardRun<Saved> }): Result;
}

export interface SecretCardText {
  readonly noEmitter?: string;
  readonly saveFailure?: string;
  readonly cancelLabel?: string;
}

export interface SecretCardOptions {
  /** Allowlist known error kinds to fixed text. Never return raw error.message. */
  readonly safeError?: (error: unknown) => string | undefined;
  readonly text?: SecretCardText;
  readonly frameSize?: readonly [string, string];
  readonly uriHost?: string;
  /** Fixed metadata only: errors and submitted values are deliberately absent. */
  readonly logFailure?: (metadata: { toolId: string; exchangeId: string; saved: false }) => void;
}

export interface SecretCardDeps {
  readonly surfaceExchanges: Pick<SurfaceExchangeStore, 'open'>;
  readonly askThenReport: SurfaceAskThenReport;
}

export type SecretCardHandler<Result> = (required: ToolExecutionContext, optional?: ToolExecutionOptions) => Promise<Result>;
export interface SecretCardTool<Prep, Result> {
  readonly toolId: string;
  secretFieldNames(prep: Prep): string[];
  handler(deps: SecretCardDeps): SecretCardHandler<Result>;
}

/** Reject ambiguous or protocol-reserved names and runtime attempts to prefill secrets.
 * @complexity O(n) time/space in the field count. Throws fixed ToolInputError text only. */
function checkedFields(form: SecretCardForm): readonly SecretCardField[] {
  const names = new Set<string>([SURFACE_EXCHANGE_ID_PARAM, SURFACE_DISMISSED_PARAM, SURFACE_TYPED_ANSWER_PARAM]);
  for (const field of form.fields) {
    if (!field.name || names.has(field.name)) throw new ToolInputError({ message: 'Secret card field names must be unique and cannot use exchange parameters.' });
    names.add(field.name);
    if (field.secret === true && field.value !== undefined) throw new ToolInputError({ message: 'Secret fields cannot have a pre-filled value. Omit value.' });
  }
  // Snapshot policies before waiting: host mutation must not change which submitted fields are secret.
  return form.fields.map(field => ({ ...field }));
}

/** Classify before persistence; an abort wins over an already-buffered answer.
 * Trimming tests blankness only: rewriting a provider secret can corrupt intentional newlines.
 * @complexity O(n + b) before save in fields and submitted secret bytes; failure text delegates
 * to core's exact-secret redaction scan. Host persistence cost is external. */
async function saveAnswer<Prep, Saved>(required: {
  answer: SurfaceMessage; fields: readonly SecretCardField[]; prep: Prep; ctx: ToolExecutionContext;
  spec: SecretCardSpec<Prep, Saved, unknown>; options: SecretCardOptions; exchangeId: string;
}): Promise<SecretCardRun<Saved>> {
  const { answer, fields, prep, ctx, spec, options, exchangeId } = required;
  if (ctx.signal.aborted) return { status: 'abandoned' };
  if (answer.status !== 'received') return { status: answer.status };
  if (answer.params[SURFACE_DISMISSED_PARAM] === true) return { status: 'cancelled' };
  const values = Object.fromEntries(fields.map(field => [field.name, answer.params[field.name]]));
  const secrets: string[] = [];
  for (const field of fields) {
    if (field.secret !== true) continue;
    const value = values[field.name];
    if (value !== undefined && typeof value !== 'string') return { status: 'blank' };
    const secret = typeof value === 'string' ? value : '';
    if (secret.trim() === '' && (secret !== '' || field.allowBlank !== true)) return { status: 'blank' };
    values[field.name] = secret;
    secrets.push(secret);
  }
  if (ctx.signal.aborted) return { status: 'abandoned' };
  try {
    return { status: 'saved', saved: await spec.save({ values, prep, signal: ctx.signal }) };
  } catch (error) {
    if (ctx.signal.aborted) return { status: 'abandoned' };
    let safeMessage = options.text?.saveFailure ?? 'Saving failed. Nothing was saved.';
    try { safeMessage = options.safeError?.(error) ?? safeMessage; }
    catch { /* An error mapper must not disclose a second exception containing the submitted value. */ }
    // Even an accidentally permissive allowlist must not echo the submitted secret.
    safeMessage = redactSecrets({ input: safeMessage }, { exactSecrets: secrets });
    try { options.logFailure?.({ toolId: spec.toolId, exchangeId, saved: false }); }
    catch { /* Logging must not replace the safe model result with an opaque logger exception. */ }
    return { status: 'failed', safeMessage };
  }
}

/**
 * Define a secret card once; inject the exchange store and daemon askThenReport at composition.
 * @param required - Domain fields, permission/target checks, save port and safe projections.
 * @param options - Optional copy, error allowlist, fixed-metadata logger and resource framing.
 * @returns Tool identity, dynamic secret-field metadata and a typed registry-compatible handler.
 * @throws ToolInputError if the emitter is missing or fields violate the secret/routing contract.
 * Prepare/transport failures propagate; save failures become a fixed safe outcome.
 * @complexity O(n + h + b) locally in fields, rendered HTML and submitted secret bytes, plus host I/O.
 * @example
 * const tool = defineSecretCardTool(spec);
 * registry.register({ descriptor, policy, handler: tool.handler({ surfaceExchanges, askThenReport }) });
 */
export function defineSecretCardTool<Prep, Saved, Result>(
  required: SecretCardSpec<Prep, Saved, Result>, options: SecretCardOptions = {},
): SecretCardTool<Prep, Result> {
  const spec = required;
  return {
    toolId: spec.toolId,
    secretFieldNames: prep => checkedFields(spec.form({ prep })).filter(field => field.secret === true).map(field => field.name),
    handler: deps => async (ctx, optional = {}) => {
      if (!optional.emitSurface) throw new ToolInputError({ message: options.text?.noEmitter ?? `${spec.toolId}: this execution context has no interactive form channel (no emitSurface), so this form cannot be shown here. Nothing was changed.` });
      const prep = await spec.prepare({ ctx });
      if (ctx.signal.aborted) return spec.result({ prep, run: { status: 'abandoned' } });
      const form = spec.form({ prep });
      const fields = checkedFields(form);
      if (ctx.signal.aborted) return spec.result({ prep, run: { status: 'abandoned' } });
      const exchange = deps.surfaceExchanges.open({ binding: { toolId: spec.toolId, principalId: ctx.principal.id, channel: 'mcp-ui' }, emit: optional.emitSurface });
      const closeOnAbort = (): void => exchange.close({});
      ctx.signal.addEventListener('abort', closeOnAbort, { once: true });
      try {
        // Close the open/register race as well as the prepare/abort race.
        if (ctx.signal.aborted) return spec.result({ prep, run: { status: 'abandoned' } });
        const uri: UIResourceUri = `ui://${options.uriHost ?? 'jini'}/secret-card/${encodeURIComponent(spec.toolId)}/${encodeURIComponent(exchange.id)}`;
        const framing = options.frameSize === undefined ? {} : { preferredFrameSize: options.frameSize };
        const resource = buildFormSurface({ ...form, fields, uri, ...framing, toolName: spec.toolId,
          baseParams: { [SURFACE_EXCHANGE_ID_PARAM]: exchange.id },
          cancel: { label: form.cancelLabel ?? options.text?.cancelLabel ?? 'Cancel', toolName: spec.toolId,
            params: { [SURFACE_EXCHANGE_ID_PARAM]: exchange.id, [SURFACE_DISMISSED_PARAM]: true } },
        });
        return await deps.askThenReport({ exchange, confirmationEmission: { channel: 'mcp-ui', payload: { resource } },
          handle: async answer => {
            const run = await saveAnswer({ answer, fields, prep, ctx, spec, options, exchangeId: exchange.id });
            const result = spec.result({ prep, run });
            const outcome = spec.outcome({ prep, run });
            if (outcome === undefined) return { result };
            return { result, outcome: { channel: 'mcp-ui', payload: { resource: buildOutcomeSurface({ ...outcome, uri, ...framing }) } } };
          },
        });
      } finally {
        ctx.signal.removeEventListener('abort', closeOnAbort);
        // Also covers rendering/projection failures before or inside askThenReport; close is idempotent.
        exchange.close({});
      }
    },
  };
}
