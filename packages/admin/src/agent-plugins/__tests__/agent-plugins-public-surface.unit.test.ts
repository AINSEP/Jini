import { describe, expect, it } from 'vitest';
import * as surface from '../index.js';

describe('@jini-ai/admin/agent-plugins public surface', () => {
  it('exports exactly these runtime names', () => {
    expect(Object.keys(surface).sort()).toEqual([
      'AGENT_PLUGINS_READ',
      'AGENT_PLUGINS_SPEC_URL',
      'AGENT_PLUGINS_WRITE',
      'agentPluginDisableCopy',
      'agentPluginFileNotice',
      'agentPluginFilesSnapshot',
      'agentPluginGlyphKind',
      'agentPluginSummary',
      'agentPluginsApiToken',
      'agentPluginsMessagesEn',
      'agentPluginsModule',
      'ancestorFolderPaths',
      'buildPackageFileTree',
      'createAgentPluginFilesController',
      'createAgentPluginsController',
      'firstPackageFilePath',
      'humanizeAgentPluginId',
      'packageFileIconKind',
      'packageFileTreeKeyAction',
      'selectAgentPluginFile',
      'visiblePackageFileRows',
    ]);
  });
});
