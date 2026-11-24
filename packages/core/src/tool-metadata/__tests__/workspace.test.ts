import { describe, expect, it } from 'vitest';
import { toolMetadata } from '../workspace.js';

/**
 * @file Characterization pin for the workspace registration declarations: the two reads run
 * directly, the narrow rename is a direct edit, and the two never-wired tools carry search
 * keywords only — no approval policy, since no registration ever publishes them.
 */
describe('workspace tool metadata', () => {
  it('declares workspace_list and workspace_get as direct reads', () => {
    expect(toolMetadata.workspace_list.approval).toEqual({ class: 'read', confirmation: 'direct' });
    expect(toolMetadata.workspace_get.approval).toEqual({ class: 'read', confirmation: 'direct' });
    expect(toolMetadata.workspace_get.search.queries).toHaveLength(5);
  });

  it('declares workspace_update as a direct edit', () => {
    expect(toolMetadata.workspace_update.approval).toEqual({ class: 'edit', confirmation: 'direct' });
  });

  it('gives the unwired create/delete entries no approval policy', () => {
    expect(Object.keys(toolMetadata)).toEqual(['workspace_list', 'workspace_get', 'workspace_update', 'workspace_create', 'workspace_delete']);
    expect('approval' in toolMetadata.workspace_create).toBe(false);
    expect('approval' in toolMetadata.workspace_delete).toBe(false);
  });
});
