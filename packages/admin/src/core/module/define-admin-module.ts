import type { AdminModule } from './types.js';
/** Definition is data only; boot validates identities before any factory runs. */
export function defineAdminModule<const M extends AdminModule>(
  required: M,
  _optional: Record<string, never> = {},
): M {
  return Object.freeze(required);
}
