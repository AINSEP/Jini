import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
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
  it('keeps short result statuses on one line beside long labels and stacks rows in a narrow card', () => {
    const label = 'GitHub Pages deployment token for the production documentation project';
    const html = renderOutcomeDocument({
      title: 'Copy results', state: 'partial', message: '',
      details: [
        { label, description: 'custom · github', value: 'copied ✓ …3vjN', format: 'status' },
        { label: 'Site assistant', description: 'vendor · openai', value: 'skipped — already there', format: 'status' },
        { label: 'DNS <token>', description: 'custom · <provider>', value: 'not copied — source-missing', format: 'status' },
      ],
    });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = [...doc.querySelectorAll('.mcpui-outcome-row')];
    expect(rows).toHaveLength(3);
    expect(rows[0]?.querySelector('dt')?.firstChild?.textContent).toBe(label);
    expect(rows.map(row => row.querySelector('.mcpui-hint')?.textContent)).toEqual([
      'custom · github', 'vendor · openai', 'custom · <provider>',
    ]);
    expect(rows.map(row => row.querySelector('dd.mcpui-detail-status')?.textContent)).toEqual([
      'copied ✓ …3vjN', 'skipped — already there', 'not copied — source-missing',
    ]);
    expect(rows[2]?.querySelector('dt')?.firstChild?.textContent).toBe('DNS <token>');
    expect(doc.querySelector('provider, token')).toBeNull();
    const css = doc.querySelector('style')!.textContent!;
    expect(css).toMatch(/\.mcpui-outcome-row dt \{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere;/);
    expect(rows.map(row => row.querySelector('dd.mcpui-detail-status')?.getAttribute('title'))).toEqual([
      'copied ✓ …3vjN', 'skipped — already there', 'not copied — source-missing',
    ]);
    expect(css).toMatch(/\.mcpui-outcome-row dd\.mcpui-detail-status \{[^}]*flex: 0 1 auto;[^}]*max-width: 60%;[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/);
    expect(css).toMatch(/@media \(max-width: 352px\) \{\s*\.mcpui-outcome-row \{[^}]*flex-direction: column;[^}]*\}\s*\.mcpui-outcome-row dd\.mcpui-detail-status \{[^}]*white-space: normal;/);
  });

  it('renders a plain outcome detail as a row with no status styling or hint', () => {
    const html = renderOutcomeDocument({ title: 'Done', state: 'success', message: '', details: [{ label: 'Target', value: 'github-pages' }] });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('dl')?.className).toBe('mcpui-details mcpui-details-outcome');
    expect(doc.querySelector('.mcpui-outcome-row dd')?.className).toBe('');
    expect(doc.querySelector('.mcpui-outcome-row dd')?.textContent).toBe('github-pages');
    expect(doc.querySelector('.mcpui-outcome-row .mcpui-hint')).toBeNull();
  });

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
    const resource = buildOutcomeSurface({ ...PUBLISH_SUCCESS, uri: 'ui://consumer/deployment-execute-static-publish/exchange-1' });
    expect(resource.type).toBe('resource');
    expect(resource.resource.uri).toBe('ui://consumer/deployment-execute-static-publish/exchange-1');
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

describe('buildOutcomeSurface frame size', () => {
  it('carries no preferred frame size when none is asked for', () => {
    const resource = buildOutcomeSurface({ ...PUBLISH_FAILURE, uri: 'ui://example-host/x/3' });
    expect(resource.resource._meta?.[MCP_UI_PREFERRED_FRAME_SIZE_META_KEY]).toBeUndefined();
  });
});

// Exact-output pins: sha256 of whole documents captured on the pre-refactor code, so any byte of
// markup, script or framing that changes in a refactor fails here.
describe('renderOutcomeDocument exact output', () => {
  const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const cases: ReadonlyArray<readonly [string, Parameters<typeof renderOutcomeDocument>[0], string]> = [
    ['success with link and details', PUBLISH_SUCCESS, '688dde39abe77aa8c1fcaa8430f8da46119461c38459c47553dae334f0ae9a58'],
    ['partial with custom link label, app, lang and tokens', { ...PUBLISH_SUCCESS, state: 'partial', openLinkLabel: 'View', app: { appName: 'a', appVersion: '2' }, lang: 'fr', tokens: { '--jini-mcpui-bg': '#123456' } }, '73fb126bfebf3105037bd0111928e38706278c246e6e61e3746de17c6f82d5eb'],
    ['failure with link', { ...PUBLISH_FAILURE, openLinkUrl: 'https://x.test/"</script>' }, 'cd02c8d5b6c02042da614c39ca30f8433b80f34da3faecfb16bdb991e23ea88b'],
    ['failure without link', PUBLISH_FAILURE, '4289fca764208847cd4888d91bc93b7d3267511d5c1c5daf502194128270b672'],
  ];
  it.each(cases)('%s', (_name, spec, expected) => {
    expect(digest(renderOutcomeDocument(spec))).toBe(expected);
  });

  it('pins the framed resource wrapper', () => {
    expect(digest(buildOutcomeSurface({ ...PUBLISH_SUCCESS, uri: 'ui://h/x/1', preferredFrameSize: ['1px', '2px'] }))).toBe('38c59e246fda02435f2c78af15187036773c70d3a32fbe53a3832231a002cd9a');
  });
});
