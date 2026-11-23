import { describe, expect, it } from 'vitest';
import { createEmailTemplatesAgentToolCatalog } from '../email-template-agent-tools.js';

const catalog = createEmailTemplatesAgentToolCatalog({ copy: { editHtmlPermission: 'host.edit_html' } });
const byName = new Map(catalog.map((tool) => [tool.name, tool]));

describe('createEmailTemplatesAgentToolCatalog', () => {
  it('publishes the five email-template tools with their side effects', () => {
    expect(catalog.map((tool) => [tool.name, tool.sideEffects])).toEqual([
      ['email_template_list', 'none'],
      ['email_template_get', 'none'],
      ['email_template_create', 'mutates-durable-state'],
      ['email_template_edit', 'mutates-durable-state'],
      ['email_template_preview', 'none'],
    ]);
  });

  it('authorizes reads with content.read and writes with the host edit-html permission it is bound with', () => {
    expect(catalog.map((tool) => [tool.name, tool.authorization.permission])).toEqual([
      ['email_template_list', 'content.read'],
      ['email_template_get', 'content.read'],
      ['email_template_create', 'host.edit_html'],
      ['email_template_edit', 'host.edit_html'],
      ['email_template_preview', 'content.read'],
    ]);
  });

  it('names the bound permission in the write tools’ model-facing text and nowhere else', () => {
    expect(byName.get('email_template_create')!.description.endsWith(' Requires host.edit_html.')).toBe(true);
    expect(byName.get('email_template_edit')!.description).toContain('a stale version writes nothing (EMAIL_TEMPLATES_VERSION_CONFLICT). Returns the saved template. ');
    expect(byName.get('email_template_edit')!.description.endsWith(' Requires host.edit_html.')).toBe(true);
    expect(byName.get('email_template_list')!.description).toBe(
      "Lists this site's HTML email templates. Returns {templates:[{id,name,subject,fields,version,updatedAt}]}. Requires content.read.",
    );
    for (const name of ['email_template_list', 'email_template_get', 'email_template_preview']) {
      expect(byName.get(name)!.description).not.toContain('host.edit_html');
    }
  });

  it('carries the field contract in get, create and edit, and the edit input contract', () => {
    for (const name of ['email_template_get', 'email_template_create', 'email_template_edit']) {
      expect(byName.get(name)!.description).toContain('A template is a full HTML email document. Its <title> is the subject (it may use fields).');
    }
    expect(byName.get('email_template_edit')!.inputSchema).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['id', 'html', 'expectedVersion'],
      properties: { id: { type: 'string' }, html: { type: 'string' }, expectedVersion: { type: 'integer', minimum: 1 } },
    });
  });
});
