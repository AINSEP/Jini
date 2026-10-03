/**
 * @module pi-models
 *
 * Parses `pi --list-models`'s TSV table (read from stderr) into model
 * options. Ported verbatim (pure string parsing, no transport) from OD's
 * `apps/daemon/src/pi-rpc.ts#parsePiModels` — the surrounding file is the
 * ~700-line pi-rpc stdio transport (out of this task's scope, same
 * reasoning as `acp-model-probe.ts`), but this one function has no
 * dependency on it.
 */
import type { RuntimeModelOption } from './types.js';

export function parsePiModels({ stdout }: { stdout: unknown }): RuntimeModelOption[] | null {
  const lines = String(stdout || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (lines.length === 0) return null;

  const DEFAULT_MODEL_OPTION: RuntimeModelOption = { id: 'default', label: 'Default (CLI config)' };

  // First line is the header; skip it.
  const entries: RuntimeModelOption[] = [DEFAULT_MODEL_OPTION];
  const seen = new Set(['default']);
  for (let i = 1; i < lines.length; i++) {
    // The loop bound (`i < lines.length`) guarantees `lines[i]` is always
    // defined; the non-null assertion documents that runtime invariant
    // instead of a `noUncheckedIndexedAccess`-driven guard that could never
    // actually trigger (same treatment as this function's other port,
    // `agent-protocol/pi-rpc/models.ts` — see archived provenance ledger's "Barrel
    // merge" section for why two copies of this function exist).
    const line = lines[i]!;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    // `parts.length >= 2` (just checked) guarantees both indices are
    // defined; same non-null-assertion rationale as above.
    const provider = parts[0]!;
    const modelId = parts[1]!;
    // Skip duplicates (some providers list the same model under multiple names).
    const fullId = `${provider}/${modelId}`;
    if (seen.has(fullId)) continue;
    seen.add(fullId);
    entries.push({ id: fullId, label: fullId });
  }

  return entries.length > 1 ? entries : null;
}
