import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import { createEmailTemplatesAgentToolCatalog } from '../email-template-agent-tools.js';
import { buildEmailTemplatesRegistrations } from '../email-template-tool-registrations.js';
import type { EmailTemplateStore } from '../email-template-operations.js';

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
