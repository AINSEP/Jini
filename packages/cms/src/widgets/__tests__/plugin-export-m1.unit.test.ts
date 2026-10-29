import { expect, it } from 'vitest';
import { fillPluginExportTemplate, resolvePluginExportEmbeds, type PluginExportTemplate } from '../html/plugin-export.js';
import { embedMarkerSnippetFromConfig } from '../markers/marker.js';
import { scanHtmlEmbeds } from '../html/html-embeds.js';

const definition: PluginExportTemplate = { plugin: 'example/button', component: 'button', version: 1,
  consent: 'necessary', template: '<span>{{props.label}}</span>', props: { label: 'Ready' } };

it.each([null, 7, false])('refuses to traverse a non-object slot value %s', value => {
  expect(() => fillPluginExportTemplate({ definition: { ...definition, props: { nested: value },
    template: '<span>{{props.nested.label}}</span>' } })).toThrow('unknown plugin export slot');
});

it('refuses an absent host slot without leaking the template', () => {
  expect(() => fillPluginExportTemplate({ definition: { ...definition, template: '<a href="{{host.start}}">Ready</a>' } }))
    .toThrow('unknown plugin export slot');
});

it('retains literal attributes on formatting nodes reconstructed by HTML error recovery', () => {
  expect(fillPluginExportTemplate({ definition: { ...definition,
    template: '<b title="kept"><p>inside</b>after</p>',
  } })).toBe('<b title="kept"></b><p><b title="kept">inside</b>after</p>');
});

it('retains filled quoted attributes when HTML recovery shares them with a reconstructed node', () => {
  expect(fillPluginExportTemplate({ definition: { ...definition,
    template: '<b title="{{props.label}}"><p>inside</b>after</p>',
  } })).toBe('<b title="Ready"></b><p><b title="Ready">inside</b>after</p>');
});

it('defaults the minimum version to one and isolates refs without identity or configuration', async () => {
  const refs = scanHtmlEmbeds({ html: embedMarkerSnippetFromConfig({ config: { type: 'plugin', plugin: 'example/button', component: 'button' } }) });
  const result = await resolvePluginExportEmbeds({ refs: [{ ...refs[0]!, id: null }, ...refs], workspaceId: 'site',
    port: { resolve: async () => definition } });
  expect([...result]).toEqual([['plugin:1', { componentId: 'plugin-export', props: {
    html: '<span>Ready</span>', plugin: 'example/button', component: 'button', version: 1, consent: 'necessary',
  } }]]);
});
