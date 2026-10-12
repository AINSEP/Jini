/** Host-injected deployment policy. Environment interpretation belongs to composition adapters. */
export interface PluginSourcePolicyPort {
  localInstallEnabled(required?: Record<string, never>, optional?: Record<string, never>): boolean;
  confirmEnable(required: { sealedHere: boolean }, optional?: Record<string, never>): boolean;
}

/** Local authoring runs directly; hosted sideloading retains the host's explicit opt-in.
 * @param required Deployment facts supplied by the host.
 * @param _optional Reserved factory options.
 * @returns The shared install/enable policy, with no environment reads.
 * @example createPluginSourcePolicy({ hosted: false, localInstallOptIn: false }, {})
 */
export function createPluginSourcePolicy(required: { hosted: boolean; localInstallOptIn: boolean }, _optional = {}): PluginSourcePolicyPort {
  return {
    localInstallEnabled: (_required = {}, _optional = {}) => !required.hosted || required.localInstallOptIn,
    confirmEnable: ({ sealedHere }, _optional = {}) => !sealedHere,
  };
}
