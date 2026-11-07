/** @file Pure rules for a plugin's cookie-consent contribution file (schema 2: one open
 * `contributions` list of `{ kind, id, … }`): region readers, browser bridges and declared scripts.
 * Data only; no plugin code runs. Kinds this file doesn't know are skipped, not refused. Loading,
 * activation and which plugin may supply trusted region readers stay with the host. */
import type { RawContribution } from '../contract.js';
import { validateScripts } from './scripts.js';

/** Parse one schema-2 file into region readers and browser bridge declarations. Pure. @complexity O(entries). */
export function parseConsentContributions({ raw }: { raw: string }, _optional = {}): { ok: true; descriptors: RawContribution[] } | { ok: false; reason: string } {
  let file: unknown;
  try { file = JSON.parse(raw); } catch { return { ok: false, reason: 'not JSON' }; }
  const { schemaVersion, contributions } = (file ?? {}) as { schemaVersion?: unknown; contributions?: unknown };
  if (schemaVersion !== 2 || !Array.isArray(contributions)) return { ok: false, reason: 'expected { "schemaVersion": 2, "contributions": [...] }' };
  const descriptors = contributions.filter(isConsentContribution);
  return { ok: true, descriptors };
}

function isConsentContribution(item: unknown): item is RawContribution {
  if (!item || typeof item !== 'object') return false;
  const entry = item as RawContribution;
  if (entry.kind === 'declared-scripts') return true;
  if (typeof entry.id !== 'string') return false;
  return entry.kind === 'region-resolver' || consentBridgeContribution({ entry }) !== undefined;
}

/** Accept only data and a served HTTP(S) or site-relative module URL; no inline code or URL schemes.
 * O(URL bytes); this never resolves or reads the module on the server. */
export function consentBridgeContribution({ entry }: { entry: RawContribution }, _optional = {}): RawContribution | undefined {
  if (entry.kind !== 'consent-bridge' || !servedUrl(entry.src)) return undefined;
  return { id: entry.id, kind: 'consent-bridge', src: entry.src };
}

function servedUrl(src: unknown): src is string {
  if (typeof src !== 'string' || /[\\\s]/.test(src)) return false;
  const relative = src.startsWith('/') && !src.startsWith('//');
  if (!relative && !/^https?:\/\//i.test(src)) return false;
  try {
    const url = new URL(src, 'https://site.invalid');
    return !url.username && !url.password;
  } catch { return false; }
}

/** Validate one recognized contribution so the lifecycle returns an explicit refusal, not a silent drop. */
export function declaredScriptsContribution(
  { pluginId, entry }: { pluginId: string; entry: RawContribution },
  _optional = {},
): { pluginId: string; entry: RawContribution } | string {
  if (typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(entry.id)) return `Script declarations from '${pluginId}' have an invalid contribution id.`;
  const checked = validateScripts({ scripts: entry.scripts });
  const label = `Script declarations '${entry.id}' from '${pluginId}'`;
  if (entry.scripts === undefined) return `${label} need a scripts array.`;
  if (checked.problems.length) return `${label} were refused: ${checked.problems.join('; ')}.`;
  if (checked.scripts.some(script => !servedUrl(script.src))) return `${label} need already-served HTTP(S) or site-relative URLs; unresolved relative paths are not supported.`;
  return { pluginId, entry: { id: entry.id, kind: entry.kind, scripts: checked.scripts } };
}
