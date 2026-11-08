import type { PluginCredentialField, PluginCredentialCard } from '@jini-ai/core/contracts/credentials';
export type { PluginCredentialField, PluginCredentialCard } from '@jini-ai/core/contracts/credentials';
import type { PluginContributionParseResult } from './contribution-loader.js';
import { readAgentPluginPortableExtension, readAgentPluginCompatibilityWarnings } from '../core/identity-namespace.js';

/** Supported categories for portable connection-card declarations. */
const CUSTOM_CREDENTIAL_CATEGORIES = ['source-control', 'hosting', 'media', 'ai', 'ops', 'general'] as const;


type RecordValue = Record<string, unknown>;
const recordOf = ({ value }: { value: unknown }, _options = {}): RecordValue | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as RecordValue : undefined;
const saveKinds = ['api', 'publish-host', 'source-control', 'agent-plugin-token', 'oauth', 'provider-settings'];

/** Bounded display text, never a submitted value. @complexity O(1). */
function text({ value, name, required = false, maxLength = 2000 }: { value: unknown; name: string; required?: boolean; maxLength?: number }, _options = {}): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw new Error(`${name} must be non-empty text (at most ${maxLength} characters)`);
  return value.trim();
}

/** Shared by manifest and mail card parsers: purpose copy grants no routing or authority.
 * @returns Trimmed display strings, or undefined for legacy cards.
 * @throws Error for malformed or oversized copy. @complexity O(entries), capped at 8 × 120 characters.
 */
export function parseCredentialCardUsedFor({ value }: { value: unknown }, _options = {}): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 8) throw new Error('usedFor must be an array of at most 8 entries');
  return value.map(value => text({ value, name: 'usedFor entry', required: true, maxLength: 120 })!);
}

/** Reject active URLs, embedded credentials and non-HTTPS origins in declarations. */
function httpsUrl({ value, name }: { value: unknown; name: string }, _options = {}): string | undefined {
  const result = text({ value, name });
  if (result === undefined) return undefined;
  const url = new URL(result);
  if (url.protocol !== 'https:' || url.username || url.password || /^https:\/\/[^/?#]*@/i.test(result)) throw new Error(`${name} must be an HTTPS URL without credentials`);
  return result;
}

/** A probe is API-card metadata bound to a fixed base origin, never a submitted destination.
 * @returns The declared URL, or no field for legacy cards. @throws Error for unsafe declarations.
 * @complexity O(1), bounded URL text; no I/O.
 */
function probeOf({ value, baseUrl }: { value: RecordValue; baseUrl?: string | undefined }, _options = {}): Pick<PluginCredentialCard, 'probeUrl'> {
  if (value.probeUrl === undefined) return {};
  const probeUrl = httpsUrl({ value: value.probeUrl, name: 'probeUrl' })!;
  if (!isApiCard({ value }) || !baseUrl || new URL(probeUrl).origin !== new URL(baseUrl).origin) throw new Error('probeUrl requires an API card with a same-origin declared baseUrl');
  return { probeUrl };
}

/** Non-secret supplemental inputs; domain owners still validate the submitted connection. */
function fieldsOf({ value }: { value: unknown }, _options = {}): readonly PluginCredentialField[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 16) throw new Error('fields must be an array of at most 16 non-secret fields');
  const seen = new Set<string>();
  return value.map(entry => {
    const field = recordOf({ value: entry });
    if (!field || field.secret !== undefined) throw new Error('extra fields must be non-secret');
    const name = text({ value: field.name, name: 'field.name', required: true })!;
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name) || /token|password|secret|authorization|cookie/i.test(name) || seen.has(name)) throw new Error('invalid or duplicate non-secret field name');
    seen.add(name);
    if (field.required !== undefined && typeof field.required !== 'boolean') throw new Error('field.required must be boolean');
    return { name, label: text({ value: field.label, name: 'field.label', required: true })!, ...(field.hint === undefined ? {} : { hint: text({ value: field.hint, name: 'field.hint' })! }), ...(field.required === undefined ? {} : { required: field.required as boolean }) };
  });
}

/** Validate one declaration, leaving all labels and destinations under plugin ownership. */
function cardOf({ value }: { value: unknown }, _options = {}): PluginCredentialCard {
  const declaration = recordOf({ value });
  if (!declaration) throw new Error('credential card must be an object');
  return declaredCard({ value: declaration });
}

/** Materialize the already checked object through the shared field and identity validators. */
function declaredCard({ value }: { value: RecordValue }, _options = {}): PluginCredentialCard {
  const { target, category } = cardIdentity({ value });
  const fields = fieldsOf({ value: value.fields });
  const usedFor = parseCredentialCardUsedFor({ value: value.usedFor });
  const baseUrl = httpsUrl({ value: value.baseUrl, name: 'baseUrl' });
  validateCardFields({ value, fields, baseUrl });
  return { providerId: target, category, baseUrl: baseUrl ?? '', ...probeOf({ value, baseUrl }), ...cardText({ value }), ...ownedApiLabelOf({ value }), ...(usedFor === undefined ? {} : { usedFor }), ...(fields === undefined ? {} : { fields }), ...additionalOrigins({ value: value.additionalHosts }), ...(value.saveKind === undefined ? {} : { saveKind: value.saveKind as NonNullable<PluginCredentialCard['saveKind']> }) };
}

