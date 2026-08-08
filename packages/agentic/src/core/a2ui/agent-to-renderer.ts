/**
 * @module agent-to-renderer
 *
 * A2UI v1.0 agent→renderer envelope — mirrors `specification/v1_0/json/agent_to_renderer.json`
 * (fetched from https://github.com/a2ui-project/a2ui, `main` branch, this session). Every
 * required/optional field and every `additionalProperties: false` closure below was copied
 * directly from that JSON Schema, not guessed. See `common-types.ts`'s module doc for the overall
 * scope note (wire shape only; catalog membership is a separate runtime concern).
 *
 * The six message kinds, each keyed by version + exactly one message-type key
 * (`createSurface` | `updateComponents` | `updateDataModel` | `deleteSurface` | `callFunction` +
 * `functionCallId` | `actionResponse` + `actionId`):
 * `CreateSurfaceMessage`, `UpdateComponentsMessage`, `UpdateDataModelMessage`,
 * `DeleteSurfaceMessage`, `CallFunctionMessage`, `ActionResponseMessage`.
 *
 * `parseAgentToRendererMessage` is a hand-written dispatcher, not a plain `z.union(...)`: zod's
 * union error for a 6-branch, all-`.strict()` union is an unreadable dump of all 6 branches'
 * failures at once. Real renderers need to tell an agent *specifically* "you sent no version",
 * "you sent two message-type keys", or "`updateComponents` is missing `surfaceId`" — so this
 * dispatcher inspects the envelope's own shape first (which key is present) and only then
 * validates against the one matching schema, matching what `renderer_to_agent.json`'s own error
 * schema anticipates (`VALIDATION_FAILED` with a JSON-Pointer `path` into the offending field).
 */
import { z } from 'zod';
import { ComponentIdSchema, FunctionCallSchema, CallIdSchema } from './common-types.js';

const PROTOCOL_VERSION = 'v1.0' as const;

/**
 * A component's wire shape is only closed by its *catalog's* own per-type schema (e.g. `Text`
 * requires `text`, forbids unknown extra keys via that type's own `unevaluatedProperties: false`)
 * — a shape this module cannot know statically, since a renderer may be configured with any
 * catalog. This schema validates only what every component, in every catalog, always carries:
 * an `id` and a `component` type-name string. `catalog.ts`/`interpreter.ts` layer the closed,
 * per-type check on top at runtime (component-type whitelisting against the active catalog).
 */
export const WireComponentSchema = z
  .object({
    id: ComponentIdSchema,
    component: z.string().min(1),
  })
  .passthrough();
export type WireComponent = z.infer<typeof WireComponentSchema> & Record<string, unknown>;

/** `agent_to_renderer.json#/$defs/ComponentsList` — "A list containing UI components for the surface." `minItems: 1`. */
export const ComponentsListSchema = z.array(WireComponentSchema).min(1);
export type ComponentsList = z.infer<typeof ComponentsListSchema>;

