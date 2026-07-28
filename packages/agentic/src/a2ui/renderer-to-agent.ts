/**
 * @module renderer-to-agent
 *
 * A2UI v1.0 renderer→agent envelope — mirrors `specification/v1_0/json/renderer_to_agent.json`
 * (fetched from https://github.com/a2ui-project/a2ui, `main` branch, this session). Three message
 * kinds, each envelope carrying `version` plus **exactly one** of `action` | `functionResponse` |
 * `error` (`minProperties: 2, maxProperties: 2` in the real schema — enforced below via `.refine`,
 * since zod's object schema has no direct min/max-properties primitive).
 */
import { z } from 'zod';
import { CallIdSchema } from './common-types.js';

const PROTOCOL_VERSION = 'v1.0' as const;

/** `renderer_to_agent.json#/properties/action` — "Reports a user-initiated action from a component." */
export const ActionMessagePayloadSchema = z.object({
  name: z.string(),
  surfaceId: z.string(),
  sourceComponentId: z.string(),
  /** ISO 8601 timestamp — validated as a non-empty string, not parsed as a `Date`: the real schema only declares `format: "date-time"` (an annotation, not a structural constraint zod enforces by default). */
  timestamp: z.string(),
  context: z.record(z.string(), z.unknown()),
  wantResponse: z.boolean().optional(),
  actionId: z.string().optional(),
});
export type ActionMessagePayload = z.infer<typeof ActionMessagePayloadSchema>;

/** `renderer_to_agent.json#/properties/functionResponse`. */
export const FunctionResponsePayloadSchema = z.object({
  functionCallId: CallIdSchema,
  call: z.string(),
  value: z.unknown(),
});
export type FunctionResponsePayload = z.infer<typeof FunctionResponsePayloadSchema>;

/**
 * `renderer_to_agent.json#/properties/error` — two mutually-exclusive shapes: a `VALIDATION_FAILED`
 * error (always carries `surfaceId` + a JSON-Pointer `path`), or a generic error (any other `code`,
 * carrying exactly one of `surfaceId` XOR `functionCallId`).
 */
export const ValidationFailedErrorSchema = z
  .object({
    code: z.literal('VALIDATION_FAILED'),
    surfaceId: z.string(),
    path: z.string(),
    message: z.string(),
  })
  .strict();
export type ValidationFailedError = z.infer<typeof ValidationFailedErrorSchema>;

export const GenericErrorSchema = z
  .object({
    code: z.string().refine((c) => c !== 'VALIDATION_FAILED', 'code must not be VALIDATION_FAILED here'),
    message: z.string(),
    surfaceId: z.string().optional(),
    functionCallId: CallIdSchema.optional(),
  })
  .passthrough()
  .refine((v) => ('surfaceId' in v) !== ('functionCallId' in v), 'exactly one of surfaceId/functionCallId is required');
export type GenericError = z.infer<typeof GenericErrorSchema>;

export const ErrorPayloadSchema = z.union([ValidationFailedErrorSchema, GenericErrorSchema]);
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

export const ActionMessageSchema = z
  .object({ version: z.literal(PROTOCOL_VERSION), action: ActionMessagePayloadSchema })
  .strict();
export type ActionMessage = z.infer<typeof ActionMessageSchema>;

export const FunctionResponseMessageSchema = z
  .object({ version: z.literal(PROTOCOL_VERSION), functionResponse: FunctionResponsePayloadSchema })
  .strict();
export type FunctionResponseMessage = z.infer<typeof FunctionResponseMessageSchema>;

export const ErrorMessageSchema = z
  .object({ version: z.literal(PROTOCOL_VERSION), error: ErrorPayloadSchema })
  .strict();
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;

export type RendererToAgentMessage = ActionMessage | FunctionResponseMessage | ErrorMessage;

export function buildActionMessage(payload: ActionMessagePayload): ActionMessage {
  return { version: PROTOCOL_VERSION, action: payload };
}
export function buildFunctionResponseMessage(payload: FunctionResponsePayload): FunctionResponseMessage {
  return { version: PROTOCOL_VERSION, functionResponse: payload };
}
export function buildValidationFailedMessage(surfaceId: string, path: string, message: string): ErrorMessage {
  return { version: PROTOCOL_VERSION, error: { code: 'VALIDATION_FAILED', surfaceId, path, message } };
}
export function buildGenericErrorMessage(
  code: string,
  message: string,
  target: { surfaceId: string } | { functionCallId: string },
): ErrorMessage {
  return { version: PROTOCOL_VERSION, error: { code, message, ...target } };
}

const MESSAGE_KEYS = ['action', 'functionResponse', 'error'] as const;

export interface RendererParseFailure {
  readonly ok: false;
  readonly reason: string;
}
export interface RendererParseSuccess {
  readonly ok: true;
  readonly message: RendererToAgentMessage;
}

/** Same "inspect the shape, validate the one matching branch" dispatcher as `parseAgentToRendererMessage` — see that function's doc for why this beats a plain `z.union`. Used by tests and by anything on the agent side of this fixture that needs to validate what the browser sent. */
export function parseRendererToAgentMessage(raw: unknown): RendererParseSuccess | RendererParseFailure {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'envelope must be a JSON object' };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== PROTOCOL_VERSION) {
    return { ok: false, reason: `envelope declares version ${JSON.stringify(obj.version)}, expected "${PROTOCOL_VERSION}"` };
  }
  const presentKeys = MESSAGE_KEYS.filter((key) => key in obj);
  if (presentKeys.length !== 1) {
    return { ok: false, reason: `expected exactly one of ${MESSAGE_KEYS.join(', ')}, found ${presentKeys.length}` };
  }
  const key = presentKeys[0]!;
  const schema = key === 'action' ? ActionMessageSchema : key === 'functionResponse' ? FunctionResponseMessageSchema : ErrorMessageSchema;
  const result = schema.safeParse(obj);
  if (!result.success) {
    // Same zod guarantee as `parseAgentToRendererMessage` relies on: `success: false` implies a
    // non-empty `issues` array — see that function's comment for why this is asserted, not branched.
    return { ok: false, reason: result.error.issues[0]!.message };
  }
  return { ok: true, message: result.data };
}
