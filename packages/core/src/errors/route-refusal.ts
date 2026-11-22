/**
 * @file A route's deliberate, caller-visible refusal: thrown by a host guard or handler and turned
 * into the host's own wire envelope by its `onError` port.
 */

/** Only deliberate HTTP rejections carry caller-visible text; other errors use the host's error mappings. */
export class RouteRefusalError extends Error {
  constructor(readonly response: { status: number; body: unknown }) {
    super("settings request rejected");
  }
}

/** Reject with the host's flat JSON envelope, preserving absent code/details fields.
 * @returns Never; the injected adapter error port writes the response.
 * @complexity O(1) time/space.
 */
export function rejectRoute(required: {
  status: number; error: string; code?: string; details?: { permission: string; reason: string };
}, _optional: Record<string, never> = {}): never {
  const body: { error: string; code?: string; details?: { permission: string; reason: string } } = { error: required.error };
  if (required.code !== undefined) body.code = required.code;
  if (required.details !== undefined) body.details = required.details;
  throw new RouteRefusalError({ status: required.status, body });
}
