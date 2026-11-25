import type { AdminWidget, AdminWidgetType } from "../../../screens/widgets/api/widgets-api.types.js";

/**
 * @file What `WidgetPickerDialog.hooks.tsx` needs from the outside world, as an interface rather
 * than a direct `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented in
 * `development/docs/architecture/wired-hooks-convention.md` and `Jini redirects/SOURCE-RATIONALE.md` (the
 * canonical reference). This port is deliberately its own file rather than reusing
 * `@jini-ai/admin/widgets`'s (larger) `AdminWidgetsPort`: `components/` sits below
 * every feature and must not import from one (the same "nothing outside this feature needs it"
 * boundary `media-port.hooks.ts` itself states, just enforced in the other direction here) — a
 * reusable dialog depending on a specific feature's port would be a back-edge into the composition
 * root's dependency graph (see the host's architecture-metrics note). Scoped to the two routes this
 * dialog actually calls — mirrors `media-picker-port.hooks.ts`'s exact reasoning.
 *
 * `describeApiError` stays a direct import in the hook — pure error-classification, no I/O, same
 * reasoning as `Jini redirects/SOURCE-RATIONALE.md`'s own exclusion of it.
 */
export interface WidgetPickerPort {
  listWidgets(options: { widgetType: AdminWidgetType }, optional?: Record<string, never>): Promise<{ widgets: AdminWidget[] }>;
  createWidget(input: { widgetType: AdminWidgetType; title: string; config: Record<string, unknown> }, optional?: Record<string, never>): Promise<{ widget: AdminWidget }>;
}
