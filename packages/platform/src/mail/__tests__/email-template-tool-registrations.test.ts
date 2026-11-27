import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { createEmailTemplatesAgentToolCatalog } from '../email-template-agent-tools.js';
import { buildEmailTemplatesRegistrations, contributeEmailTemplatesTools } from '../email-template-tool-registrations.js';
import type { EmailTemplateRecord, EmailTemplateStore } from '../email-template-operations.js';
import type { ToolExecutionContext } from '@jini-ai/core';

class Denied extends Error {}

test('a stale expected version never reaches the HTML writer', async () => {
  const write = vi.fn(async () => true);
  const store = { openHtml: async () => ({ version: 4, write }), find: async () => ({ id: 'template', name: 'Welcome', html: '<title>Hello</title>', version: 4, updatedAt: 'now' }) } as unknown as EmailTemplateStore;
  const [tool] = buildEmailTemplatesRegistrations({ workspaceId: 'ws', editHtmlPermission: 'pages.edit_html',
    catalog: createEmailTemplatesAgentToolCatalog({ copy: { editHtmlPermission: 'pages.edit_html' } }),
    requirePermission: async () => {}, emailTemplateStore: () => store, ForbiddenError: Denied,
  }).filter(tool => tool.descriptor.id === 'email_template_edit');
  assert.ok(tool);
  await assert.rejects(tool.handler({ executionId: 'exec', principal: { id: 'owner' }, run: { id: 'run' }, input: { id: 'template', html: '<title>Changed</title>', expectedVersion: 3 }, signal: new AbortController().signal }), /EMAIL_TEMPLATES_VERSION_CONFLICT/);
  assert.equal(write.mock.calls.length, 0);
});

test('registered tools create, edit, list, get and preview the same saved template under their declared permissions', async () => {
  const rows = new Map<string, EmailTemplateRecord>();
  const create = vi.fn<EmailTemplateStore['create']>(async ({ name, seedHtml }) => {
    const row = { id: 'welcome', name, html: seedHtml, version: 1, updatedAt: '2026-01-05T00:00:00.000Z' };
    rows.set(row.id, row);
    return row;
  });
  const openHtml = vi.fn<EmailTemplateStore['openHtml']>(async ({ id }) => {
    const row = rows.get(id);
    if (!row) throw new Error(`Unexpected edit of ${id}`);
    return { version: row.version, write: async ({ html }) => {
      if (rows.get(id) !== row) return false;
      rows.set(id, { ...row, html, version: row.version + 1 });
      return true;
    } };
  });
  const listPage = vi.fn<EmailTemplateStore['listPage']>(async ({ limit }) => [...rows.values()].slice(0, limit));
  const store: EmailTemplateStore = {
    create, openHtml, listPage, find: async ({ id }) => rows.get(id) ?? null,
    rename: async () => { throw new Error('Unexpected rename'); },
  };
  const requirePermission = vi.fn(async ({ name }: { ctx: ToolExecutionContext; name: string }) => {
    if (name !== 'content.read' && name !== 'site.html.edit') throw new Denied('Unexpected permission');
  });
  const contributor = contributeEmailTemplatesTools();
  const tools = contributor.build({ workspaceId: 'ws', editHtmlPermission: 'site.html.edit',
    catalog: createEmailTemplatesAgentToolCatalog({ copy: { editHtmlPermission: 'site.html.edit' } }),
    requirePermission, emailTemplateStore: () => store, ForbiddenError: Denied,
  }, undefined);
  const invoke = async (id: string, input: object, permission: string) => {
    const tool = tools.find(entry => entry.descriptor.id === id);
    if (!tool) throw new Error(`Missing tool ${id}`);
    const ctx = { executionId: 'exec', principal: { id: 'editor' }, run: { id: 'run' }, input, signal: new AbortController().signal };
    const previousCalls = requirePermission.mock.calls.length;
    const result = await tool.handler(ctx);
    assert.deepEqual(requirePermission.mock.calls.slice(previousCalls), [[{ ctx, name: permission }]]);
    return result;
  };
  const original = '<title>Welcome</title><p>Hello</p>';
  const edited = '<title>Updated {{name}}</title><p>Hi {{name}}</p>';
  const created = await invoke('email_template_create', { name: 'Welcome', html: original }, 'site.html.edit');
  assert.deepEqual(create.mock.calls, [[{ name: 'Welcome', seedHtml: original, actorId: 'editor' }]]);
  assert.deepEqual(created, { id: 'welcome', name: 'Welcome', subject: 'Welcome', version: 1, html: original,
    updatedAt: '2026-01-05T00:00:00.000Z', fields: [], undeclaredFields: [] });
  const changed = await invoke('email_template_edit', { id: 'welcome', html: edited, expectedVersion: 1 }, 'site.html.edit');
  assert.deepEqual(openHtml.mock.calls, [[{ id: 'welcome', actorId: 'editor' }]]);
  assert.deepEqual(changed, { id: 'welcome', name: 'Welcome', subject: 'Updated {{name}}', version: 2, html: edited,
    updatedAt: '2026-01-05T00:00:00.000Z', fields: [], undeclaredFields: ['name'] });
  assert.equal((await store.find({ id: 'welcome' }))?.html, edited);
  assert.deepEqual(await invoke('email_template_list', { limit: 3 }, 'content.read'), {
    templates: [{ id: 'welcome', name: 'Welcome', subject: 'Updated {{name}}', version: 2, fields: [], updatedAt: '2026-01-05T00:00:00.000Z' }],
  });
  assert.deepEqual(listPage.mock.calls, [[{ limit: 4 }]]);
  assert.deepEqual(await invoke('email_template_get', { id: ' welcome ' }, 'content.read'), changed);
  assert.deepEqual(await invoke('email_template_preview', { id: 'welcome', values: { name: 'Ada' } }, 'content.read'), {
    subject: 'Updated Ada', html: '<title>Updated Ada</title><p>Hi Ada</p>', missingFields: [], undeclaredFields: ['name'],
    mode: 'admin', scriptsStripped: false,
  });
});

test('create checks cancellation after permission and before acquiring the template store', async () => {
  const controller = new AbortController();
  const stop = new Error('Editor cancelled creation');
  const emailTemplateStore = vi.fn((): EmailTemplateStore => { throw new Error('Store must not open'); });
  const tool = buildEmailTemplatesRegistrations({ workspaceId: 'ws', editHtmlPermission: 'pages.edit_html',
    catalog: createEmailTemplatesAgentToolCatalog({ copy: { editHtmlPermission: 'pages.edit_html' } }),
    requirePermission: async () => { controller.abort(stop); }, emailTemplateStore, ForbiddenError: Denied,
  }).find(entry => entry.descriptor.id === 'email_template_create');
  assert.ok(tool);
  await assert.rejects(tool.handler({ executionId: 'exec', principal: { id: 'owner' }, run: { id: 'run' },
    input: { name: 'Welcome' }, signal: controller.signal }), error => error === stop);
  assert.deepEqual(emailTemplateStore.mock.calls, []);
});
