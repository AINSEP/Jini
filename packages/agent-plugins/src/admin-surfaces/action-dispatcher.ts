/**
 * @file The server-side mediator between a surface's action requests and the host's handlers.
 *
 * Why it exists: a plugin surface never talks to the server directly; the host page forwards each
 * validated request to a host route, and that route calls this dispatcher. It is the authoritative
 * check (the browser-side gate can be bypassed by calling the route directly): only declared actions
 * run, only with schema-valid input, and a handler's raw error never reaches the surface.
 */
import { validateAdminSurfaceActionValue } from './action-schema.js';
import type { AdminSurfaceDescriptor } from './descriptor.js';
import type { AdminSurfaceActionFailure, AdminSurfaceActionOutcome } from './protocol.js';

/** Thrown by a handler to send a specific, surface-safe failure. Any other throw becomes `action-failed`. */
export class AdminSurfaceActionError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(required: { readonly code: string; readonly message: string }, optional: { readonly retryable?: boolean; readonly cause?: unknown } = {}) {
    super(required.message, optional.cause === undefined ? undefined : { cause: optional.cause });
    this.name = 'AdminSurfaceActionError';
    this.code = required.code;
    this.retryable = optional.retryable ?? false;
  }
}

/** A host-provided implementation of one declared action. `context` is whatever the host route
 * established (workspace, signed-in user); the surface never supplies it. */
export type AdminSurfaceActionHandler<C> = (required: { readonly payload: unknown; readonly context: C }) => Promise<unknown>;

const failure = (code: string, message: string, retryable = false): AdminSurfaceActionOutcome => ({ ok: false, error: { code, message, retryable } });

/** Maps a handler throw to a surface-safe failure. @complexity O(1). */
function handlerFailure(error: unknown): AdminSurfaceActionFailure {
  if (error instanceof AdminSurfaceActionError) return { code: error.code, message: error.message, retryable: error.retryable };
  return { code: 'action-failed', message: 'The action failed. Try again; if it keeps failing, check the server log.', retryable: true };
}

/**
 * Binds one surface's declared actions to host handlers.
 * @param required.handlers - Keyed by action name; a declared action without a handler answers `action-unavailable`.
 * @param optional.onHandlerError - Hears every handler throw (with its cause) for server-side logging.
 * @complexity O(p) per dispatch in the payload and result sizes, plus the handler's own cost.
 */
export function createAdminSurfaceActionDispatcher<C>(
  required: { readonly descriptor: Pick<AdminSurfaceDescriptor, 'id' | 'actions'>; readonly handlers: Readonly<Record<string, AdminSurfaceActionHandler<C>>> },
  optional: { readonly onHandlerError?: (input: { readonly surfaceId: string; readonly action: string; readonly error: unknown }) => void } = {},
) {
  const { descriptor, handlers } = required;
  /** Runs one request. Never throws for a handler fault. */
  async function dispatch(input: { readonly action: string; readonly payload: unknown; readonly context: C }): Promise<AdminSurfaceActionOutcome> {
    const action = descriptor.actions.find((declared) => declared.name === input.action);
    if (action === undefined) return failure('action-undeclared', 'This surface did not declare that action.');
    const handler = Object.hasOwn(handlers, action.name) ? handlers[action.name] : undefined;
    if (handler === undefined) return failure('action-unavailable', 'This action is not available on this host.');
    const violation = validateAdminSurfaceActionValue({ schema: action.input, value: input.payload });
    if (violation !== null) return failure('invalid-payload', `The request does not match the action's input: ${violation}.`);
    let result: unknown;
    try { result = await handler({ payload: input.payload, context: input.context }); }
    catch (error) {
      optional.onHandlerError?.({ surfaceId: descriptor.id, action: action.name, error });
      return { ok: false, error: handlerFailure(error) };
    }
    if (action.result !== undefined && validateAdminSurfaceActionValue({ schema: action.result, value: result }) !== null) {
      return failure('invalid-result', 'The host returned a result this surface did not declare.');
    }
    return { ok: true, result };
  }
  return { dispatch };
}
