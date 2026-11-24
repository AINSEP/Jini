import type { DeployTargetInspection } from '../deploy-targets/types.js';

type DetailRow = { readonly label: string; readonly value: string };

/**
 * Projects a plugin's opaque inspection onto the domain confirmation card as short readable rows:
 * what is published where, the current state of every hostname, then each change, one per row.
 * Changes come from `domains.changes` — the exact list that will run, already de-duplicated (a
 * wildcard route seen from both hostnames is removed once) — not from the per-hostname views.
 * Vendor interpretation stays in the plugin: a change's own `reason` (or a host's `summary`) is
 * shown as written; anything without one falls back to its plain fields — never a JSON dump, and
 * never silently dropped, because the card is the person's consent to exactly these changes.
 * @param required - Inspected plan plus the site's project and target labels.
 * @param _options - Reserved options.
 * @returns Plain text rows in card order.
 * @complexity O(n) time/space in the inspection's size.
 */
export function domainPublishRows(required: {
  inspection: DeployTargetInspection; projectName: string; target: string;
}, _options = {}): DetailRow[] {
  const { inspection, projectName, target } = required;
  const changes = inspection.domains?.changes ?? [];
  return [
    { label: 'Project', value: projectName }, { label: 'Target', value: target },
    ...inspection.hostingChanges.map(change => ({ label: 'Hosting', value: describe({ value: change }) })),
    ...(inspection.domains?.hostnames ?? []).map(host => hostnameRow({ host })),
    ...(changes.length ? changes.map(change => ({ label: 'Will change', value: describe({ value: change }) })) : [{ label: 'Will change', value: 'No domain changes.' }]),
    ...(inspection.formSubmissions ? [{ label: 'Form submissions', value: inspection.formSubmissions.message }] : []),
  ];
}

/** One hostname's current state: the plugin's own summary when it gives one, else its status. */
function hostnameRow({ host }: { host: Readonly<Record<string, unknown>> }, _options = {}): DetailRow {
  const hostname = typeof host.hostname === 'string' ? host.hostname : 'hostname';
  const status = typeof host.status === 'string' ? host.status.replaceAll('-', ' ') : 'unknown';
  const now = typeof host.summary === 'string' && host.summary.trim() ? host.summary : status;
  return { label: `Now on ${hostname}`, value: now };
}

/** A plugin-written `reason` when present; otherwise the value's own fields as `key: value` text. */
function describe({ value }: { value: unknown }, _options = {}): string {
  if (value === null || typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return value.map(item => describe({ value: item })).join('; ');
  const record = value as Readonly<Record<string, unknown>>;
  if (typeof record.reason === 'string' && record.reason.trim()) return record.reason;
  return Object.entries(record).map(([key, item]) => item !== null && typeof item === 'object' ? `${key}: (${describe({ value: item })})` : `${key}: ${String(item)}`).join(', ');
}
