import type { InstalledAgentPlugin, InstalledAgentPluginSkill, SetAgentPluginEnabledInput } from '@jini-ai/core/contracts/site/agent-plugins-lifecycle';
import type { AgentPluginActivationInput, AgentPluginSummary } from '../models.js';

/**
 * @file Compile-time proof that admin's restated plugin types still fit the plugin lifecycle's. Admin no longer imports
 * the lifecycle package in its sources; this test-only file is where a drift on either side fails `tsc`.
 */
type Assert<T extends true> = T;
type Fits<Installed, Restated> = [Installed] extends [Restated] ? true : false;

export type PluginFits = [
  Assert<Fits<InstalledAgentPlugin['pluginId'], AgentPluginSummary['pluginId']>>,
  Assert<Fits<NonNullable<InstalledAgentPlugin['version']>, NonNullable<AgentPluginSummary['version']>>>,
  Assert<Fits<NonNullable<InstalledAgentPlugin['description']>, NonNullable<AgentPluginSummary['description']>>>,
  Assert<Fits<NonNullable<InstalledAgentPlugin['keywords']>, AgentPluginSummary['keywords']>>,
  Assert<Fits<InstalledAgentPluginSkill['name'], AgentPluginSummary['skills'][number]['name']>>,
  Assert<Fits<SetAgentPluginEnabledInput, AgentPluginActivationInput>>,
];
