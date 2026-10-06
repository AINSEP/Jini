/**
 * @module surface-properties
 *
 * Reading facts about a surface off the raw wire messages, without an interpreter.
 *
 * Why a display-only marker: a host's chat pane treats a surface that arrives while its tool call is
 * still open as a question the person must answer ("Waiting for your answer above"). That is right
 * for a form or a choice, and wrong for a chart a tool draws and then holds its call open only to
 * hear whether the browser refused it (Tovu demo V3, 2026-10-05). The tool that emits the surface is
 * the only party that knows which it is, so it says so on `createSurface.surfaceProperties`, which
 * the v1.0 schema already accepts as an open record; renderers ignore the key.
 */

/** `createSurface.surfaceProperties` key: `true` means the surface shows something and asks nothing. */
export const A2UI_DISPLAY_ONLY_PROPERTY = 'displayOnly';

const SURFACE_SCOPED_KEYS = ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The `surfaceId` a surface-scoped message (create/update components/update data/delete) names, or
 * `undefined` for any other message or a malformed value. Never throws.
 *
 * @complexity O(1).
 */
export function a2uiSurfaceIdOf({ message }: { message: unknown }): string | undefined {
  if (!isRecord(message)) return undefined;
  for (const key of SURFACE_SCOPED_KEYS) {
    const body = message[key];
    if (isRecord(body) && typeof body.surfaceId === 'string') return body.surfaceId;
  }
  return undefined;
}

/**
 * The `surfaceId` of a `createSurface` that declares {@link A2UI_DISPLAY_ONLY_PROPERTY} `true`, else
 * `undefined`. Only `createSurface` carries surface properties, so a caller folding a stream records
 * the id here and matches later messages with {@link a2uiSurfaceIdOf}.
 *
 * @complexity O(1).
 */
export function displayOnlySurfaceIdOf({ message }: { message: unknown }): string | undefined {
  const body = isRecord(message) ? message.createSurface : undefined;
  if (!isRecord(body) || typeof body.surfaceId !== 'string') return undefined;
  const properties = body.surfaceProperties;
  return isRecord(properties) && properties[A2UI_DISPLAY_ONLY_PROPERTY] === true ? body.surfaceId : undefined;
}
