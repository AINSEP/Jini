import { describe, expect, it } from 'vitest';
import { toolApprovalPresentation } from '../../surfaces/tool-approval.js';
import { renderDetailList } from '../../surfaces/document.js';

const text = ({ key }: { key: string }) => key;

describe('tool approval presentation', () => {
  it('returns the declared plain-language summary through the translation port', () => {
    const descriptor = { id: 'opaque_internal_id', metadata: {
      title: 'Publish your site', summary: 'This publishes the current site to the selected hosting project.',
    } };
    expect(toolApprovalPresentation({ descriptor }, { text })).toMatchObject({
      title: 'Publish your site?', summary: 'This publishes the current site to the selected hosting project.',
    });
    expect(toolApprovalPresentation({ descriptor }, { text: ({ key }) => key === descriptor.metadata.summary ? 'Translated summary.' : key })).toMatchObject({ summary: 'Translated summary.' });
  });

  it('uses catalog copy without interpolating input or depending on a tool id', () => {
    const descriptor = { id: 'any_tool', metadata: { title: 'Publish static site', actionVerb: 'Publish' } };
    expect(toolApprovalPresentation({ descriptor }, { text })).toEqual({
      title: 'Publish static site?', confirmLabel: 'Publish', labels: {},
    });
  });

  it('humanizes an unannotated tool and keeps the generic confirmation choice', () => {
    expect(toolApprovalPresentation({ descriptor: { id: 'remote.rotateApiKey' } }, { text })).toEqual({
      title: 'Remote rotate API key?', confirmLabel: 'Confirm', labels: {},
    });
  });

  it('uses schema titles, then descriptions, and leaves other labels to the shared renderer', () => {
    const inputSchema = { properties: {
      projectName: { title: 'Site name', description: 'Title takes precedence' },
      target: { description: 'Hosting provider' },
      config: { properties: { branchName: { title: 'Release branch' } } },
      privacyPolicyUrl: { type: 'string' },
    } };
    const { labels } = toolApprovalPresentation({ descriptor: { id: 'publish', inputSchema } }, { text });
    expect(labels).toEqual({ projectName: 'Site name', target: 'Hosting provider', 'config.branchName': 'Release branch' });
    const html = renderDetailList([{ label: 'Input', labels, value: {
      projectName: 'new-site', target: 'host', config: { branchName: 'main' }, privacyPolicyUrl: '/privacy',
    } }]);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect([...doc.querySelectorAll('dt')].map(node => node.textContent)).toEqual([
      'Input', 'Site name', 'Hosting provider', 'Config', 'Release branch', 'Privacy policy URL',
    ]);
  });

  it('uses the host translation port for metadata, question framing and fallback choices', () => {
    const translations: Record<string, string> = {
      'Publish static site': 'Publicar sitio estático', Publish: 'Publicar', '{action}?': '¿{action}?', Confirm: 'Confirmar',
    };
    const translated = ({ key }: { key: string }) => translations[key] ?? key;
    expect(toolApprovalPresentation({ descriptor: { id: 'publish', metadata: { title: 'Publish static site', actionVerb: 'Publish' } } }, { text: translated })).toMatchObject({
      title: '¿Publicar sitio estático?', confirmLabel: 'Publicar',
    });
    expect(toolApprovalPresentation({ descriptor: { id: 'unannotated' } }, { text: translated }).confirmLabel).toBe('Confirmar');
  });

  it('ignores blank copy and malformed schemas, and escapes schema labels at the shared sink', () => {
    const result = toolApprovalPresentation({ descriptor: {
      id: 'remote_action', metadata: { title: ' ', actionVerb: '' },
      inputSchema: { properties: { bad: false, value: { title: '<img src=x>', properties: [] } } },
    } }, { text });
    expect(result).toMatchObject({ title: 'Remote action?', confirmLabel: 'Confirm' });
    expect(renderDetailList([{ label: 'Input', value: { value: 'safe' }, labels: result.labels }])).toContain('&lt;img src=x&gt;');
    expect(toolApprovalPresentation({ descriptor: { id: 'confirm', inputSchema: null } }, { text }).labels).toEqual({});
  });

  it('preserves an existing question mark and literal replacement characters in a catalog title', () => {
    for (const title of ['Continue?', '続行？', 'متابعة؟']) {
      expect(toolApprovalPresentation({ descriptor: { id: 'action', metadata: { title } } }, { text }).title).toBe(title);
    }
    expect(toolApprovalPresentation({ descriptor: { id: 'action', metadata: { title: 'Send $&' } } }, { text }).title).toBe('Send $&?');
  });
});