export const CreateSurfaceMessageSchema = z
  .object({
    version: z.literal(PROTOCOL_VERSION),
    createSurface: z
      .object({
        surfaceId: z.string(),
        catalogId: z.string(),
        surfaceProperties: z.record(z.string(), z.unknown()).optional(),
        sendDataModel: z.boolean().optional(),
        components: ComponentsListSchema.optional(),
        dataModel: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();
export type CreateSurfaceMessage = z.infer<typeof CreateSurfaceMessageSchema>;

export const UpdateComponentsMessageSchema = z
  .object({
    version: z.literal(PROTOCOL_VERSION),
    updateComponents: z
      .object({
        surfaceId: z.string(),
        components: ComponentsListSchema,
      })
      .strict(),
  })
  .strict();
export type UpdateComponentsMessage = z.infer<typeof UpdateComponentsMessageSchema>;

/**
 * `value` is required by the real schema (`"required": ["surfaceId", "value"]`, re-fetched and
 * checked 2026-07-29) — but declaring it `z.unknown()` did not make it so. In Zod 3 a key whose
 * schema accepts `undefined` is satisfied by the key being absent entirely, and `undefined`
 * inhabits `unknown`; `z.unknown().isOptional()` is literally `true`. So `{updateDataModel:
 * {surfaceId: "s1"}}` parsed clean, and `interpreter.ts` then wrote that missing value at the
 * default `'/'` pointer — replacing the surface's whole data model with `undefined`, silently,
 * with no error message and no way for the agent to learn it had happened.
 *
 * Presence is therefore asserted on the object rather than on the field: there is no Zod 3 schema
 * for "any value, but it has to be there," because optionality is decided by the field's *type*.
 * `'value' in body` rather than a `!== undefined` check, so every legal JSON value — `null`
 * (the spec's own delete verb), `false`, `0`, `""` — is still accepted as content.
 *
 * The same limitation leaves `value` typed `value?: unknown` on the inferred type. That is
 * unavoidable in Zod 3 for an `unknown`-typed key (`undefined extends unknown`), and is why this
 * is enforced at runtime rather than trusted to the type.
 */
export const UpdateDataModelMessageSchema = z
  .object({
    version: z.literal(PROTOCOL_VERSION),
    updateDataModel: z
      .object({
        surfaceId: z.string(),
        path: z.string().optional(),
        value: z.unknown(),
      })
      .strict()
      .refine((body) => 'value' in body, {
        message: 'updateDataModel requires an explicit "value" (use null to delete the key at "path")',
        path: ['value'],
      }),
  })
  .strict();
export type UpdateDataModelMessage = z.infer<typeof UpdateDataModelMessageSchema>;

export const DeleteSurfaceMessageSchema = z
  .object({
    version: z.literal(PROTOCOL_VERSION),
    deleteSurface: z.object({ surfaceId: z.string() }).strict(),
  })
  .strict();
export type DeleteSurfaceMessage = z.infer<typeof DeleteSurfaceMessageSchema>;

export const CallFunctionMessageSchema = z
  .object({
    version: z.literal(PROTOCOL_VERSION),
    functionCallId: CallIdSchema,
    wantResponse: z.boolean().optional(),
    callFunction: FunctionCallSchema,
  })
  .strict();
export type CallFunctionMessage = z.infer<typeof CallFunctionMessageSchema>;

export const ActionResponseMessageSchema = z
  .object({
    version: z.literal(PROTOCOL_VERSION),
    actionId: z.string(),
    actionResponse: z
      .union([
        z.object({ value: z.unknown() }).strict(),
        z.object({ error: z.object({ code: z.string(), message: z.string() }).strict() }).strict(),
      ])
      .refine((v) => ('value' in v) !== ('error' in v), 'exactly one of value/error is required'),
  })
  .strict();
export type ActionResponseMessage = z.infer<typeof ActionResponseMessageSchema>;

export type AgentToRendererMessage =
  | CreateSurfaceMessage
  | UpdateComponentsMessage
  | UpdateDataModelMessage
  | DeleteSurfaceMessage
  | CallFunctionMessage
  | ActionResponseMessage;

const MESSAGE_KEY_SCHEMAS = {
  createSurface: CreateSurfaceMessageSchema,
  updateComponents: UpdateComponentsMessageSchema,
  updateDataModel: UpdateDataModelMessageSchema,
  deleteSurface: DeleteSurfaceMessageSchema,
  callFunction: CallFunctionMessageSchema,
  actionResponse: ActionResponseMessageSchema,
} as const;
type MessageKey = keyof typeof MESSAGE_KEY_SCHEMAS;
/** Exported so `interpreter.ts` can look up "which of the *known* message-type keys is present" the same way this module's own dispatcher does, instead of guessing from raw object-key order (which could pick up an unrelated extra top-level key first). */
export const AGENT_TO_RENDERER_MESSAGE_KEYS = Object.keys(MESSAGE_KEY_SCHEMAS) as MessageKey[];
const MESSAGE_KEYS = AGENT_TO_RENDERER_MESSAGE_KEYS;

export interface ParseFailure {
  readonly ok: false;
  readonly code: 'MISSING_VERSION' | 'UNSUPPORTED_VERSION' | 'NO_MESSAGE_KEY' | 'AMBIGUOUS_MESSAGE' | 'VALIDATION_FAILED';
  readonly message: string;
  readonly path?: string;
}
export interface ParseSuccess {
  readonly ok: true;
  readonly message: AgentToRendererMessage;
}

/**
 * Validates a raw (untrusted, possibly-malformed) value as one A2UI agent→renderer envelope.
 * Never throws — every failure mode (missing `version`, an unrecognized/absent message-type key,
 * two message-type keys at once, or a structurally invalid message body) returns a tagged
 * `ParseFailure` instead, mirroring how a real renderer must degrade on the wire: reject the one
 * bad message with a specific reason, not crash the whole connection.
 */
export function parseAgentToRendererMessage(raw: unknown): ParseSuccess | ParseFailure {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, code: 'VALIDATION_FAILED', message: 'envelope must be a JSON object' };
  }
  const obj = raw as Record<string, unknown>;

  if (!('version' in obj)) {
    return { ok: false, code: 'MISSING_VERSION', message: 'envelope is missing the required "version" field' };
  }
  if (obj.version !== PROTOCOL_VERSION) {
    return {
      ok: false,
      code: 'UNSUPPORTED_VERSION',
      message: `envelope declares version ${JSON.stringify(obj.version)}, this renderer only supports "${PROTOCOL_VERSION}"`,
    };
  }

  const presentKeys = MESSAGE_KEYS.filter((key) => key in obj);
  if (presentKeys.length === 0) {
    return {
      ok: false,
      code: 'NO_MESSAGE_KEY',
      message: `envelope has "version" but none of the known message-type keys (${MESSAGE_KEYS.join(', ')})`,
    };
  }
  if (presentKeys.length > 1) {
    return {
      ok: false,
      code: 'AMBIGUOUS_MESSAGE',
      message: `envelope has more than one message-type key at once: ${presentKeys.join(', ')}`,
    };
  }

  const key = presentKeys[0]!;
  const schema = MESSAGE_KEY_SCHEMAS[key];
  const result = schema.safeParse(obj);
  if (!result.success) {
    // zod only ever returns `success: false` with a non-empty `error.issues` — there is no zod
    // code path that produces a failed `SafeParseReturnType` with zero issues. Asserted directly
    // (not defensively branched-and-left-untested) per this package's own testing discipline: a
    // branch that cannot occur given an upstream guarantee gets removed, not fake-covered.
    const firstIssue = result.error.issues[0]!;
    const path = `/${firstIssue.path.join('/')}`;
    return { ok: false, code: 'VALIDATION_FAILED', message: `${key}: ${firstIssue.message} at ${path}`, path };
  }
  return { ok: true, message: result.data };
}
