/**
 * Reads the host-namespace compatibility metadata (`extensions.<ns>.requires` / `hostRange`).
 *
 * A leaf on purpose: `manifest.ts` calls this while `compatibility.ts` needs manifest-shaped
 * types, so keeping the reader here (semver only, no lifecycle imports) keeps the lifecycle
 * import graph acyclic (`__tests__/type-cycles.test.ts`).
 */
import * as semver from 'semver';

/** Stored in place of a present-but-unusable range so the plugin stays listable but never enables. */
export const INVALID_AGENT_PLUGIN_HOST_RANGE = '<invalid>';

/** A blank string is a semver wildcard, so blank is rejected here rather than silently allowed. */
export function isValidAgentPluginHostRange({ range }: { readonly range: string }, _optional: Record<string, never> = {}): boolean {
  return range.trim().length > 0 && semver.validRange(range) !== null;
}

function isCapabilityId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function readRequires({ value, warnings }: { readonly value: unknown; readonly warnings: string[] }): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.every(isCapabilityId)) return [...new Set<string>(value)];
  warnings.push('requires must be an array of non-empty capability ids');
  return undefined;
}

function readHostRange({ value, warnings }: { readonly value: unknown; readonly warnings: string[] }): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && isValidAgentPluginHostRange({ range: value })) return value;
  warnings.push('hostRange is invalid; enabling this plugin is refused');
  return INVALID_AGENT_PLUGIN_HOST_RANGE;
}

/** Reads metadata in the host-selected namespace. A present malformed range stays incompatible;
 * malformed `requires` is advisory only, so it is dropped with a warning.
 * @returns Normalized advisory metadata and parse warnings. @complexity O(r).
 */
export function readAgentPluginCompatibilityMetadata(
  { extension }: { readonly extension: Readonly<Record<string, unknown>> },
  _optional: Record<string, never> = {},
): { requires?: readonly string[]; hostRange?: string; warnings: string[] } {
  const warnings: string[] = [];
  const requires = readRequires({ value: extension.requires, warnings });
  const hostRange = readHostRange({ value: extension.hostRange, warnings });
  return { ...(requires === undefined ? {} : { requires }), ...(hostRange === undefined ? {} : { hostRange }), warnings };
}
