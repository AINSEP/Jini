/** A boolean rollout decision with its winning layer; feature flags never grant permissions. */
export interface FeatureFlagDecision {
  enabled: boolean;
  source: 'environment' | 'runtime' | 'workspace' | 'default';
}

/** Evaluate one flag. Environment is the deployment override; runtime precedes persisted workspace.
 * An explicitly malformed layer disables the feature instead of falling through to an enabling layer.
 * @param requiredArgs - Flag key for a stable caller contract (the host owns lookup).
 * @param optionalArgs - Layer values, with absent layers represented by undefined. Defaults off.
 * @returns The winning decision and source, with no I/O or mutation.
 * @complexity O(1) time and space.
 */
export function evaluateFeatureFlag(
  _requiredArgs: { key: string },
  { environment, runtime, workspace, defaultEnabled = false }: {
    environment?: unknown; runtime?: unknown; workspace?: unknown; defaultEnabled?: boolean;
  } = {},
): FeatureFlagDecision {
  if (environment !== undefined) return { enabled: environment === 'true' || environment === '1', source: 'environment' };
  if (runtime !== undefined) return { enabled: runtime === true, source: 'runtime' };
  if (workspace !== undefined) return { enabled: workspace === true, source: 'workspace' };
  return { enabled: defaultEnabled === true, source: 'default' };
}
