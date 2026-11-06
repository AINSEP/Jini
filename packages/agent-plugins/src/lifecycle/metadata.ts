/** Portable advisory metadata. Invalid declarations warn and contribute nothing; parsing never
 * executes a plugin or turns presentation copy into an authorization decision. */
import { readAgentPluginPortableExtension, readAgentPluginCompatibilityWarnings } from '../core/identity-namespace.js';

export interface AgentPluginHostSignal {
  readonly env: string;
  readonly facts: { readonly hosted?: boolean; readonly nativeToolsRestricted?: boolean; readonly trustProxyHops?: number };
  readonly label?: string;
}
export interface AgentPluginMetadata {
  readonly displayName?: string;
  readonly summary?: string;
  readonly vendorAliases?: readonly string[];
  readonly toolKeywords?: Readonly<Record<string, string>>;
  readonly hostSignals?: readonly AgentPluginHostSignal[];
  readonly deploymentAdvice?: string;
  readonly card?: Readonly<Record<string, string>>;
}

const object = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 2048 && !/[\x00-\x1f\x7f]/.test(value);
const texts = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every(text);
const textMap = (value: unknown): value is Readonly<Record<string, string>> => object(value) && Object.values(value).every(text);

/** Only declared boolean facts and a finite positive safe proxy-hop count can be host hints. */
function validFacts(value: unknown): boolean {
  return object(value) && Object.entries(value).every(([key, fact]) => {
    if (key === 'hosted' || key === 'nativeToolsRestricted') return typeof fact === 'boolean';
    return key === 'trustProxyHops' && Number.isSafeInteger(fact) && (fact as number) > 0;
  });
}

function validSignal(value: unknown): value is AgentPluginHostSignal {
  if (!object(value) || typeof value.env !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(value.env)) return false;
  return validFacts(value.facts) && (value.label === undefined || text(value.label));
}

/** Presentation readers also run before full manifest loading, so name/schema are not required.
 * Fields are normalized independently except host signals and their advice: invalid advice
 * invalidates that complete security declaration, preserving the host's existing fallback.
 * @returns Typed advisory fields and host-visible diagnostics. @complexity O(k + s) metadata keys/signals. */
export function readAgentPluginMetadata(
  required: { readonly value: unknown },
  optional: { readonly identityNamespace?: string } = {},
): { readonly metadata: AgentPluginMetadata; readonly warnings: readonly string[] } {
  const extension = readAgentPluginPortableExtension(required, optional) ?? {};
  const warnings = [...readAgentPluginCompatibilityWarnings(required, optional)];
  const metadata: Record<string, unknown> = {};
  for (const [key, check] of Object.entries({ vendorAliases: texts, card: textMap })) {
    if (extension[key] === undefined) continue;
    if (check(extension[key])) metadata[key] = extension[key];
    else warnings.push(`Invalid agent-plugin ${key} metadata was ignored.`);
  }
  Object.assign(metadata, presentationMetadata({ extension, warnings }), keywordMetadata({ extension, warnings }));
  Object.assign(metadata, hostMetadata({ extension, warnings }));
  return { metadata: metadata as AgentPluginMetadata, warnings };
}

/** Cosmetic text retains the preexisting trim/cap behavior, including summary paragraphs. */
function presentationMetadata({ extension, warnings }: { readonly extension: Readonly<Record<string, unknown>>; readonly warnings: string[] }): Pick<AgentPluginMetadata, 'displayName' | 'summary'> {
  const metadata: Record<string, string> = {};
  for (const [key, maxLength] of Object.entries({ displayName: 64, summary: 1200 })) {
    const field = extension[key];
    if (field === undefined) continue;
    if (typeof field === 'string' && field.trim()) metadata[key] = field.trim().slice(0, maxLength);
    else warnings.push(`Invalid agent-plugin ${key} metadata was ignored.`);
  }
  return metadata;
}

/** Keep valid keyword siblings from older partially malformed declarations. */
function keywordMetadata({ extension, warnings }: { readonly extension: Readonly<Record<string, unknown>>; readonly warnings: string[] }): Pick<AgentPluginMetadata, 'toolKeywords'> {
  if (extension.toolKeywords === undefined) return {};
  if (!object(extension.toolKeywords)) {
    warnings.push('Invalid agent-plugin toolKeywords metadata was ignored.');
    return {};
  }
  const entries = Object.entries(extension.toolKeywords);
  const valid = entries.filter((entry): entry is [string, string] => text(entry[1]));
  if (valid.length !== entries.length) warnings.push('Invalid agent-plugin toolKeywords entries were ignored.');
  return valid.length ? { toolKeywords: Object.fromEntries(valid) } : {};
}

function hostMetadata({ extension, warnings }: { readonly extension: Readonly<Record<string, unknown>>; readonly warnings: string[] }): Pick<AgentPluginMetadata, 'hostSignals' | 'deploymentAdvice'> {
  if (extension.hostSignals === undefined) return {};
  const signals = extension.hostSignals;
  const advice = extension.deploymentAdvice;
  if (!Array.isArray(signals) || !signals.every(validSignal) || (advice !== undefined && !text(advice))) {
    warnings.push('Invalid agent-plugin hostSignals declaration was ignored.');
    return {};
  }
  return { hostSignals: signals, ...(advice === undefined ? {} : { deploymentAdvice: advice as string }) };
}
