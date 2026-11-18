/**
 * @module @jini-ai/mcp/server/tools/family-retry
 * A gateway call that names a group of tools (the daemon answers `404 UNKNOWN_TOOL` with `details.family`) is sent
 * once more as the one member the caller's own input selects. The daemon never reroutes: the second request is an
 * ordinary request for a concrete tool id, so every host gate keyed on that id sees it from the first byte.
 */
/** The member a family answer and the call's input agree on, and the input the member is called with. */
export interface FamilyMemberChoice {
  readonly familyId: string;
  readonly memberId: string;
  /** The caller's input without the selector key. */
  readonly input: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

/** The family an `UNKNOWN_TOOL` answer describes, only when every field has the shape the daemon sends. */
function readFamily({ error }: { error: unknown }): { id: string; members: string[]; keys: string[]; byValue: Record<string, unknown> } | undefined {
  // Duck-typed on the two documented fields of `DaemonHttpError`, so this reads any error that carries them.
  if (!isRecord(error) || error.code !== 'UNKNOWN_TOOL' || !isRecord(error.details)) return undefined;
  const family = error.details.family;
  if (!isRecord(family) || typeof family.id !== 'string' || !isStringList(family.members)) return undefined;
  const selector = family.selector;
  if (!isRecord(selector) || !isStringList(selector.keys) || !isRecord(selector.byValue)) return undefined;
  return { id: family.id, members: family.members, keys: selector.keys, byValue: selector.byValue };
}

/**
 * Chooses the one member a group answer and the call's input agree on.
 *
 * Reads only the error's `code` and `details.family`, never its message text. Returns `undefined` (keep the original
 * error) unless: the input is an object with exactly one of the selector's keys, its value is a string that is an own
 * key of the selector's table, and the table maps it to a member the family lists.
 *
 * @param required.error - What the first request threw.
 * @param required.input - The input the first request carried.
 * @returns The member and the input to send it, or `undefined`.
 * @complexity O(k) for k selector keys.
 */
export function selectFamilyMember(
  { error, input }: { readonly error: unknown; readonly input: unknown },
  _optional: Record<string, never> = {},
): FamilyMemberChoice | undefined {
  const family = readFamily({ error });
  if (family === undefined || !isRecord(input)) return undefined;
  const present = family.keys.filter(key => Object.hasOwn(input, key));
  const key = present[0];
  if (present.length !== 1 || key === undefined) return undefined;
  const value = input[key];
  const memberId = typeof value === 'string' && Object.hasOwn(family.byValue, value) ? family.byValue[value] : undefined;
  if (typeof memberId !== 'string' || !family.members.includes(memberId)) return undefined;
  const { [key]: _selector, ...rest } = input;
  return { familyId: family.id, memberId, input: rest };
}

/** One delegated-call request body. */
export interface DelegatedCallBody {
  readonly toolUseId: string;
  readonly toolId: string;
  readonly input?: unknown;
  readonly [field: string]: unknown;
}

/**
 * Sends `body`; when the daemon answers that `body.toolId` is a group and the input selects one member, sends one
 * more ordinary request for that member (a new `toolUseId`, the same run and `requireReadOnly`). At most one retry;
 * the second request's failure propagates as its own.
 *
 * @param required.post - Sends one request body to the daemon.
 * @param required.body - The first request.
 * @param required.newToolUseId - Mints the second request's correlation id.
 * @param optional.signal - The call's cancellation signal; a cancelled call is never retried.
 * @returns The answer, the `toolUseId` of the request that produced it and, after a retry, the note to show the model.
 * @complexity One or two round trips.
 */
export async function postWithFamilyRetry<T>(
  { post, body, newToolUseId }: { readonly post: (body: DelegatedCallBody) => Promise<T>; readonly body: DelegatedCallBody; readonly newToolUseId: (required: Record<string, never>) => string },
  { signal }: { readonly signal?: AbortSignal } = {},
): Promise<{ readonly data: T; readonly toolUseId: string; readonly note?: string }> {
  try {
    return { data: await post(body), toolUseId: body.toolUseId };
  } catch (error) {
    const choice = signal?.aborted === true ? undefined : selectFamilyMember({ error, input: body.input });
    if (choice === undefined) throw error;
    const toolUseId = newToolUseId({});
    const data = await post({ ...body, toolUseId, toolId: choice.memberId, input: choice.input });
    return { data, toolUseId, note: `"${choice.familyId}" is a group; ran ${choice.memberId}` };
  }
}
