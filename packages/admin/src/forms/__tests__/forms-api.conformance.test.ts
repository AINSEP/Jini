import { expect, it } from 'vitest';
import type { AdminFormsPort } from '../../core/ports/forms.js';
import { createMemoryFormsApi } from '../adapters/memory.js';
import { runFormsApiConformance } from '../conformance/forms-api.conformance.js';
const seed = () => createMemoryFormsApi({}, { submissions: [{ id: 's1', formDefinitionId: 'f1', data: { email: 'visitor@example.com', accepted: false }, sourceIp: '127.0.0.1', submittedAt: '2026-10-07T00:00:00Z' }] });
const submission = { formId: 'f1', submissionId: 's1' };
/** A memory adapter with selected operations replaced, to model one non-conforming host at a time. */
const deviant = (overrides: (base: AdminFormsPort) => Partial<AdminFormsPort> & Record<string, unknown>): AdminFormsPort => {
  const base = seed();
  return { ...base, ...overrides(base) };
};
it('the memory adapter passes the core Forms API conformance contract', async () => {
  const api = seed();
  const result = await runFormsApiConformance({ api }, { submission });
  expect(result.failures).toEqual([]);
  expect(result.passed).toBe(20);
  // Hiding a record alone could also be hard deletion: inspect retained fixture data explicitly.
  expect(api.submissions).toEqual([{ id: 's1', formDefinitionId: 'f1', data: { email: 'visitor@example.com', accepted: false }, sourceIp: '127.0.0.1', submittedAt: '2026-10-07T00:00:00Z', status: 'trash' }]);
});
it('without a seeded submission only the definition checks run and seeded data is untouched', async () => {
  const api = seed();
  expect(await runFormsApiConformance({ api })).toEqual({ passed: 14, failures: [] });
  expect(api.submissions[0]?.status).toBeUndefined();
});
it('uses the caller slug for the created definition', async () => {
  const api = seed();
  await runFormsApiConformance({ api }, { slug: 'custom-slug' });
  expect(api.forms.map(form => form.slug)).toEqual(['custom-slug']);
});
it('reports a create that does not return the requested definition', async () => {
  const api = deviant(base => ({
    async createFormDefinition(input, options) { return { ...(await base.createFormDefinition(input, options)), name: 'Other' }; },
  }));
  expect((await runFormsApiConformance({ api })).failures).toEqual(['create returns requested definition']);
});
it('lets an update rejection outside the removal probe escape the run when create drops every field', async () => {
  const api = deviant(base => ({
    async createFormDefinition(input, options) { return { ...(await base.createFormDefinition(input, options)), fields: [] }; },
  }));
  await expect(runFormsApiConformance({ api })).rejects.toThrow('existing form fields cannot be removed');
});
it('reports a create that keeps the field but drops its attributes', async () => {
  const api = deviant(base => ({
    async createFormDefinition(input, options) {
      const created = await base.createFormDefinition(input, options);
      return { ...created, fields: [{ id: 'email', label: 'Email', type: 'email', required: true, className: 'wide' }] };
    },
  }));
  expect((await runFormsApiConformance({ api })).failures).toEqual(['field attributes survive create']);
});
it('reports a list and get that cannot find the created definition', async () => {
  const api = deviant(base => ({
    async listFormDefinitions() { return []; },
    async getFormDefinition({ id }) { return { ...(await base.getFormDefinition({ id })), id: 'elsewhere' }; },
  }));
  expect((await runFormsApiConformance({ api })).failures).toEqual(['list includes created definition', 'get returns created id']);
});
it('reports read snapshots that alias stored fields', async () => {
  const api = deviant(base => {
    let shared: Awaited<ReturnType<AdminFormsPort['getFormDefinition']>> | undefined;
    return { async getFormDefinition({ id }) { shared ??= await base.getFormDefinition({ id }); return shared; } };
  });
  expect((await runFormsApiConformance({ api })).failures).toContain('read snapshots cannot mutate stored fields');
});
it('reports an update that loses the patch, the notify config, the status, and the authoring mode', async () => {
  const api = deviant(base => ({
    async updateFormDefinition({ id }) { return { ...(await base.getFormDefinition({ id })), notify: { enabled: false, recipients: [] } }; },
  }));
  expect((await runFormsApiConformance({ api })).failures).toEqual([
    'name patch and added field persist', 'untouched notify survives update', 'existing fields cannot be removed',
    'rejected removal leaves fields intact', 'definition disable is reversible', 'HTML authoring survives update',
    'builder switch is explicit',
  ]);
});
it('reports an update that accepts field removal', async () => {
  const api = deviant(base => ({
    async updateFormDefinition({ id }, patch = {}) {
      if (patch.fields?.length === 0) return base.getFormDefinition({ id });
      return base.updateFormDefinition({ id }, patch);
    },
  }));
  expect((await runFormsApiConformance({ api })).failures).toEqual(['existing fields cannot be removed']);
});
it('reports a disable that cannot be re-activated', async () => {
  const api = deviant(base => ({
    async updateFormDefinition({ id }, patch = {}) {
      const updated = await base.updateFormDefinition({ id }, patch);
      return patch.status === 'active' ? { ...updated, status: 'disabled' } : updated;
    },
  }));
  expect((await runFormsApiConformance({ api })).failures).toEqual(['definition disable is reversible']);
});
it('reports an HTML body lost on update and an implicit builder switch', async () => {
  const api = deviant(base => ({
    async updateFormDefinition({ id }, patch = {}) {
      const updated = await base.updateFormDefinition({ id }, patch);
      return patch.mode ? { ...updated, mode: 'html', html: '' } : updated;
    },
  }));
  expect((await runFormsApiConformance({ api })).failures).toEqual(['HTML authoring survives update', 'builder switch is explicit']);
});
it('reports an empty submission page with a cursor and a definition delete operation', async () => {
  const api = deviant(() => ({
    async listFormSubmissions() { return { items: [], nextCursor: 'more' }; },
    deleteFormDefinition: async () => undefined,
  }));
  expect((await runFormsApiConformance({ api })).failures).toEqual(['empty submission page has null cursor', 'definition has no delete operation']);
});
it('reports submission reads that ignore the form scope', async () => {
  const api = deviant(base => ({
    async listFormSubmissions({ formId }, optional) {
      const page = await base.listFormSubmissions({ formId }, optional);
      return { ...page, items: page.items.map(item => ({ ...item, formDefinitionId: 'other' })) };
    },
    async getFormSubmission({ submissionId }) { return { ...(await base.getFormSubmission({ formId: 'f1', submissionId })), formDefinitionId: 'other' }; },
  }));
  expect((await runFormsApiConformance({ api }, { submission })).failures).toEqual([
    'submission page is form scoped', 'submission detail is scoped', 'a submission of another form is unavailable',
  ]);
});
it('reports a failure when a cross-form trash is accepted without crashing on the removed seed', async () => {
  const api = deviant(base => ({
    async deleteFormSubmission({ submissionId }) { await base.deleteFormSubmission({ formId: 'f1', submissionId }); },
  }));
  expect(await runFormsApiConformance({ api }, { submission })).toEqual({
    passed: 19, failures: ['cross-form trash is rejected without removing the submission'],
  });
});
it('reports a cross-form trash that removes the submission before rejecting', async () => {
  const api = deviant(base => ({
    async deleteFormSubmission({ submissionId }) {
      await base.deleteFormSubmission({ formId: 'f1', submissionId });
      throw new Error('rejected after deletion');
    },
  }));
  expect(await runFormsApiConformance({ api }, { submission })).toEqual({
    passed: 19, failures: ['cross-form trash is rejected without removing the submission'],
  });
});
it('reports a trash that leaves the submission readable and listed', async () => {
  const api = deviant(base => ({
    async deleteFormSubmission(scope) { await base.getFormSubmission(scope); },
  }));
  expect((await runFormsApiConformance({ api }, { submission })).failures).toEqual([
    'trashed submission detail is unavailable', 'trashed submission is absent from active pages',
  ]);
});
