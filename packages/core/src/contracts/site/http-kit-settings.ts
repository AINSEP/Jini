/**
 * @file The settings-route error mapping a host hands the settings HTTP adapter.
 *
 * Additive verbatim copy of the declaration in `@jini-ai/http-kit/settings` (`settings/shared.ts`);
 * http-kit keeps its identical declaration and exports until the paired cutover.
 */

export interface SettingsErrorMapping {
  readonly matches: (error: unknown) => boolean; readonly status: number; readonly code: string;
}
