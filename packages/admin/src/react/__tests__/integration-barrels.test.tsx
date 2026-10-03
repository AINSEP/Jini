import { expect, it } from 'vitest';
import * as react from '../index.js';
import * as entities from '../entities/index.js';
import * as shell from '../shell/index.js';
import * as browser from '../../browser/index.js';
import { createAdminShellNavigation } from '../../browser/shell-navigation.js';

it('exposes the shell and entity APIs through the existing React entry', () => {
  expect(react.AdminShell).toBe(shell.AdminShell);
  expect(react.resolveAdminShellModel).toBe(shell.resolveAdminShellModel);
  expect(react.useAdminShellSession).toBe(shell.useAdminShellSession);
  for (const name of ['EntityIndex', 'EntityList', 'EntityDetail', 'EntityEdit', 'createEntityPanel', 'createEntityRoutes', 'invalidDraftFields'] as const) {
    expect(react[name]).toBe(entities[name]);
  }
});

it('exposes the same query-preserving navigation adapter through the browser entry', () => {
  expect(browser.createAdminShellNavigation).toBe(createAdminShellNavigation);
});

it('composes entity routes with the injected shell navigator', () => {
  const calls: string[] = [];
  const routes = react.createEntityRoutes({
    adminBase: '/console', panelId: 'records',
    navigate: ({ routePath }) => { calls.push(routePath); },
  });
  expect(routes.href({ entity: 'items', id: 'a/b', view: 'edit' })).toBe('/console/records/items/row/a%2Fb/edit');
  routes.navigate({ entity: 'items', id: 'a/b', view: 'edit' });
  expect(calls).toEqual(['/records/items/row/a%2Fb/edit']);
});