/** A card may claim only its own API row, never grant ownership to other cards or domain stores. */
function ownedApiLabelOf({ value }: { value: RecordValue }, _options = {}): Pick<PluginCredentialCard, 'ownedApiLabel'> {
  const ownedApiLabel = text({ value: value.ownedApiLabel, name: 'ownedApiLabel' });
  if (ownedApiLabel === undefined) return {};
  if (!isApiCard({ value }) || ownedApiLabel !== text({ value: value.label, name: 'label', required: true })) throw new Error('ownedApiLabel must match the API card label');
  return { ownedApiLabel };
}

/** Select only supported display metadata; unknown manifest keys never reach a form or store. */
function cardText({ value }: { value: RecordValue }, _options = {}): Pick<PluginCredentialCard, 'label' | 'title' | 'intro' | 'keyHint' | 'helpLabel' | 'helpUrl' | 'saveTarget' | 'permissions'> {
  const result: Record<string, string> = {};
  for (const name of ['label', 'title', 'intro', 'keyHint']) result[name] = text({ value: value[name], name, required: true })!;
  for (const name of ['helpLabel', 'saveTarget', 'permissions']) {
    const field = text({ value: value[name], name });
    if (field !== undefined) result[name] = field;
  }
  const helpUrl = httpsUrl({ value: value.helpUrl, name: 'helpUrl' });
  if (helpUrl !== undefined) result.helpUrl = helpUrl;
  return result as unknown as ReturnType<typeof cardText>;
}

/** Parse portable connection-card declarations without executing plugin modules.
 * Refuse the whole batch on invalid or duplicate targets; absent declarations remain compatible.
 * Legacy namespace reads warn through the host callback (console by default).
 * @returns Normalized display/form metadata or a declaration-specific refusal reason.
 * @complexity O(c + f), capped at 32 cards × 16 fields; no I/O or input mutation.
 */
export function parsePluginCredentialCards({ raw }: { raw: string }, options: { identityNamespace?: string; onWarning?: (warning: string) => void } = {}): PluginContributionParseResult<PluginCredentialCard> {
  try {
    const manifest = recordOf({ value: JSON.parse(raw) });
    if (!manifest) throw new Error('plugin manifest must be an object');
    const extension = readAgentPluginPortableExtension({ value: manifest }, options);
    for (const warning of readAgentPluginCompatibilityWarnings({ value: manifest }, options)) (options.onWarning ?? console.warn)(warning);
    const descriptors = parseCardBatch({ value: extension?.credentialCards });
    return { ok: true, descriptors };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'invalid credential cards' };
  }
}

/** Validate collection bounds separately from manifest decoding. O(cards + fields). */
function parseCardBatch({ value }: { value: unknown }, _options = {}): readonly PluginCredentialCard[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32) throw new Error('credentialCards must be an array of at most 32 cards');
  const descriptors = value.map(value => cardOf({ value }));
  if (new Set(descriptors.map(card => card.providerId)).size !== descriptors.length) throw new Error('duplicate credential card target');
  return descriptors;
}

/** Extra API origins are plugin metadata, never model or iframe input. */
function additionalOrigins({ value }: { value: unknown }, _options = {}): Pick<PluginCredentialCard, 'additionalHosts'> {
  if (value === undefined) return {};
  if (!Array.isArray(value) || value.length > 8) throw new Error('additionalHosts must be at most eight HTTPS origins');
  return { additionalHosts: value.map(entry => {
    const url = httpsUrl({ value: entry, name: 'additionalHosts' });
    if (!url || new URL(url).origin !== url) throw new Error('additionalHosts must contain origins only');
    return url;
  }) };
}

/** Check target and store discriminants independently from optional form metadata. */
function cardIdentity({ value }: { value: RecordValue }, _options = {}): { target: string; category: string } {
  const target = text({ value: value.target, name: 'target', required: true })!;
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(target)) throw new Error('invalid card target');
  const category = text({ value: value.category, name: 'category', required: true })!;
  if (!CUSTOM_CREDENTIAL_CATEGORIES.includes(category as never)) throw new Error('invalid card category');
  if (value.saveKind !== undefined && !saveKinds.includes(value.saveKind as string)) throw new Error('invalid saveKind');
  if (value.saveTarget !== undefined && (typeof value.saveTarget !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(value.saveTarget))) throw new Error('invalid saveTarget');
  return { target, category };
}

/** API public inputs have corresponding store slots; domain-owned forms retain their own fields. */
function validateCardFields({ value, fields = [], baseUrl }: { value: RecordValue; fields?: readonly PluginCredentialField[] | undefined; baseUrl?: string | undefined }, _options = {}): void {
  if (!isApiCard({ value }) && fields.length) throw new Error('Only API cards may declare fields; domain forms own their inputs');
  // A provider-settings card's fields and destinations are the provider plugin's declared settings.
  if (value.saveKind === 'provider-settings') return validateProviderSettingsDestination({ value, baseUrl });
  if (!baseUrl && !fields.some(field => field.name === 'baseUrl' && field.required)) throw new Error('baseUrl or a required baseUrl field is required');
  if (isApiCard({ value }) && fields.some(field => !['username', 'baseUrl'].includes(field.name))) throw new Error('API cards support only username and baseUrl public fields');
}

function validateProviderSettingsDestination({ value, baseUrl }: { value: RecordValue; baseUrl?: string | undefined }, _options = {}): void {
  if (value.saveTarget === undefined || baseUrl) throw new Error('provider-settings cards need a saveTarget and no baseUrl');
}

/** Missing saveKind retains the original API-card contract. */
function isApiCard({ value }: { value: { saveKind?: unknown } }, _options = {}): boolean { return value.saveKind === undefined || value.saveKind === "api"; }
