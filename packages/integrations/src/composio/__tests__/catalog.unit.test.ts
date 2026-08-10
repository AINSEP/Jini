import { describe, expect, it } from 'vitest';

import {
  classifyConnectorToolSafety,
  connectorDefinitionToDetail,
  defineConnectorTool,
  getComposioToolkitMetadata,
  getStaticComposioCatalogDefinitions,
  DOCUMENTED_COMPOSIO_TOOLKITS,
  FEATURED_COMPOSIO_CATALOG,
} from '../index.js';

describe('Composio catalog contracts', () => {
  it('classifies destructive, write, read, and ambiguous tools conservatively', () => {
    expect(classifyConnectorToolSafety({ name: 'files.remove_all' })).toMatchObject({
      sideEffect: 'destructive',
      approval: 'disabled',
    });
    expect(classifyConnectorToolSafety({ name: 'issues.create' })).toMatchObject({
      sideEffect: 'write',
      approval: 'confirm',
    });
    expect(classifyConnectorToolSafety({ name: 'issues.list' })).toMatchObject({
      sideEffect: 'read',
      approval: 'auto',
    });
    expect(classifyConnectorToolSafety({ name: 'issues.process' })).toMatchObject({
      sideEffect: 'write',
      approval: 'confirm',
    });
    expect(classifyConnectorToolSafety({
      name: 'messages.search',
      title: 'Search messages',
      description: 'Send a message to the selected channel.',
    })).toMatchObject({
      sideEffect: 'write',
      approval: 'confirm',
    });
    expect(classifyConnectorToolSafety({
      name: 'messages.search',
      providerToolId: 'MESSAGES_DELETE_ALL',
      description: 'Search message history.',
    })).toMatchObject({
      sideEffect: 'destructive',
      approval: 'disabled',
    });
  });

  it('ships only explicit Composio authentication and no product-owned curation', () => {
    const definitions = getStaticComposioCatalogDefinitions();

    expect(definitions.length).toBeGreaterThan(100);
    expect(definitions.every((definition) => (
      definition.provider === 'composio'
      && definition.authentication === 'composio'
    ))).toBe(true);
    expect(definitions.flatMap((definition) => definition.tools).every((tool) => tool.curation === undefined)).toBe(true);
    expect(Object.isFrozen(FEATURED_COMPOSIO_CATALOG)).toBe(true);
    expect(Object.isFrozen(FEATURED_COMPOSIO_CATALOG[0]?.tools)).toBe(true);
    expect(Object.isFrozen(DOCUMENTED_COMPOSIO_TOOLKITS)).toBe(true);
  });

  it('applies only caller-supplied curation and returns detached snapshots', () => {
    const first = getStaticComposioCatalogDefinitions({
      curationOverlay: {
        github: {
          github_search_repositories: {
            useCases: ['repository_research'],
            reason: 'Host-selected research workflow.',
          },
        },
      },
    });
    const github = first.find((definition) => definition.id === 'github')!;
    expect(github.tools[0]?.curation).toEqual({
      useCases: ['repository_research'],
      reason: 'Host-selected research workflow.',
    });

    github.name = 'mutated';
    github.allowedToolNames.push('mutated.tool');
    github.tools[0]!.safety.reason = 'mutated';

    const second = getStaticComposioCatalogDefinitions();
    const freshGithub = second.find((definition) => definition.id === 'github')!;
    expect(freshGithub.name).toBe('GitHub');
    expect(freshGithub.allowedToolNames).not.toContain('mutated.tool');
    expect(freshGithub.tools[0]?.safety.reason).not.toBe('mutated');
  });

  it('normalizes metadata lookups and detaches wire details', () => {
    expect(getComposioToolkitMetadata('  github  ')?.category).toBeTruthy();

    const definition = getStaticComposioCatalogDefinitions().find((item) => item.id === 'github')!;
    const detail = connectorDefinitionToDetail(definition);
    detail.allowedToolNames!.push('mutated.tool');
    detail.tools[0]!.safety.reason = 'mutated';

    expect(definition.allowedToolNames).not.toContain('mutated.tool');
    expect(definition.tools[0]?.safety.reason).not.toBe('mutated');
    expect(detail.auth).toEqual({ provider: 'composio', configured: false });

    const schemaLess = defineConnectorTool({
      name: 'example.list',
      title: 'List',
      curation: {
        useCases: ['research'],
        reason: 'Host supplied.',
      },
      requiredScopes: [],
    });
    expect(schemaLess).toMatchObject({
      refreshEligible: false,
      inputSchemaUnsupportedReason: 'connector input schema is missing',
    });
    const { minimumApproval: _definitionMinimumApproval, ...definitionWithoutMinimumApproval } = definition;
    const curatedDetail = connectorDefinitionToDetail({
      ...definitionWithoutMinimumApproval,
      tools: [schemaLess],
      allowedToolNames: [],
    });
    expect(curatedDetail.tools[0]?.curation).toEqual({
      useCases: ['research'],
      reason: 'Host supplied.',
    });

    const optionalDetail = connectorDefinitionToDetail({
      ...definition,
      tools: [
        { ...schemaLess, curation: { useCases: ['research'] } },
        { ...schemaLess, name: 'example.list_reason', curation: { reason: 'Reason only.' } },
      ],
      allowedToolNames: [],
      toolsNextCursor: 'next-page',
      minimumApproval: 'confirm',
    });
    expect(optionalDetail).toMatchObject({
      toolsNextCursor: 'next-page',
      minimumApproval: 'confirm',
      tools: [
        { curation: { useCases: ['research'] } },
        { curation: { reason: 'Reason only.' } },
      ],
    });
  });
});
