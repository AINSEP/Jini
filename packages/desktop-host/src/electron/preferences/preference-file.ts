/** Read and update one key of a host's JSON preferences file through injected durable-file effects. */

/** One read of the preferences file, as the host's durable JSON store reports it. */
export type PreferenceFileRead = { state: 'ok'; value: unknown } | { state: 'missing' } | { state: 'unreadable' };

/** The durable-file effects a host binds: a read, a cross-process lock and an atomic replace. */
export interface PreferenceFilePort {
  read(args: { filePath: string }): PreferenceFileRead;
  withLock(args: { filePath: string; critical: () => void }): void;
  writeAtomic(args: { filePath: string; value: unknown }): void;
}

/** Why a read fell back: unparsable bytes, valid JSON that is not an object, or a rejected value. */
export type PreferenceProblem = 'unreadable' | 'not-an-object' | 'invalid-value';

/** Thrown by a write that finds unreadable bytes; the bytes are left untouched. */
export const PREFERENCES_UNREADABLE = 'DESKTOP_PREFERENCES_UNREADABLE';

function settingsObject({ value }: { value: unknown }, _optional = {}): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** The whole settings object; anything but a readable JSON object reads as no settings. O(file bytes). */
export function readPreferenceSettings({ file, filePath }: { file: PreferenceFilePort; filePath: string }, _optional = {}): Record<string, unknown> {
  const read = file.read({ filePath });
  return (read.state === 'ok' ? settingsObject({ value: read.value }) : undefined) ?? {};
}

/**
 * One saved value. A missing file or key reads `fallback` silently; every other fallback names its
 * problem so the host can word its own warning. `parse` answers undefined to reject a stored value.
 * @complexity O(file bytes) time and space.
 */
export function readPreferenceValue<T>({ file, filePath, key, parse, fallback }: {
  file: PreferenceFilePort;
  filePath: string;
  key: string;
  parse: (args: { value: unknown }) => T | undefined;
  fallback: T;
}, { onProblem = () => {} }: { onProblem?: (args: { problem: PreferenceProblem }) => void } = {}): T {
  const read = file.read({ filePath });
  if (read.state === 'missing') return fallback;
  if (read.state === 'unreadable') { onProblem({ problem: 'unreadable' }); return fallback; }
  const settings = settingsObject({ value: read.value });
  if (!settings) { onProblem({ problem: 'not-an-object' }); return fallback; }
  const value = settings[key];
  if (value === undefined) return fallback;
  const parsed = parse({ value });
  if (parsed !== undefined) return parsed;
  onProblem({ problem: 'invalid-value' });
  return fallback;
}

/**
 * Save one key under the file lock, keeping every other setting. Unreadable bytes are preserved
 * rather than silently replaced: the write throws `PREFERENCES_UNREADABLE` instead.
 * @complexity O(file bytes) time and space, one atomic write.
 */
export function writePreferenceValue({ file, filePath, key, value }: {
  file: PreferenceFilePort; filePath: string; key: string; value: unknown;
}, _optional = {}): void {
  file.withLock({ filePath, critical: () => {
    if (file.read({ filePath }).state === 'unreadable') throw new Error(PREFERENCES_UNREADABLE);
    file.writeAtomic({ filePath, value: { ...readPreferenceSettings({ file, filePath }), [key]: value } });
  } });
}
