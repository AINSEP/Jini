/** Universal manifest, claims, activation and hook composition; never imports or evaluates a module. */
export * from './ports.js';
export * from './plugin-format.js';
export * from './errors.js';
export * from './manifest.js';
export * from './discovery-types.js';
export * from './hook-registry.js';
export * from './attach-loaded-plugin.js';
export * from './plugin-claims.js';
export * from './claim-conflicts.js';
export * from './activation.js';
export * from './declarative-enable.js';
export * from './capability-sdk.js';
export * from './quarantine.js';
export * from './repo.memory.js';
export * from './uninstall.js';
export * from './source-policy.js';
export * from './contributions.js';
export * from './tool-contributions.js';
export * from './browser-providers.js';
export * from './bundled-initialization.js';

export { PLUGIN_PROVIDER_CAPABILITY } from './provider-contributions.js';
export type { PluginProviderResource, PluginProviderFactory, PluginProviderContribution, PluginProvidersSdk } from './provider-contributions.js';
export * from './provider-host.js';
export * from './provider-setting-required.js';
