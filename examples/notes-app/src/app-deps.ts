/**
 * @file Builds the dependencies every route group shares, once: ports, repositories, the entry
 * service deps, and the seeded contact form definition.
 */
import { executeCommand } from '@jini-ai/cms/core';
import type { EntryRecord } from '@jini-ai/cms/entries';
import { createFormDefinition, type FieldDescriptor, type FormDefinitionRecord } from '@jini-ai/cms/forms';
import { formDefinitionRepoFor, formSubmissionRepoFor } from '@jini-ai/cms/forms/sql';
import { FORMS_TABLES, type AppKernel } from './db.ts';
import { createSqlEntryRepo } from './notes-repo.ts';
import { authorize, createAppPorts, NOTE_TYPE, OWNER_ID, WORKSPACE_ID } from './ports.ts';

export const CONTACT_SLUG = 'contact';
const CONTACT_FIELDS: FieldDescriptor[] = [
  { id: 'name', label: 'Your name', type: 'text', required: true },
  { id: 'email', label: 'Email', type: 'email', required: true },
  { id: 'message', label: 'Message', type: 'textarea', required: true },
];
// The hooks are the CSS/data-attribute anchors renderHtmlForm writes; no default set is exported.
export const FORM_HOOKS = { field: 'data-field', form: 'data-form', success: 'data-form-success', error: 'data-form-error' };

type AppPorts = Awaited<ReturnType<typeof createAppPorts>>;
type EntryRepo = ReturnType<typeof createSqlEntryRepo>;
type DefinitionRepo = ReturnType<typeof formDefinitionRepoFor>;

export interface AppDeps {
  readonly kernel: AppKernel;
  readonly ports: AppPorts;
  readonly entryRepo: EntryRepo;
  readonly definitionRepo: DefinitionRepo;
  readonly submissionRepo: ReturnType<typeof formSubmissionRepoFor>;
  readonly entryDeps: {
    readonly entryRepo: EntryRepo; readonly contentTypeRepo: AppPorts['contentTypeRepo']; readonly clock: AppPorts['clock'];
    readonly authorize: typeof authorize; readonly outbox: AppPorts['entryOutbox'];
  };
  readonly actor: { readonly actorId: string; readonly principalKind: 'user'; readonly actor: { readonly id: string; readonly kind: 'user' } };
  readonly contactForm: FormDefinitionRecord;
  findNoteBySlug(required: { slug: string }, optional?: Record<string, never>): Promise<EntryRecord | null>;
}

// Seeds the contact form once; the definition row lives in SQLite, so later boots find it.
async function seedContactForm(
  { definitionRepo, ports }: { definitionRepo: DefinitionRepo; ports: AppPorts },
  _optional: Record<string, never> = {},
): Promise<FormDefinitionRecord> {
  const existing = await definitionRepo.findBySlug({ workspaceId: WORKSPACE_ID, slug: CONTACT_SLUG });
  if (existing) return existing;
  const { definition } = await createFormDefinition({
    deps: {
      executeCommand, repo: definitionRepo, clock: ports.clock, idGen: ports.idGen, changeSets: ports.changeSets,
      permission: 'admin.forms.manage', reservedSlugs: new Set(), authorize,
    },
    input: { workspaceId: WORKSPACE_ID, actor: { id: OWNER_ID, kind: 'user' }, name: 'Contact', slug: CONTACT_SLUG, fields: CONTACT_FIELDS },
  });
  return definition;
}

export async function createAppDeps({ kernel }: { kernel: AppKernel }, _optional: Record<string, never> = {}): Promise<AppDeps> {
  const ports = await createAppPorts();
  const entryRepo = createSqlEntryRepo({ kernel });
  const definitionRepo = formDefinitionRepoFor({ kernel, tables: FORMS_TABLES });
  const submissionRepo = formSubmissionRepoFor({ kernel, tables: FORMS_TABLES });
  return {
    kernel, ports, entryRepo, definitionRepo, submissionRepo,
    entryDeps: { entryRepo, contentTypeRepo: ports.contentTypeRepo, clock: ports.clock, authorize, outbox: ports.entryOutbox },
    actor: { actorId: OWNER_ID, principalKind: 'user', actor: { id: OWNER_ID, kind: 'user' } },
    contactForm: await seedContactForm({ definitionRepo, ports }),
    findNoteBySlug: ({ slug }) => entryRepo.findBySlug({ workspaceId: WORKSPACE_ID, type: NOTE_TYPE, slug }),
  };
}
