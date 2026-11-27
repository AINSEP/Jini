import { describe, expect, it } from 'vitest';
import { approvalText } from '@jini-ai/core/contracts/site/approval-i18n';
import { toolApprovalConfirmation, toolApprovalPresentation } from '../../surfaces/tool-approval.js';
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

  it('labels fields by schema title or humanized key, never by the model-facing description', () => {
    const inputSchema = { properties: {
      projectName: { title: 'Site name', description: 'Title takes precedence' },
      target: { description: 'Which hosting provider to publish to: call get_capabilities first; a host listed with supported: false is refused.' },
      config: { properties: { branchName: { title: 'Release branch' } } },
      privacyPolicyUrl: { type: 'string' },
    } };
    const { labels } = toolApprovalPresentation({ descriptor: { id: 'publish', inputSchema } }, { text });
    expect(labels).toEqual({ projectName: 'Site name', 'config.branchName': 'Release branch' });
    const html = renderDetailList({ details: [{ label: 'Input', labels, value: {
      projectName: 'new-site', target: 'host', config: { branchName: 'main' }, privacyPolicyUrl: '/privacy',
    } }] });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect([...doc.querySelectorAll('dt')].map(node => node.textContent)).toEqual([
      'Input', 'Site name', 'Target', 'Config', 'Release branch', 'Privacy policy URL',
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
    expect(renderDetailList({ details: [{ label: 'Input', value: { value: 'safe' }, labels: result.labels }] })).toContain('&lt;img src=x&gt;');
    expect(toolApprovalPresentation({ descriptor: { id: 'confirm', inputSchema: null } }, { text }).labels).toEqual({});
  });

  it('preserves an existing question mark and literal replacement characters in a catalog title', () => {
    for (const title of ['Continue?', '続行？', 'متابعة؟']) {
      expect(toolApprovalPresentation({ descriptor: { id: 'action', metadata: { title } } }, { text }).title).toBe(title);
    }
    expect(toolApprovalPresentation({ descriptor: { id: 'action', metadata: { title: 'Send $&' } } }, { text }).title).toBe('Send $&?');
  });
});

describe('tool approval confirmation', () => {
  const descriptor = {
    id: 'site.publish',
    metadata: { title: 'Publish static site', summary: 'Ships the site.', actionVerb: 'Publish' },
    inputSchema: { type: 'object', properties: { target: { type: 'string', title: 'Hosting project' } } },
  };

  it('builds the operator-language confirm spec with the input disclosed under its technical name', () => {
    const details = [{ label: 'Site', value: 'Docs' }];
    expect(toolApprovalConfirmation({ descriptor, input: { target: 'prod' }, locale: 'en', details, danger: true })).toEqual({
      toolId: 'site.publish',
      errorCode: 'TOOL_APPROVAL',
      title: 'Publish static site?',
      description: 'Ships the site.',
      details,
      danger: true,
      detailDisclosure: {
        label: approvalText({ locale: 'en', key: 'Details' }),
        details: [{
          label: 'Input', value: { target: 'prod' }, labels: { target: 'Hosting project' },
          description: 'Technical name: site.publish',
        }],
      },
      confirmLabel: 'Publish',
      cancelLabel: 'Cancel',
    });
  });

  it('defaults to no extra details, not dangerous, an empty input object, and no description without a summary', () => {
    const spec = toolApprovalConfirmation({ descriptor: { id: 'plain_tool' }, input: undefined, locale: 'en' });
    expect(spec).not.toHaveProperty('description');
    expect(spec).toMatchObject({ details: [], danger: false, confirmLabel: 'Confirm', title: 'Plain tool?' });
    expect(spec.detailDisclosure?.details[0]?.value).toEqual({});
    expect(toolApprovalConfirmation({ descriptor: { id: 'plain_tool' }, input: null, locale: 'en' }).detailDisclosure?.details[0]?.value).toEqual({});
  });

  it('translates every chrome string through the requested locale', () => {
    const spec = toolApprovalConfirmation({ descriptor, input: {}, locale: 'de' });
    expect(spec.title).toBe('Statische Website veröffentlichen?');
    expect(spec.confirmLabel).toBe('Veröffentlichen');
    expect(spec.cancelLabel).toBe(approvalText({ locale: 'de', key: 'Cancel' }));
    expect(spec.cancelLabel).not.toBe('Cancel');
    expect(spec.detailDisclosure?.details[0]).toMatchObject({
      label: approvalText({ locale: 'de', key: 'Input' }),
      description: 'Technischer Name: site.publish',
    });
  });
});
