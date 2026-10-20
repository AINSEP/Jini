import type { AdminFormDefinition, AdminFormsPort } from '../../core/ports/forms.js';
export interface FormsConformanceResult { readonly passed: number; readonly failures: readonly string[]; }
type Check = (name: string, accepted: boolean) => void;
type SubmissionSeed = { formId: string; submissionId: string };
/** Run on an isolated API: creates definitions and trashes seeded submissions.
 * The host provides a disposable seed so conformance never touches an operator's live data. */
export async function runFormsApiConformance(
  { api }: { api: AdminFormsPort },
  { slug = 'forms-conformance', submission }: { slug?: string; submission?: SubmissionSeed } = {},
): Promise<FormsConformanceResult> {
  const failures: string[] = [];
  let passed = 0;
  const check: Check = (name, accepted) => { if (accepted) passed++; else failures.push(name); };
  const created = await checkCreateAndRead({ api, slug, check });
  await checkUpdates({ api, created, check });
  if (submission) await checkSubmissions({ api, created, submission, check });
  return { passed, failures };
}
/** Resolves true when the operation is refused; only that probe's rejection is absorbed. */
async function rejects({ operation }: { operation: () => Promise<unknown> }): Promise<boolean> {
  try { await operation(); return false; } catch { return true; }
}
async function checkCreateAndRead(
  { api, slug, check }: { api: AdminFormsPort; slug: string; check: Check },
): Promise<AdminFormDefinition> {
  const field = { id: 'email', label: 'Email', type: 'email', required: true, className: 'wide', attributes: { 'aria-label': 'Email' } };
  const created = await api.createFormDefinition({ name: 'Contact', slug, fields: [field] }, { notify: { enabled: true, recipients: ['owner@example.com'] } });
  check('create returns requested definition', created.name === 'Contact' && created.slug === slug && created.status === 'active');
  check('field attributes survive create', created.fields[0]?.className === 'wide' && created.fields[0]?.attributes?.['aria-label'] === 'Email');
  check('list includes created definition', (await api.listFormDefinitions({})).some(form => form.id === created.id));
  check('get returns created id', (await api.getFormDefinition({ id: created.id })).id === created.id);
  const snapshot = await api.getFormDefinition({ id: created.id });
  Object.assign(snapshot.fields[0]!, { label: 'Changed only in the read snapshot' });
  check('read snapshots cannot mutate stored fields', (await api.getFormDefinition({ id: created.id })).fields[0]?.label === 'Email');
  return created;
}
async function checkUpdates(
  { api, created, check }: { api: AdminFormsPort; created: AdminFormDefinition; check: Check },
): Promise<void> {
  const { id } = created;
  const updated = await api.updateFormDefinition({ id }, { name: 'Renamed', fields: [...created.fields, { id: 'message', label: 'Message', type: 'textarea', required: false }] });
  check('name patch and added field persist', updated.name === 'Renamed' && updated.fields.length === 2);
  check('untouched notify survives update', updated.notify.enabled && updated.notify.recipients[0] === 'owner@example.com');
  check('existing fields cannot be removed', await rejects({ operation: () => api.updateFormDefinition({ id }, { fields: [] }) }));
  check('rejected removal leaves fields intact', (await api.getFormDefinition({ id })).fields.length === 2);
  const disabled = await api.updateFormDefinition({ id }, { status: 'disabled' });
  check('definition disable is reversible', disabled.status === 'disabled' && (await api.updateFormDefinition({ id }, { status: 'active' })).status === 'active');
  const html = await api.updateFormDefinition({ id }, { mode: 'html', html: '<input name="email">' });
  check('HTML authoring survives update', html.mode === 'html' && html.html === '<input name="email">');
  check('builder switch is explicit', (await api.updateFormDefinition({ id }, { mode: 'builder' })).mode === 'builder');
  check('empty submission page has null cursor', (await api.listFormSubmissions({ formId: id })).nextCursor === null);
  check('definition has no delete operation', !('deleteFormDefinition' in api));
}
async function checkSubmissions(
  { api, created, submission, check }: { api: AdminFormsPort; created: AdminFormDefinition; submission: SubmissionSeed; check: Check },
): Promise<void> {
  const crossForm = { formId: created.id, submissionId: submission.submissionId };
  const page = await api.listFormSubmissions({ formId: submission.formId }, { limit: 1 });
  check('submission page is form scoped', page.items.every(item => item.formDefinitionId === submission.formId));
  check('submission detail is scoped', (await api.getFormSubmission(submission)).formDefinitionId === submission.formId);
  check('a submission of another form is unavailable', await rejects({ operation: () => api.getFormSubmission(crossForm) }));
  const wrongFormDeleteRejected = await rejects({ operation: () => api.deleteFormSubmission(crossForm) });
  check('cross-form trash is rejected without removing the submission', wrongFormDeleteRejected && (await api.getFormSubmission(submission)).id === submission.submissionId);
  await api.deleteFormSubmission(submission);
  check('trashed submission detail is unavailable', await rejects({ operation: () => api.getFormSubmission(submission) }));
  check('trashed submission is absent from active pages', !(await api.listFormSubmissions({ formId: submission.formId })).items.some(item => item.id === submission.submissionId));
}
