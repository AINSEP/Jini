import { describe, expect, it } from 'vitest';
import { parseFragment } from 'parse5';
import { embedMarkerSnippetFromConfig, scanEmbedMarkers } from '../markers/marker.js';
import { scanHtmlEmbeds, substituteHtmlEmbeds } from '../html/html-embeds.js';
import {
  fillPluginExportTemplate, resolvePluginExportEmbeds,
  type PluginExportRender, type PluginExportTemplate, type PluginExportsPort,
} from '../html/plugin-export.js';

const config = { type: 'plugin', plugin: 'example/login', component: 'button', version: 1, props: {} };
const snippet = (props: Record<string, unknown> = {}) => embedMarkerSnippetFromConfig({ config: { ...config, props } });
const definition: PluginExportTemplate = {
  plugin: 'example/login', component: 'button', version: 2, minVersion: 1, consent: 'necessary',
  template: '<a class="plugin-login-button" href="{{host.start}}"><span>{{props.label}}</span></a>',
  props: { label: 'Continue' }, host: { start: '/api/member/start' },
};
const rendered: PluginExportRender = {
  plugin: 'example/login', component: 'button', version: 1, consent: 'necessary',
  html: '<a class="plugin-login-button" href="/api/member/start"><span>Continue</span></a>',
};

function resolve(html: string, port?: PluginExportsPort) {
  return resolvePluginExportEmbeds({ refs: scanHtmlEmbeds({ html }), workspaceId: 'site-a', ...(port ? { port } : {}) });
}

describe('plugin marker serialization and substitution', () => {
  it('round trips apostrophes, ampersands, closing tags and future fields', () => {
    const complete = { ...config, props: { label: "Owner's & </div> {{host.secret}}" }, future: { enabled: true } };
    const html = embedMarkerSnippetFromConfig({ config: complete });
    expect(scanEmbedMarkers({ html }).markers[0]?.config).toEqual(complete);
    // Check the browser parser too: closing-tag text in an attribute cannot truncate the marker.
    const root = parseFragment(html);
    const node = root.childNodes[0];
    if (!node || !('attrs' in node)) throw new Error('missing marker element');
    expect(JSON.parse(node.attrs[0]!.value)).toEqual(complete);
  });

  it('keys every occurrence independently even with the same authored id', () => {
    const html = embedMarkerSnippetFromConfig({ config: { ...config, id: 'same' } });
    expect(scanHtmlEmbeds({ html: html + html }).map(ref => ref.id)).toEqual(['plugin:1', 'plugin:2']);
  });

  it.each([undefined, '', '<b>generic placeholder</b>'])('keeps wrapper and fallback for unresolved output %s', output => {
    const html = `<aside class="theme" style="color:red" aria-label="Sign in" data-embed-config='${JSON.stringify(config)}'><b>Try later</b></aside>`;
    expect(substituteHtmlEmbeds({ html, resolve: () => output })).toBe('<aside class="theme" style="color:red" aria-label="Sign in"><b>Try later</b></aside>');
  });

  it('keeps author hooks and overwrites all author-typed stamps with canonical values', () => {
    const html = `<section id="signin" class="theme" style="color:red" aria-label="Login" DATA-PLUGIN="wrong" data-component="wrong" data-embed-v="99" data-consent-category="marketing" data-embed-config='${JSON.stringify(config)}'>fallback</section>`;
    expect(substituteHtmlEmbeds({ html, resolve: () => rendered })).toBe('<section id="signin" class="theme" style="color:red" aria-label="Login" data-plugin="example/login" data-component="button" data-embed-v="1" data-consent-category="necessary">' + rendered.html + '</section>');
  });

  it('always keeps even a bare wrapper on success', () => {
    expect(substituteHtmlEmbeds({ html: snippet(), resolve: () => rendered })).toBe('<div data-plugin="example/login" data-component="button" data-embed-v="1" data-consent-category="necessary">' + rendered.html + '</div>');
  });

  it('keeps existing widget, media, and content output byte-identical', () => {
    const html = `<div data-embed-config='{"type":"widget","id":"w"}'></div><figure class="photo" data-embed-config='{"type":"media","id":"m"}'></figure><main data-embed-config='{"type":"content","id":"c"}'></main>`;
    const outputs: Record<string, string> = { widget: '<b>Widget</b>', media: '<img src="/photo.png">', content: '<p>Body</p>' };
    expect(substituteHtmlEmbeds({ html, resolve: ref => outputs[ref.type] })).toBe('<b>Widget</b><figure class="photo"><img src="/photo.png"></figure><main><p>Body</p></main>');
  });
});

