import { describe, expect, it } from 'vitest';
import { buildOutcomeSurface, renderOutcomeDocument } from '../../surfaces/outcome.js';
import { MCP_UI_ACTION_PLAN_META_KEY, MCP_UI_PREFERRED_FRAME_SIZE_META_KEY } from '../../resource.js';
import { mountSurface } from './mount-surface.js';

const PUBLISH_SUCCESS = {
  title: 'Site published',
  description: 'The current site content was exported and published to github-pages.',
  details: [
    { label: 'Target', value: 'github-pages' },
    { label: 'Repository', value: 'octo/my-site' },
  ],
  state: 'success' as const,
  message: 'Published live at https://octo.github.io/my-site/.',
  openLinkUrl: 'https://octo.github.io/my-site/',
};

const PUBLISH_FAILURE = {
  title: 'Publish failed',
  state: 'failure' as const,
  message: 'GitHub rejected this credential (HTTP 401) — it is invalid, expired, or missing the required permissions.',
};

describe('renderOutcomeDocument', () => {
  it('renders the true outcome directly, with no click required to see it', () => {
    const { doc } = mountSurface(renderOutcomeDocument(PUBLISH_SUCCESS));
    expect(doc.querySelector('h1')?.textContent).toBe('Site published');
    expect(doc.querySelector('.mcpui-description')?.textContent).toContain('published to github-pages');
    expect([...doc.querySelectorAll('dd')].map((node) => node.textContent)).toEqual(['github-pages', 'octo/my-site']);
    const status = doc.getElementById('mcpui-status');
    expect(status?.textContent).toBe('Published live at https://octo.github.io/my-site/.');
    expect(status?.getAttribute('data-state')).toBe('done');
  });

  it('renders a failure with data-state "failed", distinctly from a success', () => {
    const { doc } = mountSurface(renderOutcomeDocument(PUBLISH_FAILURE));
    expect(doc.getElementById('mcpui-status')?.getAttribute('data-state')).toBe('failed');
    expect(doc.getElementById('mcpui-status')?.textContent).toContain('GitHub rejected this credential');
  });

  it('renders a partial outcome with its OWN data-state "partial" — never collapsed into success or failure', () => {
    const { doc } = mountSurface(
      renderOutcomeDocument({ title: 'Uploaded, not yet reachable', state: 'partial', message: 'The files uploaded, but the site is not confirmed reachable yet.' }),
    );
    const status = doc.getElementById('mcpui-status');
    expect(status?.getAttribute('data-state')).toBe('partial');
    expect(status?.getAttribute('data-state')).not.toBe('done');
    expect(status?.getAttribute('data-state')).not.toBe('failed');
  });

  it('renders no action buttons and no details/description when none are given — a minimal failure result', () => {
    const { doc } = mountSurface(renderOutcomeDocument(PUBLISH_FAILURE));
    expect(doc.querySelectorAll('button[data-mcpui-action]')).toHaveLength(0);
    expect(doc.querySelector('.mcpui-description')).toBeNull();
    expect(doc.querySelector('.mcpui-details')).toBeNull();
  });

  it('an openLinkUrl renders one button that calls the bridge openLink with that exact URL, never a tool call', () => {
    const surface = mountSurface(renderOutcomeDocument(PUBLISH_SUCCESS));
    expect(surface.doc.querySelectorAll('button[data-mcpui-action]')).toHaveLength(1);
    surface.click('open-link');
    expect(surface.api.openLink).toHaveBeenCalledWith('https://octo.github.io/my-site/');
    expect(surface.api.callTool).not.toHaveBeenCalled();
  });

  it('the open-link button is styled primary on success and neutral on failure', () => {
    const success = mountSurface(renderOutcomeDocument(PUBLISH_SUCCESS));
    expect(success.button('open-link').className).toContain('mcpui-button-primary');

    const failureWithLink = mountSurface(renderOutcomeDocument({ ...PUBLISH_FAILURE, openLinkUrl: 'https://example.test/partial' }));
    expect(failureWithLink.button('open-link').className).not.toContain('mcpui-button-primary');
  });

  it('a custom openLinkLabel overrides the default "Open site" wording', () => {
    const { doc } = mountSurface(renderOutcomeDocument({ ...PUBLISH_SUCCESS, openLinkLabel: 'View live site' }));
    expect(doc.querySelector('button[data-mcpui-action="open-link"]')?.textContent).toBe('View live site');
  });

  it('reports the app identity and token overrides through to the document', () => {
    const html = renderOutcomeDocument({ ...PUBLISH_SUCCESS, app: { appName: 'host-publish-outcome', appVersion: '2' }, tokens: { '--jini-mcpui-accent': '#123456' } });
    expect(html).toContain('"host-publish-outcome"');
    expect(html).toContain('--jini-mcpui-accent: #123456;');
  });
});

describe('buildOutcomeSurface', () => {
  it('wraps the document in a ui:// EmbeddedResource at the SAME URI a caller supplies', () => {
    const resource = buildOutcomeSurface({ ...PUBLISH_SUCCESS, uri: 'ui://tovu/deployment-execute-static-publish/exchange-1' });
    expect(resource.type).toBe('resource');
    expect(resource.resource.uri).toBe('ui://tovu/deployment-execute-static-publish/exchange-1');
    expect(resource.resource.mimeType).toBe('text/html;profile=mcp-app');
    expect(resource.resource.text).toContain('<h1 class="mcpui-title">Site published</h1>');
  });

  it('carries NO action plan — unlike a confirmation, a result has nothing pending to mirror', () => {
    const resource = buildOutcomeSurface({ ...PUBLISH_SUCCESS, uri: 'ui://example-host/x/1' });
    expect(resource.resource._meta?.[MCP_UI_ACTION_PLAN_META_KEY]).toBeUndefined();
  });

  it('still carries a preferred frame size when one is asked for', () => {
    const resource = buildOutcomeSurface({ ...PUBLISH_FAILURE, uri: 'ui://example-host/x/2', preferredFrameSize: ['100%', '240px'] });
    expect(resource.resource._meta?.[MCP_UI_PREFERRED_FRAME_SIZE_META_KEY]).toEqual(['100%', '240px']);
  });
});
