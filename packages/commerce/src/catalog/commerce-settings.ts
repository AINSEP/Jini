/** @file The merchant selection setting (`core.commerce.configuration`), moved from the host composition root. */
import { ensureSettingDefinitions, getEffective, SCOPE_BIT, type EnsureSettingDefinitionsDeps, type SettingsRepoPort } from '@jini-ai/core/settings';
import { commerceCheckoutOrigin } from './checkout-origin.js';

/** Public selection only; provider credentials stay in the existing sealed provider settings. */
import type { CommerceConfiguration } from './merchant-drain.js';

/** Register one optional selection in the existing settings ledger; no commerce tables are created.
 * @complexity One bounded settings-definition operation. */
export async function ensureCommerceSetting({ deps, systemPrincipalId }: {
  deps: EnsureSettingDefinitionsDeps; systemPrincipalId: string;
}, _optional = {}): Promise<void> {
  await ensureSettingDefinitions(deps, { namespace: 'core.commerce', systemPrincipalId,
    definitions: [{ key: 'configuration', schema: { type: 'json' }, defaultValue: {}, scopes: SCOPE_BIT.workspace }] });
}

/** A complete explicit merchant selection; absent/invalid settings keep checkout unavailable.
 * @complexity One settings-ledger read, O(1) application space. */
export async function readCommerceConfiguration({ settingsRepo, workspaceId }: {
  settingsRepo: SettingsRepoPort; workspaceId: string;
}, _optional = {}): Promise<CommerceConfiguration | null> {
  const resolved = await getEffective({ deps: { repo: settingsRepo }, namespace: 'core.commerce', key: 'configuration', scopeContext: { workspaceId } });
  const value = configurationObject({ value: resolved?.value });
  if (!value) return null;
  const { providerId, accountId, mode, publicOrigin } = value;
  if (!validProvider(providerId) || !nonempty(accountId)) return null;
  if (mode !== 'test' && mode !== 'live') return null;
  if (!nonempty(publicOrigin)) return null;
  const origin = commerceCheckoutOrigin({ publicOrigin });
  if (!origin) return null;
  return { providerId, accountId, mode, publicOrigin: origin };
}

function validProvider(value: unknown): value is string { return typeof value === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value); }
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }

function configurationObject({ value }: { value: unknown }, _optional = {}): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
