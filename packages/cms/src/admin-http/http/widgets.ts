import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import {
  WidgetAreaConflictError,
  WidgetAreaNotFoundError,
  WidgetConfigValidationError,
  WidgetEmbedGuardrailError,
  WidgetEmbedHostNotFoundError,
  WidgetEmbedHostUnsupportedError,
  WidgetEmbedPlacementNotFoundError,
  WidgetEmbedReorderCountMismatchError,
  WidgetForbiddenError,
  WidgetInstanceNotFoundError,
  WidgetReferencedError,
  WidgetTypeUnregisteredError,
  WidgetVersionConflictError,
  type WidgetAreaEntry,
  type WidgetInstanceEntry,
} from "../../widgets/index.js";

/**
 * @file Response DTOs + typed-error -> HTTP mapping for the admin `widgets` HTTP surface
 * (SPEC-043, ADR-047). HTTP-facing serialization + error mapping only — no widgets business logic
 * lives here (that stays in `widgets/*.ts`).
 *
 * Only the widgets domain's own error classes are mapped here. Errors from collaborators the host
 * injects (a plugin hook refusal, an unexpected failure) are the host's to answer: a route spec
 * rethrows them unchanged and the host's error port writes its own envelope.
 */

export function toAdminWidgetResponse(instance: WidgetInstanceEntry): { widget: WidgetInstanceEntry } {
  return { widget: instance };
}

export function toAdminWidgetAreaResponse(area: WidgetAreaEntry): { area: WidgetAreaEntry } {
  return { area };
}

export interface WidgetErrorResponse {
  status: number;
  body: Record<string, unknown>;
}

/**
 * `WidgetForbiddenError` (thrown by `requireWidgetPermission` inside the domain functions
 * themselves — REQ-40's "same gate for human and AI-originated calls") carries only a message, not
 * a structured permission field; extracted here so this 403's body shape matches every other admin
 * route's `{ error, code, details: { permission, reason } }` convention rather than diverging just
 * because the check happened one layer down. Falls back to an empty string if the message shape
 * ever changes upstream — still a valid 403, just without the extracted detail.
 *
 * `code` is `WIDGETS_FORBIDDEN`, matching this class's own documented code in `errors.ts` and every
 * sibling widgets error's HTTP/model-facing parity (`tool-registrations.ts`'s
 * `toModelFacingWidgetsError` prefixes with the same string) — previously this returned the generic
 * `FORBIDDEN` every OTHER admin route's inline 403 uses, which was a drift from every sibling in
 * this table, not a deliberate distinct code.
 */
function widgetForbiddenToResponse(err: WidgetForbiddenError): WidgetErrorResponse {
  const match = /lacks permission '([^']+)' \(([^)]+)\)/.exec(err.message);
  return {
    status: 403,
    body: { error: err.message, code: "WIDGETS_FORBIDDEN", details: { permission: match?.[1] ?? "", reason: match?.[2] ?? "" } },
  };
}

/**
 * Ordered `errorClass -> mapper` table backing `widgetDomainErrorToResponse`. Order matters only in
 * that every listed class must be checked before the caller's own fallback — the classes themselves
 * are disjoint (none is a subclass of another here), so relative order among them is not significant.
 */
const WIDGET_ERROR_MAPPERS: ReadonlyArray<
  readonly [abstract new (...args: never[]) => Error, (err: never) => WidgetErrorResponse]
> = [
  [
    WidgetConfigValidationError,
    (err: WidgetConfigValidationError) => ({ status: 400, body: { error: err.message, code: "WIDGETS_CONFIG_VALIDATION_ERROR", details: { fieldErrors: err.fieldErrors } } }),
  ],
  [
    WidgetTypeUnregisteredError,
    (err: WidgetTypeUnregisteredError) => ({ status: 400, body: { error: err.message, code: "WIDGETS_TYPE_UNREGISTERED", details: { widgetType: err.widgetType } } }),
  ],
  [
    WidgetEmbedReorderCountMismatchError,
    (err: WidgetEmbedReorderCountMismatchError) => ({
      status: 400,
      body: { error: err.message, code: "WIDGETS_EMBED_REORDER_COUNT_MISMATCH", details: { expectedCount: err.expectedCount, actualCount: err.actualCount } },
    }),
  ],
  [
    WidgetEmbedGuardrailError,
    (err: WidgetEmbedGuardrailError) => ({ status: 400, body: { error: err.message, code: "WIDGETS_EMBED_GUARDRAIL_VIOLATION", details: { reason: err.reason } } }),
  ],
  [
    WidgetVersionConflictError,
    (err: WidgetVersionConflictError) => ({ status: 409, body: { error: err.message, code: "WIDGETS_VERSION_CONFLICT", details: { currentVersion: err.currentVersion } } }),
  ],
  [
    WidgetAreaConflictError,
    (err: WidgetAreaConflictError) => ({ status: 409, body: { error: err.message, code: "WIDGETS_AREA_CONFLICT", details: { currentVersion: err.currentVersion } } }),
  ],
  [
    WidgetReferencedError,
    (err: WidgetReferencedError) => ({ status: 409, body: { error: err.message, code: "WIDGETS_REFERENCED", details: { referencingLocations: err.referencingLocations } } }),
  ],
  [WidgetInstanceNotFoundError, (err: WidgetInstanceNotFoundError) => ({ status: 404, body: { error: err.message, code: "WIDGETS_INSTANCE_NOT_FOUND" } })],
  [WidgetAreaNotFoundError, (err: WidgetAreaNotFoundError) => ({ status: 404, body: { error: err.message, code: "WIDGETS_AREA_NOT_FOUND" } })],
  [WidgetEmbedHostNotFoundError, (err: WidgetEmbedHostNotFoundError) => ({ status: 404, body: { error: err.message, code: "WIDGETS_EMBED_HOST_NOT_FOUND" } })],
  [
    WidgetEmbedPlacementNotFoundError,
    (err: WidgetEmbedPlacementNotFoundError) => ({ status: 404, body: { error: err.message, code: "WIDGETS_EMBED_PLACEMENT_NOT_FOUND" } }),
  ],
  [
    WidgetEmbedHostUnsupportedError,
    (err: WidgetEmbedHostUnsupportedError) => ({ status: 400, body: { error: err.message, code: "WIDGETS_EMBED_HOST_UNSUPPORTED", details: { reason: err.reason } } }),
  ],
  [WidgetForbiddenError, widgetForbiddenToResponse],
];

/**
 * Pure typed-error -> `{status, body}` mapping for the widgets domain's own errors, in the
 * `{error, code, ...}` envelope shape every admin route already establishes. Returns `undefined`
 * for anything else, so the caller applies its own fallback (a host maps injected collaborators'
 * errors and answers unexpected failures itself).
 *
 * @complexity O(n) in the fixed mapper table length.
 */
export function widgetDomainErrorToResponse({ err }: { err: unknown }, _optional: Record<string, never> = {}): WidgetErrorResponse | undefined {
  for (const [ErrorClass, mapper] of WIDGET_ERROR_MAPPERS) {
    if (err instanceof ErrorClass) return mapper(err as never);
  }
  return undefined;
}

/**
 * The `catch` of every widgets route spec: a widgets domain error becomes a caller-visible refusal
 * with its mapped status and body; anything else is rethrown unchanged for the host's error port.
 *
 * @complexity O(n) in the fixed mapper table length.
 */
export function rejectWidgetError({ err }: { err: unknown }, _optional: Record<string, never> = {}): never {
  const mapped = widgetDomainErrorToResponse({ err });
  if (mapped) throw new RouteRefusalError(mapped);
  throw err;
}
