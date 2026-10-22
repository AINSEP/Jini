import { buildCapabilityScopedSdk as build, type BuildCapabilityScopedSdkRequired } from '../../capability-sdk.js';
import type { PluginSdk } from './fixture-sdk.js';
import { pluginSdkBinding } from './fixture-bindings.js';
export * from '../../capability-sdk.js';
export function buildCapabilityScopedSdk(required: Omit<BuildCapabilityScopedSdkRequired, 'pluginSdkBinding'>, optional = {}): PluginSdk {
  return build({ ...required, pluginSdkBinding }, optional) as unknown as PluginSdk;
}
