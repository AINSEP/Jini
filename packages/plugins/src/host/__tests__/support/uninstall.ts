import { forgetPluginActivations as forget } from '../../uninstall.js';
import type { PluginActivationRepoPort } from '../../activation.js';
export * from '../../uninstall.js';
export function forgetPluginActivations(required: { pluginId: string }, deps: { repo: PluginActivationRepoPort }) { return forget({ ...required, deps }); }
