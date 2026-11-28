import { describe, expect, it, vi } from 'vitest';
import { resolvePageNavigation, validatePageLink, type AgentNavigationScreen } from '../page-navigation.js';

const plugins: AgentNavigationScreen = {
  id: 'plugins', label: 'Agent Plugins', description: 'Manage agent plugins.', path: '/addons/agent-plugins',
  routeTemplates: ['/addons/agent-plugins'], allowedQueryParams: { tab: ['installed', 'downloaded'] },
  entityTargets: [{ type: 'agent-plugin', routeTemplate: '/addons/agent-plugins' }],
};
const pages: AgentNavigationScreen = { ...plugins, id: 'pages', path: '/pages', routeTemplates: ['/pages', '/pages/:slug'], allowedQueryParams: {}, entityTargets: [{ type: 'page', routeTemplate: '/pages/:slug' }] };

describe('published navigation targets', () => {
  it('resolves plugin tab and returns discovery instructions without clicking or fabricating a handle', async () => {
    const lookupEntity = vi.fn(async () => ({ params: {}, query: { tab: 'installed' }, control: { query: 'ui-ux-design', role: 'button' as const, intent: 'details' } }));
    expect(await resolvePageNavigation({ screen: plugins, input: { entity: { type: 'agent-plugin', id: 'ui-ux-design' } } }, { lookupEntity }))
      .toEqual({ path: '/addons/agent-plugins?tab=installed', nextAction: { query: 'ui-ux-design', role: 'button', intent: 'details' } });
    expect(lookupEntity).toHaveBeenCalledWith({ page: 'plugins', type: 'agent-plugin', id: 'ui-ux-design' });
  });
  it('encodes a resolved page slug as a single route segment', async () => {
    expect(await resolvePageNavigation({ screen: pages, input: { entity: { type: 'page', id: 'id' } } }, { lookupEntity: async () => ({ params: { slug: 'hello / 世界?#' } }) }))
      .toEqual({ path: '/pages/hello%20%2F%20%E4%B8%96%E7%95%8C%3F%23' });
  });
  it('refuses missing entities, foreign entity types and unpublished templates', async () => {
    const lookupEntity = vi.fn(async () => null);
    await expect(resolvePageNavigation({ screen: pages, input: { entity: { type: 'page', id: 'absent' } } }, { lookupEntity })).rejects.toThrow('not found');
    lookupEntity.mockClear();
    await expect(resolvePageNavigation({ screen: pages, input: { entity: { type: 'agent-plugin', id: 'x' } } }, { lookupEntity })).rejects.toThrow('not a published');
    expect(lookupEntity).not.toHaveBeenCalled();
    await expect(resolvePageNavigation({ screen: { ...pages, entityTargets: [{ type: 'page', routeTemplate: '//evil' }] }, input: { entity: { type: 'page', id: 'x' } } }, { lookupEntity })).rejects.toThrow('not a published');
  });
  it.each(['.', '..'])('refuses a dot segment %s from an entity lookup', async slug => {
    await expect(resolvePageNavigation({ screen: pages, input: { entity: { type: 'page', id: 'id' } } }, { lookupEntity: async () => ({ params: { slug } }) })).rejects.toThrow('invalid route parameter');
  });
  it('resolves a navigation with no entity to the screen path, keeping its declared query and adding only allowed query state', async () => {
    const lookupEntity = vi.fn(async () => null);
    expect(await resolvePageNavigation({ screen: plugins, input: { query: { tab: 'downloaded' } } }, { lookupEntity })).toEqual({ path: '/addons/agent-plugins?tab=downloaded' });
    expect(await resolvePageNavigation({ screen: { ...plugins, path: '/addons/agent-plugins?tab=installed' }, input: {} })).toEqual({ path: '/addons/agent-plugins?tab=installed' });
    expect(lookupEntity).not.toHaveBeenCalled();
  });
  it('refuses an entity navigation when the host gave no entity lookup', async () => {
    await expect(resolvePageNavigation({ screen: pages, input: { entity: { type: 'page', id: 'id' } } })).rejects.toThrow(new Error('Entity lookup is unavailable'));
  });
  it('refuses a published entity route template that is not a single-origin path', async () => {
    const lookupEntity = vi.fn(async () => ({ params: { slug: 'home' } }));
    for (const routeTemplate of ['//evil/:slug', 'pages/:slug', '/pages/:slug?x=1']) {
      const screen = { ...pages, routeTemplates: [routeTemplate], entityTargets: [{ type: 'page', routeTemplate }] };
      await expect(resolvePageNavigation({ screen, input: { entity: { type: 'page', id: 'id' } } }, { lookupEntity })).rejects.toThrow(new Error('Invalid published route template'));
    }
  });
  it.each([
    ['a parameter the lookup did not return', '/pages/:slug'],
    ['a parameter named like an inherited object key', '/pages/:constructor'],
  ])('refuses %s', async (_case, routeTemplate) => {
    const screen = { ...pages, routeTemplates: [routeTemplate], entityTargets: [{ type: 'page', routeTemplate }] };
    const name = routeTemplate.split(':')[1];
    await expect(resolvePageNavigation({ screen, input: { entity: { type: 'page', id: 'id' } } }, { lookupEntity: async () => ({ params: {} }) }))
      .rejects.toThrow(new Error(`Missing or invalid route parameter "${name}"`));
  });
  it('refuses arbitrary link destinations and query state', () => {
    for (const path of ['https://evil.test', '../pages', 'pages?tab=other', 'made-up', 'constructor']) expect(() => validatePageLink({ screens: [pages], path })).toThrow('Not a published admin screen');
    expect(() => validatePageLink({ screens: [pages], path: 'pages', query: { next: '//evil' } })).toThrow('not allowed');
    expect(() => validatePageLink({ screens: [plugins], path: 'plugins', query: { tab: 'evil' } })).toThrow('Invalid value');
  });
  it.each(['', '   ', '/', '///', ' /// '])('refuses an empty or slash-only link %j even when the dashboard is published', path => {
    const dashboard = { ...pages, id: 'dashboard', path: '/', routeTemplates: ['/'] };
    expect(() => validatePageLink({ screens: [dashboard, pages], path })).toThrow('Path must name');
    expect(validatePageLink({ screens: [dashboard], path: 'dashboard' })).toBe('/');
  });
});
