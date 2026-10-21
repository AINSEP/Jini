/**
 * @file The host page's gate for messages arriving from a mounted admin surface frame.
 *
 * Why every check is needed: all sandboxed frames share the origin "null", so the origin check only
 * proves "some sandboxed frame"; the window identity proves it is THIS mount's
 * frame; the nonce proves the frame still runs the document the host initialized (a navigated frame
 * never received it). Action and schema checks here are an early refusal for the person using the
 * surface; the server-side dispatcher repeats them because a host route can be called directly.
 */
import { exceedsAdminSurfacePayloadLimit, validateAdminSurfaceActionValue } from './action-schema.js';
import type { AdminSurfaceDescriptor } from './descriptor.js';
import {
  ADMIN_SURFACE_PROTOCOL, ADMIN_SURFACE_PROTOCOL_VERSION, SANDBOXED_FRAME_ORIGIN,
  adminSurfaceActionResponse, type AdminSurfaceActionRequest, type AdminSurfaceActionResponse,
} from './protocol.js';

/** The fields of a `MessageEvent` the gate reads; a real event satisfies it structurally. */
export interface AdminSurfaceMessageEvent {
  readonly origin: string;
  readonly source: unknown;
  readonly data: unknown;
}

export interface AdminSurfaceMountRecord {
  readonly mountId: string;
  /** The frame's `contentWindow`; the event's `source` must be this exact object. */
  readonly frame: unknown;
  /** `linkOrigins` matters only to `openAdminSurfaceLink`; a record without it opens no links. */
  readonly descriptor: Pick<AdminSurfaceDescriptor, 'actions' | 'linkOrigins'>;
}

/** `ignored`: not addressed to this mount; drop silently. `refused`: this mount's request was invalid;
 * post `response` back so the surface can show why. */
export type AdminSurfaceMessageVerdict =
  | { readonly ok: true; readonly request: AdminSurfaceActionRequest }
  | { readonly ok: false; readonly ignored: string }
  | { readonly ok: false; readonly refused: string; readonly response: AdminSurfaceActionResponse };

export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function isRequestEnvelope(data: unknown): data is AdminSurfaceActionRequest {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as Readonly<Record<string, unknown>>;
  const isProtocol = message.protocol === ADMIN_SURFACE_PROTOCOL && message.version === ADMIN_SURFACE_PROTOCOL_VERSION && message.kind === 'action-request';
  return isProtocol && hasRequestFields(message);
}

function hasRequestFields(message: Readonly<Record<string, unknown>>): boolean {
  return typeof message.mountId === 'string' && typeof message.requestId === 'string' && REQUEST_ID_PATTERN.test(message.requestId)
    && typeof message.action === 'string' && Object.hasOwn(message, 'payload');
}

/** Character length of the payload as JSON, or Infinity when it is not JSON-serializable. */
/** Whether `event` comes from `mount`'s frame at all (origin and window), for every inbound message kind.
 * @returns The failed check, or `null`. @complexity O(1). */
export function frameTransportRefusal(required: { readonly event: AdminSurfaceMessageEvent; readonly mount: Pick<AdminSurfaceMountRecord, 'frame'> }, _optional: Record<string, never> = {}): string | null {
  const { event, mount } = required;
  // "null" is the origin of every frame sandboxed with `allow-scripts` only; nothing else may speak for a mount.
  if (event.origin !== SANDBOXED_FRAME_ORIGIN) return 'origin-mismatch';
  return event.source === mount.frame ? null : 'source-mismatch';
}

/** Which transport check `event` fails for `mount`, or `null` when it is this mount's well-formed request. */
function transportRefusal(event: AdminSurfaceMessageEvent, mount: AdminSurfaceMountRecord): string | null {
  const frame = frameTransportRefusal({ event, mount });
  if (frame !== null) return frame;
  if (!isRequestEnvelope(event.data)) return 'not-an-action-request';
  return event.data.mountId === mount.mountId ? null : 'mount-mismatch';
}

/**
 * Judges one `message` event against one mount.
 * @complexity O(p) in the payload size (one JSON measure plus one schema walk).
 */
export function validateAdminSurfaceMessage(required: { readonly event: AdminSurfaceMessageEvent; readonly mount: AdminSurfaceMountRecord }, _optional: Record<string, never> = {}): AdminSurfaceMessageVerdict {
  const { event, mount } = required;
  const ignored = transportRefusal(event, mount);
  if (ignored !== null) return { ok: false, ignored };
  const request = event.data as AdminSurfaceActionRequest;
  const refuse = (code: string, message: string) => ({ ok: false as const, refused: code, response: adminSurfaceActionResponse({ request, outcome: { ok: false, error: { code, message, retryable: false } } }) });
  const action = mount.descriptor.actions.find((declared) => declared.name === request.action);
  if (action === undefined) return refuse('action-undeclared', 'This surface did not declare that action.');
  if (exceedsAdminSurfacePayloadLimit({ payload: request.payload })) return refuse('invalid-payload', 'The request is too large.');
  const violation = validateAdminSurfaceActionValue({ schema: action.input, value: request.payload });
  if (violation !== null) return refuse('invalid-payload', `The request does not match the action's input: ${violation}.`);
  return { ok: true, request };
}

/** Frame heights a host accepts by default (CSS px): tall enough for a notice, short enough that a
 *  surface cannot push the admin page out of reach. */
export const ADMIN_SURFACE_MIN_HEIGHT = 96;
export const ADMIN_SURFACE_MAX_HEIGHT = 4000;

function isResizeForMount(
  { message, mountId }: { message: Readonly<Record<string, unknown>>; mountId: string }, _options = {},
): boolean {
  const isResize = message.protocol === ADMIN_SURFACE_PROTOCOL && message.version === ADMIN_SURFACE_PROTOCOL_VERSION && message.kind === 'resize';
  return isResize && message.mountId === mountId;
}

/**
 * The frame height `event` asks for when it is `mount`'s own `resize` message (same origin, window and
 * mount as every other inbound message), clamped to `[min, max]`; null for anything else, which the
 * caller ignores. A size is cosmetic, so a bad one is dropped rather than answered.
 * @complexity O(1).
 */
export function readAdminSurfaceResize(
  required: { readonly event: AdminSurfaceMessageEvent; readonly mount: Pick<AdminSurfaceMountRecord, 'mountId' | 'frame'> },
  optional: { readonly min?: number; readonly max?: number } = {},
): number | null {
  const { event, mount } = required;
  if (frameTransportRefusal({ event, mount }) !== null || typeof event.data !== 'object' || event.data === null) return null;
  const message = event.data as Readonly<Record<string, unknown>>;
  if (!isResizeForMount({ message, mountId: mount.mountId }) || typeof message.height !== 'number' || !Number.isFinite(message.height)) return null;
  return Math.min(optional.max ?? ADMIN_SURFACE_MAX_HEIGHT, Math.max(optional.min ?? ADMIN_SURFACE_MIN_HEIGHT, Math.ceil(message.height)));
}
