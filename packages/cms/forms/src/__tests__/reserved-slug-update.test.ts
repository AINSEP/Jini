import { executeCommand } from '@jini-ai/cms/core';
import { expect, it } from 'vitest';
import { FormFieldValidationError } from '../errors.js';
import { createFormDefinition, updateFormDefinition } from '../write-service.js';
import { InMemoryChangeSetRepo } from './change-set.fixture.js';
import { InMemoryFormDefinitionRepo } from './repo.fixture.js';

it('revalidates a stored slug against current host reservations before applying a name patch', async () => {
  const reservedSlugs = new Set<string>();
  let id = 0;
  const deps = {
    executeCommand, reservedSlugs, permission: 'forms.manage',
    repo: new InMemoryFormDefinitionRepo(), changeSets: new InMemoryChangeSetRepo(),
    clock: { nowMs: () => Date.parse('2026-10-02T00:00:00.000Z')},
    idGen: { newId: () => `id-${++id}` },
    authorize: async () => ({ allowed: true, reason: 'ok' }),
  };
  const workspaceId = 'workspace-1';
  const actor = { id: 'operator', kind: 'user' as const };
  const { definition } = await createFormDefinition({
    deps, input: { workspaceId, actor, name: 'Contact', slug: 'contact', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] },
  });
  // An existing definition can predate a host policy change; update must enforce that policy too.
  reservedSlugs.add('contact');
  const update = () => updateFormDefinition({
    deps, input: { workspaceId, actor, formId: definition.id, patch: { name: 'Renamed', slug: 'safe-slug' } },
  });
  const error = await update().catch((error: unknown) => error);
  expect(error).toBeInstanceOf(FormFieldValidationError);
  expect(error).toMatchObject({
    message: "slug 'contact' is reserved",
    fieldErrors: [{ field: 'slug', reason: "'contact' is reserved by the host" }],
  });
  expect(await deps.repo.findById({ workspaceId, id: definition.id })).toEqual(definition);

  reservedSlugs.delete('contact');
  const { definition: updated } = await update();
  expect(updated.name).toBe('Renamed');
  expect(updated.slug).toBe('contact');
});
