import type { AdminFormsPort, AdminFormDefinition, AdminFormSubmission } from '../../core/ports/forms.js';
import { AdminApiError } from '../../core/transport/errors.js';
import type { FormsTrashPort } from '../ports.js';
/** A scoped, deterministic in-memory API with the core contract's add/edit-only invariant. */
export function createMemoryFormsApi(
  _required: Record<string, never> = {},
  { forms = [], submissions = [], now = () => new Date(0).toISOString(), nextId }: {
    forms?: readonly AdminFormDefinition[]; submissions?: readonly AdminFormSubmission[];
    now?: () => string; nextId?: () => string;
  } = {},
): AdminFormsPort & { readonly forms: AdminFormDefinition[]; readonly submissions: AdminFormSubmission[]; readonly trash: FormsTrashPort } {
  const definitions = structuredClone([...forms]);
  const answers = structuredClone([...submissions]);
  let sequence = definitions.length;
  const missing = (id: string): never => { throw new AdminApiError({ message: `form definition '${id}' was not found`, status: 404 }); };
  const find = (id: string) => definitions.find(form => form.slug === id) ?? definitions.find(form => form.id === id) ?? missing(id);
  const definitionId = (id: string) => definitions.find(form => form.slug === id)?.id ?? id;
  const findSubmission = (formId: string, id: string) => {
    const resolvedId = definitionId(formId);
    return answers.find(item => item.id === id && item.formDefinitionId === resolvedId && item.status !== 'trash') ?? missing(id);
  };
  const remove = (type: 'form' | 'form_submission', id: string) => {
    const rows = type === 'form' ? definitions : answers;
    const index = rows.findIndex(row => row.id === id);
    if (index < 0) missing(id);
    // The fixture retains submission payloads just as the generic Trash owner does. Definitions
    // keep their existing separate fixture projection; the core has no definition-delete method.
    if (type === 'form_submission') answers[index] = { ...answers[index]!, status: 'trash' };
    else rows.splice(index, 1);
  };
  return {
    forms: definitions, submissions: answers,
    async listFormDefinitions(_required, _optional = {}) { return structuredClone(definitions); },
    async getFormDefinition({ id }, _optional = {}) { return structuredClone(find(id)); },
    async createFormDefinition(input, options = {}) {
      if (definitions.some(form => form.slug === input.slug)) throw new AdminApiError({ message: 'form slug already exists', status: 409 });
      let id = nextId?.() ?? `fake-${++sequence}`;
      if (!nextId) while (definitions.some(form => form.id === id)) id = `fake-${++sequence}`;
      if (definitions.some(form => form.id === id)) throw new AdminApiError({ message: 'form id already exists', status: 409 });
      const created: AdminFormDefinition = { ...structuredClone(input), id, notify: structuredClone(options.notify ?? { enabled: false, recipients: [] }), status: 'active', createdAt: now(), updatedAt: now() };
      definitions.push(created);
      return structuredClone(created);
    },
    async updateFormDefinition({ id }, patch = {}) {
      const current = definitions.find(form => form.id === id) ?? missing(id);
      const incomingIds = patch.fields ? new Set(patch.fields.map(field => field.id)) : null;
      if (incomingIds && current.fields.some(field => !incomingIds.has(field.id))) {
        throw new AdminApiError({ message: 'existing form fields cannot be removed', status: 400 }, { code: 'FORMS_FIELD_VALIDATION_ERROR' });
      }
      // The contract excludes slug; runtime callers cannot smuggle it through a cast either.
      const { name, fields, notify, status, mode, html } = patch;
      const applied = { ...(name !== undefined ? { name } : {}), ...(fields !== undefined ? { fields } : {}), ...(notify !== undefined ? { notify } : {}), ...(status !== undefined ? { status } : {}), ...(mode !== undefined ? { mode } : {}), ...(html !== undefined ? { html } : {}) };
      const updated = { ...current, ...structuredClone(applied), updatedAt: now() };
      definitions[definitions.indexOf(current)] = updated;
      return structuredClone(updated);
    },
    // O(n log n) time/O(n) space over the fixture submissions; one filtered cursor page,
    // no per-row I/O. This adapter is a disposable contract fixture, not a production store.
    async listFormSubmissions({ formId }, { cursor, limit = 50 } = {}) {
      const resolvedId = definitionId(formId);
      const sorted = answers.filter(item => item.formDefinitionId === resolvedId && item.status !== 'trash').sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || b.id.localeCompare(a.id));
      const start = cursor ? sorted.findIndex(item => item.id === cursor) + 1 : 0;
      if (cursor && start === 0) throw new AdminApiError({ message: 'invalid submissions cursor', status: 400 });
      if (!Number.isInteger(limit) || limit < 1) throw new AdminApiError({ message: 'invalid submissions limit', status: 400 });
      const items = sorted.slice(start, start + limit);
      return { items: structuredClone(items), nextCursor: start + limit < sorted.length ? items.at(-1)!.id : null };
    },
    async getFormSubmission({ formId, submissionId }, _optional = {}) { return structuredClone(findSubmission(formId, submissionId)); },
    async deleteFormSubmission({ formId, submissionId }, _optional = {}) {
      const found = findSubmission(formId, submissionId);
      remove('form_submission', found.id);
    },
    trash: { async trash({ type, id }, _optional = {}) { remove(type, id); return { ok: true, version: null }; } },
  };
}