describe('plugin export template policy', () => {
  it.each(['/some/path', 'https://example.com/path', '//example.com/path', 'javascript:alert(1)'])('refuses literal URL %s in every supported URL attribute', value => {
    for (const template of [`<a href="${value}">Link</a>`, `<img src="${value}" alt="">`, `<form action="${value}"></form>`]) {
      expect(() => fillPluginExportTemplate({ definition: { ...definition, template } })).toThrow();
    }
  });

  it.each([
    '<a HREF="&#47;some/path">Link</a>', '<a href=/some/path>Link</a>', '<a href="">Link</a>',
    '<a href="/prefix{{host.start}}">Link</a>', '<a href="{{host.start}}/suffix">Link</a>',
    '<a href="{{host.start}}{{host.start}}">Link</a>', '<a href="{{host.links.start}}">Link</a>',
    '<img src="{{host.assets.mark}}?literal=1" alt="">',
  ])('requires one complete declared host URL slot: %s', template => {
    expect(() => fillPluginExportTemplate({ definition: { ...definition, template } }))
      .toThrow('plugin export URL must be a whole hostLinks or assets slot');
  });

  it.each([
    ['<a href="{{host.signIn}}">Link</a>', '<a href="/member/sign-in">Link</a>'],
    ['<img src="{{host.assets.mark}}" alt="">', '<img src="/plugin-assets/mark.png" alt="">'],
  ])('accepts the host-resolved URL slot in %s', (template, expected) => {
    expect(fillPluginExportTemplate({ definition: { ...definition, template,
      host: { signIn: '/member/sign-in', assets: { mark: '/plugin-assets/mark.png' } },
    } })).toBe(expected);
  });

  it.each([
    '<img srcset="/image.png 1x" alt="">', '<button formaction="/submit">Submit</button>',
    '<div poster="/poster.png"></div>', '<a xlink:href="/link">Link</a>',
    '<span style="background:url(/image.png)">Image</span>',
  ])('retains the fragment policy refusal for unsupported URL sinks: %s', template => {
    expect(() => fillPluginExportTemplate({ definition: { ...definition, template } })).toThrow();
  });

  it('escapes text and attributes without interpreting values as template source', () => {
    const label = `Owner's " & </span><script>x</script> {{host.secret}}`;
    const html = fillPluginExportTemplate({ definition: { ...definition, template: '<span title="{{props.label}}">{{props.label}}</span>', props: { label } } });
    const node = parseFragment(html).childNodes[0];
    if (!node || !('attrs' in node)) throw new Error('missing span');
    expect(node.attrs[0]?.value).toBe(label);
    expect(node.childNodes).toEqual([expect.objectContaining({ nodeName: '#text', value: label })]);
    // Attribute text needs no tag escaping; the text-node copy must serialize as inert entities.
    expect(html).toContain('&lt;/span&gt;&lt;script&gt;');
  });

  it.each(['javascript:alert(1)', '//evil.example/start', 'https://evil.example/start', '/\\evil.example', '/path\nnext'])('refuses host URL %s', start => {
    expect(() => fillPluginExportTemplate({ definition: { ...definition, host: { start } } })).toThrow();
  });

  it.each([
    '<script>x</script>', '<span style="color:red">x</span>', '<span onclick="x">x</span>',
    '<span data-embed-config="x">x</span>', '<span data-page-region="x">x</span>',
    '<a href="{{props.url}}">x</a>', '<span title={{props.label}}>x</span>',
    '<span>{{props.missing}}</span>', '<span>{{props.__proto__.x}}</span>',
    '<span>{{include template}}</span>', '<!-- {{props.label}} -->',
  ])('refuses unsupported template %s', template => {
    expect(() => fillPluginExportTemplate({ definition: { ...definition, template, props: { label: 'hi', url: '/safe' } } })).toThrow();
  });

  it('uses the existing fragment byte cap', () => {
    expect(() => fillPluginExportTemplate({ definition: { ...definition, template: '<span>{{props.label}}</span>', props: { label: 'x'.repeat(65536) } } })).toThrow('size cap');
  });
});

