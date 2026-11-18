import { expect, it } from 'vitest';
import { createOverlayController } from '../../../react/overlays.js';
import { forms } from '../../../forms/react/index.js';
import { seo } from '../../../seo/react/index.js';
import { redirects } from '../../../redirects/react/index.js';
import { media } from '../../../media/react/index.js';
import { widgets } from '../../../widgets/react/index.js';
import { comments } from '../../../comments/react/index.js';
import { agentPlugins } from '../../../agent-plugins/react/index.js';
import { sourceControl } from '../../../source-control/react/index.js';
import { widgetTypes, defaultConfig } from '../../../widgets/react/__tests__/fixtures/catalog.js';

// J4 React half (owner 2026-11-17: inject, do not import): the domain factories receive the React
// helpers from the host. This pins what each factory's binding exposes, so the injection cannot
// change a page id, a tab id, the bound module or the Provider the host mounts.
const cases = [
  { name: 'forms', create: () => forms({}), expected: { module: 'forms', bindsReturnedObject: false, pages: ['editor: fields,submissions', 'list: '] } },
  { name: 'seo', create: () => seo({ siteUrl: () => 'https://site.test' }), expected: { module: 'seo', bindsReturnedObject: false, pages: ['settings: defaults,entries,sitemap'] } },
  { name: 'redirects', create: () => redirects({}), expected: { module: 'redirects', bindsReturnedObject: false, pages: ['list: '] } },
  { name: 'media', create: () => media({ overlays: createOverlayController({}) }), expected: { module: 'media', bindsReturnedObject: true, pages: ['library: all,external-providers,images,videos'] } },
  { name: 'widgets', create: () => widgets({ slots: { ConfigFields: () => null, AddControl: () => null }, widgetTypes, defaultConfig }), expected: { module: 'widgets', bindsReturnedObject: true, pages: ['editor: ', 'library: ', 'region: ', 'regions: '] } },
  { name: 'comments', create: () => comments({}), expected: { module: 'comments', bindsReturnedObject: true, pages: ['queue: '] } },
  { name: 'agentPlugins', create: () => agentPlugins({}), expected: { module: 'agent-plugins', bindsReturnedObject: true, pages: ['agentPlugins: downloaded,installed,marketplace'] } },
  { name: 'sourceControl', create: () => sourceControl({}), expected: { module: 'source-control', bindsReturnedObject: true, pages: ['sourceControl: providers'] } },
];

function shape(feature: ReturnType<(typeof cases)[number]['create']>) {
  return {
    module: feature.react.module.id,
    bindsReturnedObject: feature.react.module === feature,
    pages: Object.entries(feature.react.pages).map(([id, view]) => `${id}: ${Object.keys(view.tabs).sort().join(',')}`).sort(),
  };
}

it.each(cases)('$name binds the same pages, tabs and module', ({ create, expected }) => {
  const feature = create();
  expect(shape(feature)).toEqual(expected);
  expect(feature.react.Provider).toBeTypeOf('function');
});
