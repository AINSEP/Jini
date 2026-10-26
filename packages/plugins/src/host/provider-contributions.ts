/** Server factories are inert registrations. Clients and timers belong to initialized resources. */
import { PROVIDER_ID_PATTERN } from '@jini-ai/core/provider-registry';
import type { PluginProviderDeclaration, PluginValidationError } from './manifest-types.js';

export const PLUGIN_PROVIDER_CAPABILITY = 'providers.register' as const;
export interface PluginProviderResource<T = unknown> {
  readonly port: T;
  /** Release owned resources only; borrowed effect ports remain host-owned. */
  readonly dispose: (required: Record<string, never>, optional?: Record<string, never>) => void | Promise<void>;
}
export type PluginProviderFactory = (
  required: Readonly<Record<string, unknown>>,
  optional?: Readonly<Record<string, unknown>>,
) => PluginProviderResource | Promise<PluginProviderResource>;
export interface PluginProviderContribution extends PluginProviderDeclaration {
  readonly factory: PluginProviderFactory;
}
export interface PluginProvidersSdk {
  register(required: PluginProviderContribution, optional?: Record<string, never>): void;
}

/** Shared grammar for manifest validation and runtime capture, using core's frozen id contract. */
export function isPluginProviderDeclaration(
  required: { value: unknown }, _optional: Record<string, never> = {},
): required is { value: PluginProviderDeclaration } {
  const value = required.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const declaration = value as Partial<PluginProviderDeclaration>;
  return typeof declaration.contract === 'string' && PROVIDER_ID_PATTERN.test(declaration.contract)
    && typeof declaration.id === 'string' && PROVIDER_ID_PATTERN.test(declaration.id)
    && declaration.contractVersion === 1;
}

const SETTING_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const optionalOf = (value: unknown, type: 'boolean' | 'string'): boolean => value === undefined || typeof value === type;

/** One setting field's problem in words, or undefined. */
function settingFieldProblem({ field }: { field: unknown }, _optional: Record<string, never> = {}): string | undefined {
  if (!field || typeof field !== 'object' || Array.isArray(field)) return 'a provider setting must be an object';
  const { name, label, secret, required, hint } = field as Record<string, unknown>;
  if (typeof name !== 'string' || !SETTING_NAME.test(name)) return 'a provider setting name must be 1-64 letters, digits or _ (starting with a letter)';
  if (typeof label !== 'string' || !label.trim() || label.length > 120) return `provider setting '${name}' needs a label of 1-120 characters`;
  if (!optionalOf(secret, 'boolean') || !optionalOf(required, 'boolean') || !optionalOf(hint, 'string')) return `provider setting '${name}' has a malformed secret/required/hint`;
  return undefined;
}

/** Declared provider settings (see `PluginProviderDeclaration.settings`): problems in words. */
export function providerSettingsErrors({ settings }: { settings: unknown }, _optional: Record<string, never> = {}): string[] {
  if (settings === undefined) return [];
  if (!Array.isArray(settings)) return ['provider settings must be a list of fields'];
  const problems: string[] = [];
  const names = new Set<string>();
  for (const field of settings) {
    const problem = settingFieldProblem({ field });
    if (problem) { problems.push(problem); continue; }
    const { name } = field as { name: string };
    if (names.has(name)) problems.push(`duplicate provider setting '${name}'`);
    names.add(name);
  }
  return problems;
}

/** Collect static declaration errors; provider code is supported only by tier-3 admission. */
export function validatePluginProviderDeclarations(
  required: { value: unknown; tier: unknown; capabilities: unknown }, _optional: Record<string, never> = {},
): PluginValidationError[] {
  const error = (message: string): PluginValidationError => ({ code: 'PROVIDERS_INVALID', file: null, message });
  if (!Array.isArray(required.value)) return [error('contributes.providers must be a list of provider declarations')];
  const errors: PluginValidationError[] = [];
  const seen = new Set<string>();
  for (const value of required.value) {
    const declaration = { value };
    if (!isPluginProviderDeclaration(declaration)) { errors.push(error('provider requires { contract, id, contractVersion: 1 } with core provider ids')); continue; }
    errors.push(...providerSettingsErrors({ settings: declaration.value.settings }).map(error));
    const key = `${declaration.value.contract}:${declaration.value.id}`;
    if (seen.has(key)) errors.push(error(`duplicate provider declaration '${key}'`));
    seen.add(key);
  }
  if (!required.value.length) return errors;
  if (required.tier !== 'tier-3') errors.push(error('provider declarations require tier-3'));
  if (!Array.isArray(required.capabilities) || !required.capabilities.includes(PLUGIN_PROVIDER_CAPABILITY)) errors.push(error('provider declarations require providers.register'));
  return errors;
}
