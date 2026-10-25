/** Packed public entry points run in plain Node outside the workspace's peer symlinks. */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { copyRuntimeTree, fixture, pack, packages, run } from '../../../../scripts/testing/packed-fixture.js';

/** Keep the copied runtime deps, but leave only tarball files for packed packages: a checkout copy would mask a missing `files` entry. */
function packOnly(dir: string, names: readonly string[]): void {
  for (const name of names) {
    rmSync(join(dir, 'node_modules/@jini-ai', name), { recursive: true, force: true });
    pack(dir, name);
  }
}

it('loads packed Forms and validates a submission without platform installed', () => {
  const dir = fixture('cms-forms-no-platform-');
  try {
    copyRuntimeTree(dir, '@jini-ai/cms', join(packages, 'cms'));
    packOnly(dir, ['cms']);
    expect(existsSync(join(dir, 'node_modules/@jini-ai/platform'))).toBe(false);
    // REGRESSION: an eager sender re-export made this existing public entry require platform.
    const result = run(dir, `
      import assert from 'node:assert/strict';
      const forms = await import('@jini-ai/cms/forms');
      assert.equal('createFormsEmailSender' in forms, false);
      const result = forms.validateSubmissionPayload({
        definition: { fields: [{ id: 'email', name: 'email', label: 'Email', type: 'email', required: true }] },
        body: { email: 'reader@example.org' },
      });
      assert.deepEqual(result, { valid: true, data: { email: 'reader@example.org' } });
      await assert.rejects(import('@jini-ai/platform/mail/senders'), { code: 'ERR_MODULE_NOT_FOUND' });
      console.log('forms-without-platform');
    `);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('forms-without-platform');
    expect(result.stderr).toBe('');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);

it('loads the packed sender subpath and configures an email action through injected ports', () => {
  const dir = fixture('cms-forms-email-sender-');
  try {
    copyRuntimeTree(dir, '@jini-ai/cms', join(packages, 'cms'));
    copyRuntimeTree(dir, '@jini-ai/platform', join(packages, 'platform'));
    packOnly(dir, ['cms', 'platform']);
    const result = run(dir, `
      import assert from 'node:assert/strict';
      const { createFormsEmailSender } = await import('@jini-ai/cms/forms/email-sender');
      const definition = {
        id: 'contact', workspaceId: 'site', name: 'Contact', status: 'active',
        fields: [{ id: 'email', name: 'email', label: 'Email', type: 'email', required: true }],
      };
      const writes = [];
      const sender = createFormsEmailSender({ deps: {
        definitions: { findById: async () => definition, list: async () => [definition] },
        submissions: { findById: async () => null },
        authorize: async () => true,
        readEmailBinding: async () => null,
        writeEmailBinding: async ({ binding }) => {
          writes.push(binding);
          return { ...binding, activatedAt: '2026-10-25T00:00:00Z' };
        },
        site: async () => ({ name: 'Example', url: 'https://example.org' }),
        readiness: async () => ({ ready: true, blockers: [] }),
        templates: { describe: async () => ({ version: '1', fields: ['email'], placeholders: ['email'] }) },
      } });
      const binding = {
        bindingId: 'reply', enabled: true, templateId: 'thanks',
        recipientId: 'email', replyTo: 'owner@example.org',
      };
      const saved = await sender.configureEmail({
        workspaceId: 'site', principalId: 'owner', sourceId: 'contact', binding,
      });
      assert.deepEqual(saved, { ...binding, activatedAt: '2026-10-25T00:00:00Z' });
      assert.deepEqual(writes, [{
        kind: 'email', bindingId: 'reply', formId: 'contact', templateId: 'thanks',
        submitterEmailFieldId: 'email', replyTo: 'owner@example.org', enabled: true,
      }]);
      console.log('sender-configured');
    `);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('sender-configured');
    expect(result.stderr).toBe('');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
