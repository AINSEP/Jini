import type { JsonValue } from './common.js';

/**
 * `RunCreateRequest.contextRef` (see `@jini-ai/http-kit`'s `runs.ts`) is deliberately opaque at
 * the kernel level — a `Run` is generic (an agent editing text, running commands, inspecting a
 * workspace, ...), not necessarily "a chat prompt", so the kernel nouns stay {Run, Agent, Tool}
 * and never learn about prompt/history vocabulary. That neutrality is real (see
 * `foundry/docs/jini-port/extraction-plan.md`'s vocabulary firewall), but it left every host that
 * *is* driving a chat-shaped agent to invent its own `contextRef` encoding from scratch — two
 * independent consumers (this repo's own `examples/reference-web` playground, and an external
 * adopter, Tovu) solved the identical "how do I get a prompt into contextRef" problem two
 * different ways (see `tovu-learnings.md` §4). This module is a shared, optional encoding any
 * host may use instead of reinventing it — using it is never required, `contextRef` remains an
 * opaque string as far as `RunLifecycle`/`RunCreateRequest` themselves are concerned.
 */

const RUN_CONTEXT_PREFIX = 'jini-run-context:v1:';

/** The payload {@link encodeRunContextRef}/{@link decodeRunContextRef} carry. Every field is optional and additive — a host free to add its own out-of-band fields should still prefer its own prefix over extending this shape, so this stays a stable, minimal contract. */
export interface RunContextPayload {
  /** The prompt/instruction text for the agent this run drives. */
  readonly prompt?: string;
  /**
   * Prior turns, in whatever shape the host's own chat surface already uses — deliberately
   * `JsonValue[]`, not a typed message shape, since the kernel does not define one (see this
   * module's own doc comment). {@link decodeRunContextRef} therefore cannot validate inside these
   * entries and passes them through as-is: they are untrusted request data, so a host must not
   * `Object.assign` one onto an existing object (that would honour a `__proto__` key the way a
   * plain spread does not).
   */
  readonly history?: readonly JsonValue[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Encodes `payload` into a `contextRef` string carrying the `jini-run-context:` prefix {@link decodeRunContextRef} checks for. */
export function encodeRunContextRef(payload: RunContextPayload): string {
  return `${RUN_CONTEXT_PREFIX}${JSON.stringify(payload)}`;
}

/**
 * Decodes a `contextRef` produced by {@link encodeRunContextRef}.
 *
 * @returns `undefined` if `contextRef` doesn't carry this module's prefix (i.e. it's a host's own
 * opaque scheme, or a different encoding entirely — never throws on a contextRef this module
 * doesn't own), or if the prefixed payload fails to parse as valid JSON, or doesn't match
 * {@link RunContextPayload}'s shape.
 */
export function decodeRunContextRef(contextRef: string): RunContextPayload | undefined {
  if (!contextRef.startsWith(RUN_CONTEXT_PREFIX)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(contextRef.slice(RUN_CONTEXT_PREFIX.length));
  } catch {
    return undefined;
  }
  if (!isPlainObject(parsed)) return undefined;
  const { prompt, history } = parsed;
  if (prompt !== undefined && typeof prompt !== 'string') return undefined;
  if (history !== undefined && !Array.isArray(history)) return undefined;
  return {
    ...(prompt === undefined ? {} : { prompt: prompt as string }),
    ...(history === undefined ? {} : { history: history as readonly JsonValue[] }),
  };
}
