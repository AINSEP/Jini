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
  return providerIdValid(declaration.contract) && providerIdValid(declaration.id) && declaration.contractVersion === 1;
}

function providerIdValid(value: unknown): boolean {
  return typeof value === 'string' && PROVIDER_ID_PATTERN.test(value);
}

const SETTING_NAME = /^[A-Za-z]\w{0,63}$/;

function optionalOf(value: unknown, type: 'boolean' | 'string'): boolean {
  return value === undefined || typeof value === type;
}

function optionalFlagsValid({ secret, required, hint, allowCustom }: Record<string, unknown>): boolean {
  return optionalOf(secret, 'boolean') && optionalOf(required, 'boolean') && optionalOf(hint, 'string') && optionalOf(allowCustom, 'boolean');
}

function labelValid(label: unknown): boolean {
  return typeof label === 'string' && label.trim() !== '' && label.length <= 120;
}

/** Declared references use the same setting-name grammar. O(1). */
function settingNameValid(value: unknown): boolean {
  return typeof value === 'string' && SETTING_NAME.test(value);
}

/** Header alternatives use an explicit allowlist, with HTTP token names only. */
function headerNamesValid({ headerNames, orPresent }: { headerNames: unknown; orPresent: unknown }, _optional = {}): boolean {
  if (headerNames === undefined) return true;
  return settingNameValid(orPresent) && Array.isArray(headerNames) && headerNames.length > 0
    && headerNames.every(name => typeof name === 'string' && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name));
}

/** A conditional requirement is an exact match or a named alternative, never executable plugin logic. */
function requiredUnlessValid(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const { field, equals, orPresent, headerNames } = value as Record<string, unknown>;
  const orPresentValid = orPresent === undefined || settingNameValid(orPresent);
  return settingNameValid(field) && typeof equals === 'string' && orPresentValid && headerNamesValid({ headerNames, orPresent });
}

/** A conditional requirement names public string choices, never executable plugin logic.
 * @complexity O(k) in declared choices; no effects. */
function requiredWhenValid(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const { field, in: choices } = value as Record<string, unknown>;
  const choicesValid = Array.isArray(choices) && choices.length > 0 && choices.every((choice) => typeof choice === 'string' && choice.trim() !== '');
  return settingNameValid(field) && choicesValid;
}

const optionValid = (option: unknown): boolean => {
  const { value, label } = (option ?? {}) as Record<string, unknown>;
  return typeof value === 'string' && value.trim() !== '' && labelValid(label);
};

/**
 * `default` / `options` / `allowCustom` (public fields only): a host prefills a default and renders
 * options as a select, so a secret can carry neither (a declared default would be a shared secret).
 */
function choicesProblem({ name, field }: { name: string; field: Record<string, unknown> }): string | undefined {
  const { secret, options, allowCustom } = field;
  if (secret === true && (field.default !== undefined || options !== undefined)) return `secret provider setting '${name}' cannot declare a default or options`;
  if (!optionalOf(field.default, 'string')) return `provider setting '${name}' has a malformed default`;
  if (options === undefined) return allowCustom === undefined ? undefined : `provider setting '${name}' declares allowCustom without options`;
  if (!Array.isArray(options) || options.length === 0 || !options.every(optionValid)) return `provider setting '${name}' options must be a non-empty list of { value, label }`;
  return undefined;
}

/** One setting field's problem in words, or undefined. */
function settingFieldProblem({ field }: { field: unknown }, _optional: Record<string, never> = {}): string | undefined {
  if (!field || typeof field !== 'object' || Array.isArray(field)) return 'a provider setting must be an object';
  const { name, label } = field as Record<string, unknown>;
  if (!settingNameValid(name)) return 'a provider setting name must be 1-64 letters, digits or _ (starting with a letter)';
  if (!labelValid(label)) return `provider setting '${name}' needs a label of 1-120 characters`;
  if (!optionalFlagsValid(field as Record<string, unknown>)) return `provider setting '${name}' has a malformed secret/required/hint/allowCustom`;
  if (!requiredUnlessValid((field as Record<string, unknown>).requiredUnless)) return `provider setting '${name}' has a malformed requiredUnless`;
  if (!requiredWhenValid((field as Record<string, unknown>).requiredWhen)) return `provider setting '${name}' has a malformed requiredWhen`;
  return choicesProblem({ name: name as string, field: field as Record<string, unknown> });
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

type MigrationFields = readonly import('./manifest-types.js').PluginProviderSettingField[];
const publicSetting = ({ fields, name }: { fields: MigrationFields; name: unknown }, _optional = {}) =>
  fields.some(field => field.name === name && !field.secret);

/** Migration conditions only inspect declared public settings, so redacted reads behave identically. */
function migrationConditionValid({ when, whenPresent, fields }: { when: unknown; whenPresent: unknown; fields: MigrationFields }, _optional = {}): boolean {
  if (!when || !requiredWhenValid(when)) return false;
  const condition = when as Record<string, unknown>;
  return optionalOf(condition.orAbsent, 'boolean') && publicSetting({ fields, name: condition.field })
    && (whenPresent === undefined || publicSetting({ fields, name: whenPresent }));
}

/** Migrations may assign public string fields only. */
function migrationAssignmentsValid({ set, fields }: { set: unknown; fields: MigrationFields }, _optional = {}): boolean {
  if (!set || typeof set !== 'object' || Array.isArray(set)) return false;
  const assignments = Object.entries(set);
  return assignments.length > 0 && assignments.every(([name, value]) => typeof value === 'string' && publicSetting({ fields, name }));
}

/** Validate the hook before a host reads it; malformed lists never reach migration execution. */
function migrationValid({ rule, fields }: { rule: unknown; fields: MigrationFields }, _optional = {}): boolean {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return false;
  const { when, whenPresent, set } = rule as Record<string, unknown>;
  return migrationConditionValid({ when, whenPresent, fields }) && migrationAssignmentsValid({ set, fields });
}

/** Reject malformed migration hooks before a host can read them. */
function migrationsValid({ provider }: { provider: import('./manifest-types.js').PluginProviderDeclaration }, _optional = {}): boolean {
  if (provider.settingsMigrations === undefined) return true;
  return Array.isArray(provider.settings) && providerSettingsErrors({ settings: provider.settings }).length === 0
    && Array.isArray(provider.settingsMigrations)
    && provider.settingsMigrations.every(rule => migrationValid({ rule, fields: provider.settings! }));
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
    if (!migrationsValid({ provider: declaration.value })) errors.push(error('provider settingsMigrations are malformed or assign secret fields'));
    const key = `${declaration.value.contract}:${declaration.value.id}`;
    if (seen.has(key)) errors.push(error(`duplicate provider declaration '${key}'`));
    seen.add(key);
  }
  if (!required.value.length) return errors;
  errors.push(...providerAdmissionErrors({ tier: required.tier, capabilities: required.capabilities }));
  return errors;
}

function providerAdmissionErrors({ tier, capabilities }: { tier: unknown; capabilities: unknown }, _optional = {}): PluginValidationError[] {
  const errors: PluginValidationError[] = [];
  const error = (message: string): PluginValidationError => ({ code: 'PROVIDERS_INVALID', file: null, message });
  if (tier !== 'tier-3') errors.push(error('provider declarations require tier-3'));
  if (!Array.isArray(capabilities) || !capabilities.includes(PLUGIN_PROVIDER_CAPABILITY)) errors.push(error('provider declarations require providers.register'));
  return errors;
}