describe('plugin export occurrence resolution', () => {
  it.each(['/some/path', 'https://example.com/path', '//example.com/path', 'javascript:alert(1)'])('keeps authored fallback for literal URL %s and still renders the next occurrence', async value => {
    const html = snippet().replace('></div>', '><b>Author fallback</b></div>') + snippet();
    let calls = 0;
    const result = await resolve(html, { resolve: async () => calls++ === 0
      ? { ...definition, template: `<a href="${value}">Refused link</a>` } : definition });
    expect([...result.keys()]).toEqual(['plugin:2']);
    expect(substituteHtmlEmbeds({ html, resolve: ref => result.get(ref.id!)?.props as unknown as PluginExportRender | undefined }))
      .toBe('<div><b>Author fallback</b></div><div data-plugin="example/login" data-component="button" data-embed-v="1" data-consent-category="necessary">' + rendered.html + '</div>');
  });

  it('does not require a port and never emits a placeholder IR', async () => {
    expect([...await resolve(snippet())]).toEqual([]);
  });

  it('renders different props per occurrence and carries canonical metadata into substitution', async () => {
    const html = snippet({ label: 'One' }) + snippet({ label: 'Two' });
    const result = await resolve(html, { resolve: async ({ config: marker, workspaceId }) => {
      expect(workspaceId).toBe('site-a');
      return { ...definition, props: marker.props as Record<string, unknown> };
    } });
    expect(result.get('plugin:1')?.props.html).toContain('<span>One</span>');
    expect(result.get('plugin:2')?.props.html).toContain('<span>Two</span>');
    const output = substituteHtmlEmbeds({ html, resolve: ref => result.get(ref.id!)?.props as unknown as PluginExportRender | undefined });
    expect(output).toContain('<span>One</span>');
    expect(output).toContain('<span>Two</span>');
    expect(output).not.toContain('data-embed-config');
  });

  it.each([undefined, 1, 2, 0, 3, -1, 1.5, '1', null])('applies the declared version range to %s', async version => {
    const marker = { ...config, version };
    const result = await resolve(embedMarkerSnippetFromConfig({ config: marker }), { resolve: async () => definition });
    const accepted = version === undefined || version === 1 || version === 2;
    expect(result.size).toBe(accepted ? 1 : 0);
    if (accepted) expect(result.get('plugin:1')?.props.version).toBe(version ?? 1);
  });

  it('refuses retired marker contracts', async () => {
    const result = await resolve(snippet(), { resolve: async () => ({ ...definition, minVersion: 2 }) });
    expect(result.size).toBe(0);
  });

  it.each(['unavailable', 'schema failure', 'unsafe fragment'])('falls back on %s while preserving the next occurrence', async reason => {
    let calls = 0;
    const result = await resolve(snippet() + snippet(), { resolve: async () => {
      if (calls++ > 0) return definition;
      if (reason === 'unavailable') return undefined;
      if (reason === 'schema failure') throw new Error('invalid props');
      return { ...definition, template: '<iframe></iframe>' };
    } });
    expect([...result.keys()]).toEqual(['plugin:2']);
  });
});
