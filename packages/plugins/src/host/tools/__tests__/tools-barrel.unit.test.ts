import { describe, expect, it } from 'vitest';
import * as barrel from '../index.js';
import { buildPluginInstallRegistrations, pluginInstallDerivedRiskFor } from '../install.js';
import { buildPluginManagementRegistrations, pluginApprovalIdentity, pluginManagementDerivedRiskFor } from '../management.js';
import { buildPluginSourceRegistrations, pluginSourceDerivedRiskFor } from '../source.js';
import { PluginInstallError, PluginSourceError } from '../../plugin-tool-errors.js';

describe('tools barrel', () => {
  it('re-exports the builders, risk classifiers and canonical error classes by identity', () => {
    expect(barrel.buildPluginInstallRegistrations).toBe(buildPluginInstallRegistrations);
    expect(barrel.pluginInstallDerivedRiskFor).toBe(pluginInstallDerivedRiskFor);
    expect(barrel.buildPluginManagementRegistrations).toBe(buildPluginManagementRegistrations);
    expect(barrel.pluginManagementDerivedRiskFor).toBe(pluginManagementDerivedRiskFor);
    expect(barrel.pluginApprovalIdentity).toBe(pluginApprovalIdentity);
    expect(barrel.buildPluginSourceRegistrations).toBe(buildPluginSourceRegistrations);
    expect(barrel.pluginSourceDerivedRiskFor).toBe(pluginSourceDerivedRiskFor);
    expect(barrel.PluginInstallError).toBe(PluginInstallError);
    expect(barrel.PluginSourceError).toBe(PluginSourceError);
    expect(Object.keys(barrel).sort()).toEqual([
      'PluginInstallError', 'PluginSourceError', 'buildPluginInstallRegistrations', 'buildPluginManagementRegistrations',
      'buildPluginSourceRegistrations', 'pluginApprovalIdentity', 'pluginInstallDerivedRiskFor', 'pluginManagementDerivedRiskFor', 'pluginSourceDerivedRiskFor',
    ]);
  });
});
